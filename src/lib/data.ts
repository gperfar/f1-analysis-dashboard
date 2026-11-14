/**
 * What the pages call to get data. Each loader first tries the pre-computed
 * JSON published with the site (built by scripts/build-data.ts on GitHub
 * Actions) and falls back to computing it live from OpenF1 in the browser.
 */

import { buildSeason, buildStory, buildTelemetry, ENERGY_VERSION, EnergySet, SeasonStory, SessionStory, STORY_VERSION, TELEMETRY_VERSION, TelemetryLap, TelemetrySet, toTelemetryLap } from './story';
import { apiDate, DataError, parseDate, telemetryFromRows } from './f1data';
import { openf1Get, Row } from './openf1';
import { VideoIndex, VideoRef, VIDEOS_VERSION } from './videos';

const DATA_BASE = './data';

async function precomputed<T extends { version: number }>(path: string, version = STORY_VERSION): Promise<T | null> {
  try {
    const response = await fetch(`${DATA_BASE}/${path}`, { cache: 'no-cache' });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null;
    const data = (await response.json()) as T;
    return data.version === version ? data : null;
  } catch {
    return null;
  }
}

const memo = new Map<string, Promise<any>>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  let pending = memo.get(key);
  if (!pending) {
    pending = load();
    pending.catch(() => memo.delete(key));
    memo.set(key, pending);
  }
  return pending;
}

export function loadSeason(year: number): Promise<SeasonStory> {
  return once(`season:${year}`, async () => (await precomputed<SeasonStory>(`${year}/season.json`)) ?? buildSeason(year));
}

export function loadStory(year: number, round: number, code: string): Promise<SessionStory> {
  const c = code.toUpperCase();
  return once(`story:${year}/${round}/${c}`, async () =>
    (await precomputed<SessionStory>(`${year}/${round}/${c}.json`)) ?? buildStory(year, round, c)
  );
}

export function loadTelemetry(year: number, round: number, code: string): Promise<TelemetrySet> {
  const c = code.toUpperCase();
  return once(`telemetry:${year}/${round}/${c}`, async () =>
    (await precomputed<TelemetrySet>(`${year}/${round}/${c}.telemetry.json`, TELEMETRY_VERSION)) ?? buildTelemetry(year, round, c)
  );
}

/**
 * Telemetry for any lap of a driver. Fastest laps come from the telemetry
 * set; any other lap is one small OpenF1 request (cached in the browser).
 */
export function loadLapTelemetry(story: SessionStory, driver: number, lap: number, fastest?: TelemetrySet | null): Promise<TelemetryLap | null> {
  const known = fastest?.drivers.find((d) => d.driver === driver && d.lap === lap);
  if (known) return Promise.resolve(known);
  return once(`lap:${story.meta.sessionKey}:${driver}:${lap}`, async () => {
    const t0 = parseDate(story.meta.t0 ?? story.meta.dateStart);
    const series = story.laps.find((s) => s.driver === driver);
    const i = series?.lap.indexOf(lap) ?? -1;
    const end = i >= 0 ? series!.end[i] : null;
    const time = i >= 0 ? series!.time[i] : null;
    if (t0 === null || end === null || time === null) return null;
    const start = t0 + (end - time) * 1000;
    const rows = await openf1Get('car_data', {
      params: { session_key: story.meta.sessionKey, driver_number: driver },
      filters: [`date>=${apiDate(start)}`, `date<${apiDate(start + time * 1000)}`],
    });
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const t = telemetryFromRows(rows, start);
    return t ? toTelemetryLap(driver, lap, time, t) : null;
  });
}

/** Energy management per lap (only available once the data build has processed the session). */
export function loadEnergy(year: number, round: number, code: string): Promise<EnergySet | null> {
  const c = code.toUpperCase();
  return once(`energy:${year}/${round}/${c}`, () => precomputed<EnergySet>(`${year}/${round}/${c}.energy.json`, ENERGY_VERSION));
}

/** Official highlights video for a session, if the data build found one. */
export async function loadVideo(year: number, round: number, code: string): Promise<VideoRef | null> {
  const index = await once('videos', async () => precomputed<VideoIndex>('videos.json', VIDEOS_VERSION));
  return index?.videos[`${year}/${round}/${code.toUpperCase()}`] ?? null;
}

/** The most recent session that has finished, preferring races. */
export async function latestSession(): Promise<{ year: number; round: number; code: string }> {
  const now = Date.now();
  for (const year of [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1]) {
    const season = await loadSeason(year);
    const done = season.events.flatMap((e) =>
      e.sessions
        .filter((s) => (parseDate(s.dateEnd) ?? Infinity) < now - 30 * 60_000)
        .map((s) => ({ round: e.round, code: s.code, end: parseDate(s.dateEnd)! }))
    );
    if (!done.length) continue;
    const lastRound = Math.max(...done.map((d) => d.round));
    const inRound = done.filter((d) => d.round === lastRound);
    const race = inRound.find((d) => d.code === 'R');
    const latest = race ?? inRound.sort((a, b) => b.end - a.end)[0];
    return { year, round: lastRound, code: latest.code };
  }
  throw new DataError('No finished sessions found.', 404);
}

// -- replay ----------------------------------------------------------------------------

export interface ReplayFrame {
  /** Seconds from the window start. */
  t: number[];
  x: number[];
  y: number[];
}

/**
 * Car positions on track for one lap of the leader (all cars, one request).
 * Coordinates are rotated like the circuit map so they line up.
 */
/** Gap to the leader and to the car ahead over time (seconds, or e.g. "+1 LAP"). */
export interface ReplayTiming {
  t: number[];
  gap: (number | string | null)[];
  interval: (number | string | null)[];
}

export function loadReplay(
  story: SessionStory,
  lap: number
): Promise<{ duration: number; cars: Map<number, ReplayFrame>; timing: Map<number, ReplayTiming> }> {
  return once(`replay:${story.meta.sessionKey}:${lap}`, async () => {
    const t0 = parseDate(story.meta.t0);
    const leader = story.laps.find((s) => s.driver === story.classification[0]?.driver);
    if (t0 === null || !leader) throw new DataError('Replay not available for this session.', 404);
    const i = leader.lap.indexOf(lap);
    const end = leader.end[i];
    const start = i > 0 ? leader.end[i - 1] : 0;
    if (end == null || start == null) throw new DataError('No timing for that lap.', 404);

    const from = t0 + start * 1000;
    const to = t0 + end * 1000;
    const iso = (ms: number) => new Date(ms).toISOString().replace('Z', '');
    const [rows, intervals] = await Promise.all([
      openf1Get('location', {
        params: { session_key: story.meta.sessionKey },
        filters: [`date>=${iso(from)}`, `date<${iso(to)}`],
      }),
      // Start a little earlier so every car has a gap from the first frame.
      openf1Get('intervals', {
        params: { session_key: story.meta.sessionKey },
        filters: [`date>=${iso(from - 30_000)}`, `date<${iso(to)}`],
      }).catch(() => [] as Row[]),
    ]);

    const angle = story.circuit?.rotation ?? 0;
    const cars = new Map<number, ReplayFrame>();
    for (const r of rows.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      if (r.x === 0 && r.y === 0) continue; // no signal
      const frame = cars.get(r.driver_number) ?? { t: [], x: [], y: [] };
      frame.t.push(((parseDate(r.date) ?? from) - from) / 1000);
      frame.x.push(r.x * Math.cos(angle) - r.y * Math.sin(angle));
      frame.y.push(r.x * Math.sin(angle) + r.y * Math.cos(angle));
      cars.set(r.driver_number, frame);
    }
    const timing = new Map<number, ReplayTiming>();
    for (const r of intervals.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      const entry = timing.get(r.driver_number) ?? { t: [], gap: [], interval: [] };
      entry.t.push(((parseDate(r.date) ?? from) - from) / 1000);
      entry.gap.push(r.gap_to_leader ?? null);
      entry.interval.push(r.interval ?? null);
      timing.set(r.driver_number, entry);
    }
    return { duration: (to - from) / 1000, cars, timing };
  });
}
