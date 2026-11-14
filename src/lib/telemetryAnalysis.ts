/**
 * Analysis of a lap's car telemetry: corner-by-corner metrics, and energy
 * management zones (lift-and-coast, and "clipping": losing speed at full
 * throttle when the battery stops deploying).
 *
 * OpenF1 samples car data roughly 4 times a second (~20 m apart at
 * 300 km/h) and brake is on/off, so these are estimates, good for comparing
 * drivers on the same data rather than exact figures.
 */

import type { Circuit, TelemetryLap } from './story';

// -- helpers -----------------------------------------------------------------------------

export function interp(xs: number[], ys: number[], x: number): number {
  if (!xs.length) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

/** Lap distances scaled to a common length, so different drivers' laps line up. */
export function scaledDistance(lap: TelemetryLap, length: number): number[] {
  const total = lap.distance[lap.distance.length - 1] || 1;
  return lap.distance.map((d) => (d / total) * length);
}

/**
 * Lap distances aligned to the track. Distance integrated from ~4 Hz speed
 * drifts by 1-2% over a lap (tens of metres mid-lap), which is enough to
 * compare different points of the track. So: find the slowest point near
 * each braking corner and warp the lap's distance so it lands on that
 * corner's official position, linearly in between. Two laps aligned this
 * way line up corner by corner.
 */
export function alignedDistance(lap: TelemetryLap, circuit: Circuit | null, length: number): number[] {
  const base = scaledDistance(lap, length);
  if (!circuit) return base;
  const scale = length / perimeterMeters(circuit);
  const anchors: [number, number][] = [[0, 0]];
  for (const c of circuit.corners) {
    if (c.distance === null) continue;
    const target = c.distance * scale;
    const near = base.map((d, i) => [d, i] as const).filter(([d]) => Math.abs(d - target) <= 150).map(([, i]) => i);
    if (near.length < 3) continue;
    const minI = near.reduce((a, b) => (lap.speed[b] < lap.speed[a] ? b : a));
    const maxSpeed = Math.max(...near.map((i) => lap.speed[i]));
    // only real braking corners have a clear minimum to anchor on
    if (maxSpeed - lap.speed[minI] < 25) continue;
    const last = anchors[anchors.length - 1];
    if (base[minI] > last[0] + 20 && target > last[1] + 20) anchors.push([base[minI], target]);
  }
  anchors.push([length, length]);
  const from = anchors.map((a) => a[0]);
  const to = anchors.map((a) => a[1]);
  return base.map((d) => interp(from, to, d));
}

/**
 * Distance -> elapsed time for a lap, pinned to the line at both ends
 * (0 m at 0 s, full length at the official lap time), so section times add
 * up to the real lap time difference.
 */
export function lapTimeline(lap: TelemetryLap, dist: number[], length: number) {
  const d = [0, ...dist.filter((_, i) => dist[i] > 0 && dist[i] < length), length];
  const t = [0, ...lap.time.filter((_, i) => dist[i] > 0 && dist[i] < length), lap.lapTime];
  return (x: number) => interp(d, t, x);
}

/** Length of the track outline in metres (coordinates are decimetres). */
export function perimeterMeters(circuit: Circuit): number {
  let total = 0;
  for (let i = 0; i < circuit.x.length; i++) {
    const j = (i + 1) % circuit.x.length;
    total += Math.hypot(circuit.x[j] - circuit.x[i], circuit.y[j] - circuit.y[i]);
  }
  return total / 10;
}

// -- energy zones --------------------------------------------------------------------------

export interface Zone {
  start: number; // metres
  end: number;
  seconds: number;
  /** Speed lost across the zone, km/h (clipping). */
  speedLoss: number;
}

export interface EnergyZones {
  liftAndCoast: Zone[];
  clipping: Zone[];
  liftSeconds: number;
  clippingMeters: number;
}

const LIFT_MIN_SECONDS = 0.4;
const CLIP_MIN_METERS = 40;

/**
 * Lift-and-coast: off the throttle and off the brake at speed.
 * Clipping: flat out, yet the car slows down on a straight.
 */
export function energyZones(lap: TelemetryLap, distance: number[] = lap.distance): EnergyZones {
  const n = lap.speed.length;
  const zones = (test: (i: number) => boolean, keep: (z: Zone) => boolean) => {
    const out: Zone[] = [];
    let start: number | null = null;
    for (let i = 0; i < n; i++) {
      const on = test(i);
      if (on && start === null) start = Math.max(0, i - 1);
      if ((!on || i === n - 1) && start !== null) {
        const end = on ? i : i - 1;
        const zone = {
          start: distance[start],
          end: distance[end],
          seconds: lap.time[end] - lap.time[start],
          speedLoss: lap.speed[start] - lap.speed[end],
        };
        if (keep(zone)) out.push(zone);
        start = null;
      }
    }
    return out;
  };
  const liftAndCoast = zones(
    (i) => lap.throttle[i] < 10 && !lap.brake[i] && lap.speed[i] > 120,
    (z) => z.seconds >= LIFT_MIN_SECONDS
  );
  const clipping = zones(
    (i) => i > 0 && lap.throttle[i] >= 98 && lap.speed[i] < lap.speed[i - 1] && lap.speed[i] > 200,
    (z) => z.end - z.start >= CLIP_MIN_METERS && z.speedLoss > 0
  );
  return {
    liftAndCoast,
    clipping,
    liftSeconds: Math.round(liftAndCoast.reduce((a, z) => a + z.seconds, 0) * 10) / 10,
    clippingMeters: Math.round(clipping.reduce((a, z) => a + (z.end - z.start), 0)),
  };
}

// -- corners -------------------------------------------------------------------------------

export interface CornerMetric {
  label: string;
  /** Apex position on the scaled lap, metres. */
  apex: number;
  minSpeed: number;
  entrySpeed: number;
  exitSpeed: number;
  /** Metres before the apex where braking started (null if no braking). */
  brakeBefore: number | null;
  /** Time spent in this corner's section of the lap, seconds. */
  sectionTime: number;
  sectionStart: number;
  sectionEnd: number;
}

/**
 * Splits the lap into one section per corner (halfway between neighbouring
 * corners) and measures each. `length` is the common lap length the
 * distances are scaled to.
 */
export function cornerMetrics(lap: TelemetryLap, circuit: Circuit, length: number): CornerMetric[] {
  const corners = circuit.corners.filter((c) => c.distance !== null);
  if (!corners.length) return [];
  const scale = length / perimeterMeters(circuit);
  const apexes = corners.map((c) => c.distance! * scale);
  const dist = alignedDistance(lap, circuit, length);
  const timeAt = lapTimeline(lap, dist, length);

  return corners.map((c, k) => {
    const sectionStart = k === 0 ? 0 : (apexes[k - 1] + apexes[k]) / 2;
    const sectionEnd = k === corners.length - 1 ? length : (apexes[k] + apexes[k + 1]) / 2;
    const idx = dist.map((d, i) => [d, i] as const).filter(([d]) => d >= sectionStart && d <= sectionEnd).map(([, i]) => i);
    if (!idx.length) {
      return { label: c.label, apex: apexes[k], minSpeed: NaN, entrySpeed: NaN, exitSpeed: NaN, brakeBefore: null, sectionTime: NaN, sectionStart, sectionEnd };
    }
    // the slowest point near the apex (within 120 m) is the corner's minimum speed
    const near = idx.filter((i) => Math.abs(dist[i] - apexes[k]) <= 120);
    const pool = near.length ? near : idx;
    const minI = pool.reduce((a, b) => (lap.speed[b] < lap.speed[a] ? b : a));
    const before = idx.filter((i) => i <= minI);
    const entryI = before.reduce((a, b) => (lap.speed[b] > lap.speed[a] ? b : a), before[0]);
    const brakeI = before.find((i) => i >= entryI && lap.brake[i]);
    return {
      label: c.label,
      apex: apexes[k],
      minSpeed: lap.speed[minI],
      entrySpeed: lap.speed[entryI],
      exitSpeed: Math.round(interp(dist, lap.speed, sectionEnd)),
      brakeBefore: brakeI === undefined ? null : Math.round(dist[minI] - dist[brakeI]),
      sectionTime: timeAt(sectionEnd) - timeAt(sectionStart),
      sectionStart,
      sectionEnd,
    };
  });
}
