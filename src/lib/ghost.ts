/**
 * "Ghost laps": several laps replayed together from the same start, so you
 * can watch how different drivers drove them. Positions come from OpenF1's
 * location data (~4 per second, ~12 m apart), smoothed with a Catmull-Rom
 * curve; speed and gear from car telemetry; gaps are measured at the same
 * point on the track.
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

/** Catmull-Rom value and derivative for one coordinate. */
function catmull(p0: number, p1: number, p2: number, p3: number, u: number): [number, number] {
  const u2 = u * u;
  const u3 = u2 * u;
  const value = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  const slope = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u2);
  return [value, slope];
}

export class GhostRace {
  readonly cars: GhostCar[];
  readonly duration: number;
  private readonly cos: number;
  private readonly sin: number;
  private readonly length: number;
  private readonly distances = new Map<number, number[]>();
  private readonly timelines = new Map<number, (d: number) => number>();

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
    const p = car.positions;
    const n = p.t.length;
    const i = Math.min(findSegment(p.t, t), n - 2);
    const i0 = Math.max(0, i - 1);
    const i3 = Math.min(n - 1, i + 2);
    const span = p.t[i + 1] - p.t[i] || 1;
    const u = Math.min(1, Math.max(0, (t - p.t[i]) / span));
    const [rx, dx] = catmull(p.x[i0], p.x[i], p.x[i + 1], p.x[i3], u);
    const [ry, dy] = catmull(p.y[i0], p.y[i], p.y[i + 1], p.y[i3], u);
    const [z] = catmull(p.z[i0], p.z[i], p.z[i + 1], p.z[i3], u);
    const [x, y] = this.rotate(rx, ry);
    const [hx, hy] = this.rotate(dx, dy);
    const tel = car.telemetry;
    const dist = this.distances.get(this.key(car));
    return {
      x,
      y,
      z,
      heading: Math.atan2(hy, hx),
      speed: tel ? Math.round(interp(tel.time, tel.speed, t)) : null,
      gear: tel ? tel.gear[Math.min(findSegment(tel.time, t), tel.gear.length - 1)] : null,
      distance: tel && dist ? interp(tel.time, dist, t) : 0,
      finished: time >= car.lapTime,
    };
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
