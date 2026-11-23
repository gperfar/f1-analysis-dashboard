/**
 * "Ghost laps": several laps replayed together from the same start, so you
 * can watch how different drivers drove them. Positions come from OpenF1's
 * location data (~4 per second, ~12 m apart), which shape each car's line;
 * the car moves along it at its telemetry speed. Gaps are measured at the
 * same point on the track.
 */

import type { DriverRef, LapPositions, SessionStory, TelemetryLap } from './story';
import { alignedDistance, interp, lapTimeline } from './telemetryAnalysis';

export interface GhostCar {
  driver: DriverRef;
  lap: number;
  lapTime: number;
  positions: LapPositions;
  telemetry: TelemetryLap | null;
}

export interface CarState {
  x: number;
  y: number;
  z: number;
  /** Direction of travel, radians (0 = +x), in rotated map coordinates. */
  heading: number;
  speed: number | null;
  gear: number | null;
  /** Metres into the lap. */
  distance: number;
  finished: boolean;
}

function findSegment(ts: number[], t: number): number {
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Moving average; past the ends the series is continued in a straight line, so ends don't bend. */
function smoothLinear(values: number[], radius: number): number[] {
  const n = values.length;
  if (n < 3) return values;
  const k = Math.min(radius, n - 1);
  const startSlope = (values[k] - values[0]) / k;
  const endSlope = (values[n - 1] - values[n - 1 - k]) / k;
  const at = (i: number) => (i < 0 ? values[0] + startSlope * i : i >= n ? values[n - 1] + endSlope * (i - n + 1) : values[i]);
  return values.map((_, i) => {
    let sum = 0;
    for (let j = i - radius; j <= i + radius; j++) sum += at(j);
    return sum / (2 * radius + 1);
  });
}

/** Keep values[from..to] and continue them in straight lines outside that range. */
function extendLinear(values: number[], from: number, to: number, span: number): number[] {
  const out = [...values];
  const a = Math.max(0, Math.min(from, values.length - 1));
  const b = Math.max(a, Math.min(to, values.length - 1));
  const k = Math.max(1, Math.min(span, b - a));
  const v0 = (values[Math.min(a + k, b)] - values[a]) / k;
  const v1 = (values[b] - values[Math.max(b - k, a)]) / k;
  for (let i = 0; i < a; i++) out[i] = values[a] - v0 * (a - i);
  for (let i = b + 1; i < values.length; i++) out[i] = values[b] + v1 * (i - b);
  return out;
}

/** Moving average with a shrinking window at the ends. */
function smooth(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    const a = Math.max(0, i - radius);
    const b = Math.min(values.length - 1, i + radius);
    let sum = 0;
    for (let j = a; j <= b; j++) sum += values[j];
    return sum / (b - a + 1);
  });
}

const PATH_STEP = 20; // decimetres between resampled path points
const CLOCK_STEP = 0.05; // seconds between samples of distance-vs-time

/**
 * One car's lap as a smooth line plus how far along it the car is at each
 * moment. Location samples are spatially good but their timestamps jitter
 * (0.04-0.8 s apart), so they only shape the line; progress along it comes
 * from integrated speed, which is smooth.
 */
class Track {
  readonly s: number[] = [];
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly z: number[] = [];
  readonly length: number;
  private readonly clock: number[];

  constructor(xs: number[], ys: number[], zs: number[], ts: number[], lapTime: number, telemetry: TelemetryLap | null) {
    // drop repeated samples, then resample every PATH_STEP along the line
    const px: number[] = [];
    const py: number[] = [];
    const pz: number[] = [];
    const pt: number[] = [];
    xs.forEach((x, i) => {
      const n = px.length;
      if (n && Math.hypot(x - px[n - 1], ys[i] - py[n - 1]) < 1) return;
      px.push(x);
      py.push(ys[i]);
      pz.push(zs[i]);
      pt.push(ts[i]);
    });
    const raw = [0];
    for (let i = 1; i < px.length; i++) raw.push(raw[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]));
    const total = raw[raw.length - 1] || 1;
    const rx: number[] = [];
    const ry: number[] = [];
    const rz: number[] = [];
    for (let d = 0; d <= total; d += PATH_STEP) {
      rx.push(interp(raw, px, d));
      ry.push(interp(raw, py, d));
      rz.push(interp(raw, pz, d));
    }
    // two passes of a +-6 m average take out the sampling corners
    const sx = smooth(smooth(rx, 3), 3);
    const sy = smooth(smooth(ry, 3), 3);
    const sz = smooth(smooth(rz, 5), 5);
    let acc = 0;
    sx.forEach((x, i) => {
      if (i) acc += Math.hypot(x - sx[i - 1], sy[i] - sy[i - 1]);
      this.s.push(acc);
      this.x.push(x);
      this.y.push(sy[i]);
      this.z.push(sz[i]);
    });
    this.length = acc || 1;

    // progress along the line on a regular clock, from 0 to lapTime
    const steps = Math.ceil(lapTime / CLOCK_STEP) + 2;
    const times = Array.from({ length: steps }, (_, i) => i * CLOCK_STEP);
    const index = (t: number) => Math.round(t / CLOCK_STEP);
    let progress: number[];
    if (telemetry && telemetry.time.length > 10) {
      // distance from speed, scaled so the samples' first/last times land on the line's ends
      const at = (t: number) => interp(telemetry.time, telemetry.distance, t);
      const d0 = at(pt[0]);
      const d1 = at(pt[pt.length - 1]);
      const k = this.length / (d1 - d0 || 1); // decimetres of line per metre driven
      progress = times.map((t) => (at(t) - d0) * k);
      // outside the telemetry's own time range, carry on at the same speed
      progress = extendLinear(progress, index(telemetry.time[0]) + 1, index(telemetry.time[telemetry.time.length - 1]) - 1, 6);
    } else {
      // no telemetry: the samples' own distance-vs-time, averaged over ~1 s
      const sampleS = raw.map((r) => (r / total) * this.length);
      progress = extendLinear(times.map((t) => interp(pt, sampleS, t)), index(pt[0]) + 1, index(pt[pt.length - 1]) - 1, 10);
      progress = smoothLinear(progress, 10);
    }
    this.clock = smoothLinear(progress, 4);
  }

  /** Decimetres along the line at time t (may run past either end). */
  progress(t: number): number {
    const c = this.clock;
    const f = Math.max(0, t) / CLOCK_STEP;
    const i = Math.min(Math.floor(f), c.length - 2);
    if (i < 0) return c[0] ?? 0;
    return c[i] + (c[i + 1] - c[i]) * (f - i);
  }

  point(d: number): [number, number, number] {
    const { s, x, y, z } = this;
    const n = s.length;
    if (n < 2) return [x[0] ?? 0, y[0] ?? 0, z[0] ?? 0];
    // extend straight past the ends
    if (d <= 0 || d >= this.length) {
      const [a, b] = d <= 0 ? [0, 1] : [n - 2, n - 1];
      const len = s[b] - s[a] || 1;
      const off = d <= 0 ? d : d - this.length;
      const base = d <= 0 ? a : b;
      return [x[base] + ((x[b] - x[a]) / len) * off, y[base] + ((y[b] - y[a]) / len) * off, z[base]];
    }
    const i = Math.min(findSegment(s, d), n - 2);
    const u = (d - s[i]) / (s[i + 1] - s[i] || 1);
    return [x[i] + (x[i + 1] - x[i]) * u, y[i] + (y[i + 1] - y[i]) * u, z[i] + (z[i + 1] - z[i]) * u];
  }

  heading(d: number): number {
    const [ax, ay] = this.point(d - 40);
    const [bx, by] = this.point(d + 40);
    return Math.atan2(by - ay, bx - ax);
  }
}

export class GhostRace {
  readonly cars: GhostCar[];
  readonly duration: number;
  private readonly cos: number;
  private readonly sin: number;
  private readonly length: number;
  private readonly distances = new Map<number, number[]>();
  private readonly timelines = new Map<number, (d: number) => number>();
  private readonly tracks = new Map<number, Track>();

  constructor(story: SessionStory, cars: GhostCar[]) {
    this.cars = cars;
    this.duration = Math.max(...cars.map((c) => c.lapTime));
    const rotation = story.circuit?.rotation ?? 0;
    this.cos = Math.cos(rotation);
    this.sin = Math.sin(rotation);
    const withTelemetry = cars.filter((c) => c.telemetry);
    this.length = withTelemetry.length
      ? withTelemetry.reduce((a, c) => a + c.telemetry!.distance[c.telemetry!.distance.length - 1], 0) / withTelemetry.length
      : 5000;
    for (const c of withTelemetry) {
      const dist = alignedDistance(c.telemetry!, story.circuit, this.length);
      this.distances.set(this.key(c), dist);
      this.timelines.set(this.key(c), lapTimeline(c.telemetry!, dist, this.length));
    }
    for (const c of cars) {
      const p = c.positions;
      const rotated = p.x.map((x, i) => this.rotate(x, p.y[i]));
      this.tracks.set(this.key(c), new Track(rotated.map((r) => r[0]), rotated.map((r) => r[1]), p.z, p.t, c.lapTime, c.telemetry));
    }
  }

  private key(c: GhostCar) {
    return c.driver.number * 1000 + c.lap;
  }

  /** Rotate raw OpenF1 x/y into the map's orientation (same as the circuit outline). */
  rotate(x: number, y: number): [number, number] {
    return [x * this.cos - y * this.sin, x * this.sin + y * this.cos];
  }

  state(car: GhostCar, time: number): CarState {
    const t = Math.min(Math.max(time, 0), car.lapTime);
    const track = this.tracks.get(this.key(car))!;
    const d = track.progress(t);
    const [x, y, z] = track.point(d);
    const tel = car.telemetry;
    const dist = this.distances.get(this.key(car));
    return {
      x,
      y,
      z,
      heading: track.heading(d),
      speed: tel ? Math.round(interp(tel.time, tel.speed, t)) : null,
      gear: tel ? tel.gear[Math.min(findSegment(tel.time, t), tel.gear.length - 1)] : null,
      distance: tel && dist ? interp(tel.time, dist, t) : 0,
      finished: time >= car.lapTime,
    };
  }

  /** Recent path of a car (for trails), oldest first. */
  trail(car: GhostCar, time: number, seconds: number): [number, number][] {
    const out: [number, number][] = [];
    const end = Math.min(time, car.lapTime);
    for (let t = Math.max(0, end - seconds); t <= end + 1e-6; t += 0.05) {
      const s = this.state(car, t);
      out.push([s.x, s.y]);
    }
    return out;
  }

  /**
   * How far `car` is behind `reference` at `time`, in seconds: the time
   * the reference took to reach the point where `car` is now.
   */
  gap(reference: GhostCar, car: GhostCar, time: number): number | null {
    if (car === reference) return 0;
    if (time >= car.lapTime && time >= reference.lapTime) return car.lapTime - reference.lapTime;
    const refTimeline = this.timelines.get(this.key(reference));
    if (!refTimeline || !car.telemetry) return null;
    const d = this.state(car, time).distance;
    return Math.min(time, car.lapTime) - refTimeline(d);
  }

  /** Cars ordered by how far round the lap they are (finished cars by lap time). */
  order(time: number): GhostCar[] {
    return [...this.cars].sort((a, b) => {
      const fa = time >= a.lapTime;
      const fb = time >= b.lapTime;
      if (fa && fb) return a.lapTime - b.lapTime;
      if (fa !== fb) return fa ? -1 : 1;
      return this.state(b, time).distance - this.state(a, time).distance;
    });
  }
}
