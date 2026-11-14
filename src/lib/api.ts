/**
 * In-browser replacement for the old FastAPI backend.
 *
 * `apiGet('/api/...')` accepts the same paths the backend served and resolves
 * to `{ data }` with the same response shapes, so the chart components only
 * swapped `axios.get` for `apiGet`. Everything is computed here from OpenF1.
 */

import { DataError, FIRST_YEAR, formatLapTime, getSchedule, loadSession, Session } from './f1data';
import { OpenF1Error } from './openf1';

export class ApiError extends Error {
  constructor(public detail: string, public status: number) {
    super(detail);
  }
}

type Handler = (args: number[], sessionType: string) => Promise<unknown>;

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

async function schedule([year]: number[]) {
  const events = await getSchedule(year);
  return {
    year,
    first_year: FIRST_YEAR,
    events: events.map((e) => {
      const byCode = Object.fromEntries(e.sessions.map((s) => [s.code, s.date_start]));
      const last = e.sessions.length ? e.sessions[e.sessions.length - 1].date_start : e.date_start;
      return {
        round: e.round,
        name: e.name,
        country: e.country,
        location: e.location,
        // Date of the last session (normally the race), used to pick the most recent completed event.
        date: last.slice(0, 10),
        sessions: {
          fp1: byCode.FP1 ?? null,
          fp2: byCode.FP2 ?? null,
          fp3: byCode.FP3 ?? null,
          qualifying: byCode.Q ?? null,
          race: byCode.R ?? null,
        },
        available_sessions: e.sessions.map((s) => ({ code: s.code, name: s.name, date_start: s.date_start })),
      };
    }),
  };
}

async function session(s: Session, [year, round]: number[]) {
  const weatherMean = (key: string) => mean(s.weather.map((w) => w[key]).filter((v) => v != null));
  return {
    session_info: {
      year,
      round,
      session_type: s.code.toLowerCase(),
      session_name: s.name,
      event_name: s.event.name,
      track_name: s.event.location,
      weather: s.weather.length
        ? {
            air_temp: weatherMean('air_temperature'),
            track_temp: weatherMean('track_temperature'),
            humidity: weatherMean('humidity'),
          }
        : null,
    },
    drivers: s.driverNumbers().map((n) => s.driverInfo(n)),
  };
}

function fastestLapRows(s: Session) {
  const laps = s.fastestLaps();
  const best = laps[0];
  const compounds = s.compoundByLap();
  return laps.map((lap) => {
    const info = s.driverInfo(lap.driver_number);
    return {
      driver: info.abbreviation,
      name: info.name,
      team: info.team,
      team_color: info.team_color,
      lap_time: lap.lap_duration,
      lap_time_str: formatLapTime(lap.lap_duration),
      delta_to_pole: Math.round((lap.lap_duration - best.lap_duration) * 1000) / 1000,
      lap_number: lap.lap_number,
      tyre: compounds.get(`${lap.driver_number}:${lap.lap_number}`)?.compound ?? null,
    };
  });
}

async function fastestLaps(s: Session) {
  const rows = fastestLapRows(s);
  return {
    fastest_laps: rows,
    pole_lap: { driver: rows[0]?.driver ?? '', time_str: rows[0]?.lap_time_str ?? '' },
    session_info: s.label(),
  };
}

async function lapDeltas(s: Session) {
  const rows = fastestLapRows(s);
  return {
    lap_deltas: rows.map(({ tyre, lap_time_str, ...rest }) => rest),
    pole_lap: {
      driver: rows[0]?.driver ?? '',
      time: rows[0]?.lap_time ?? 0,
      time_formatted: rows[0]?.lap_time_str ?? '',
    },
    session_info: s.label(),
  };
}

async function tireStrategy(s: Session) {
  const compounds = s.compoundByLap();
  return {
    tire_strategy: s
      .driverNumbers()
      .filter((n) => s.lapsByDriver.get(n)?.length)
      .map((n) => {
        const info = s.driverInfo(n);
        return {
          driver: info.abbreviation,
          name: info.name,
          team: info.team,
          laps: (s.lapsByDriver.get(n) ?? []).map((lap) => {
            const tyre = compounds.get(`${n}:${lap.lap_number}`);
            return {
              lap: lap.lap_number,
              compound: tyre?.compound ?? 'Unknown',
              tyre_life: tyre?.tyre_life ?? null,
              lap_time: lap.lap_duration ?? null,
            };
          }),
        };
      }),
  };
}

async function positionChanges(s: Session) {
  const data = [];
  for (const n of s.driverNumbers()) {
    const byLap = s.positionsByLap(n);
    if (!byLap.length) continue;
    const info = s.driverInfo(n);
    data.push({
      driver: info.abbreviation,
      name: info.name,
      team: info.team,
      lap_numbers: byLap.map(([lap]) => lap),
      positions: byLap.map(([, pos]) => pos),
    });
  }
  return { position_changes: data, session_info: s.label() };
}

async function fullThrottle(s: Session) {
  const data = [];
  for (const [lap, t] of await s.fastestLapTelemetry()) {
    if (!t) continue;
    // weight each sample by how long it lasts, since samples aren't evenly spaced
    let full = 0;
    let total = 0;
    for (let i = 0; i < t.time.length - 1; i++) {
      const dt = t.time[i + 1] - t.time[i];
      total += dt;
      if ((t.throttle[i] ?? 0) > 90) full += dt;
    }
    const info = s.driverInfo(lap.driver_number);
    data.push({
      driver: info.abbreviation,
      name: info.name,
      team: info.team,
      throttle_percentage: total > 0 ? Math.round((full / total) * 1000) / 10 : 0,
      lap_number: lap.lap_number,
    });
  }
  data.sort((a, b) => b.throttle_percentage - a.throttle_percentage);
  return { full_throttle_data: data, session_info: s.label() };
}

async function speedDistance(s: Session) {
  const data = [];
  for (const [lap, t] of await s.fastestLapTelemetry()) {
    if (!t) continue;
    const info = s.driverInfo(lap.driver_number);
    data.push({
      driver: info.abbreviation,
      name: info.name,
      team: info.team,
      distances: t.distance.map((d) => Math.round(d * 10) / 10),
      speeds: t.speed,
      lap_number: lap.lap_number,
    });
  }
  return { speed_distance_data: data, session_info: s.label() };
}

type Point = [number, number];

function rotate([x, y]: Point, angle: number): Point {
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
}

async function circuitMap(s: Session) {
  const circuit = await s.circuitInfo();
  if (!circuit?.x?.length) return { error: 'Circuit layout not available' };

  const angle = (Number(circuit.rotation ?? 0) / 180) * Math.PI;
  const track = (circuit.x as number[]).map((x, i) => rotate([x, circuit.y[i]], angle));
  const corners = (circuit.corners ?? []).map((corner: any) => {
    const { x, y } = corner.trackPosition;
    const offset = rotate([750, 0], (corner.angle / 180) * Math.PI);
    const point = rotate([x, y], angle);
    const text = rotate([x + offset[0], y + offset[1]], angle);
    return {
      number: corner.number,
      letter: corner.letter ?? '',
      label: `${corner.number}${corner.letter ?? ''}`,
      track_x: point[0],
      track_y: point[1],
      text_x: text[0],
      text_y: text[1],
    };
  });
  return {
    track_name: s.event.location,
    track_coordinates: track,
    start_finish: { x: [track[0][0], track[1][0]], y: [track[0][1], track[1][1]] },
    corners,
    rotation_angle: angle,
  };
}

/** Handlers that need a loaded session get it as their first argument. */
const withSession =
  (fn: (s: Session, args: number[]) => Promise<unknown>): Handler =>
  async ([year, round], sessionType) =>
    fn(await loadSession(year, round, sessionType), [year, round]);

const routes: Record<string, Handler> = {
  schedule,
  session: withSession(session),
  'fastest-laps': withSession(fastestLaps),
  'lap-deltas': withSession(lapDeltas),
  'tire-strategy': withSession(tireStrategy),
  'position-changes': withSession(positionChanges),
  'full-throttle': withSession(fullThrottle),
  'speed-distance': withSession(speedDistance),
  'circuit-map': withSession(circuitMap),
  'start-analysis': async ([year, round]) => ({
    start_analysis: await (await loadSession(year, round, 'R')).startAnalysis(),
  }),
  'cornering-analysis': async () => ({ corner_analysis: [] }), // not implemented yet
};

/** Resolve an `/api/...` path to `{ data }`, like `axios.get` did. */
export async function apiGet<T = any>(path: string): Promise<{ data: T }> {
  const [name, ...rest] = path.replace(/^\/?api\//, '').split('/');
  const handler = routes[name];
  if (!handler) throw new ApiError(`Unknown endpoint: ${path}`, 404);

  const numbers = rest.filter((p) => /^\d+$/.test(p)).map(Number);
  const sessionType = rest.find((p) => !/^\d+$/.test(p)) ?? 'R';
  try {
    return { data: (await handler(numbers, sessionType)) as T };
  } catch (e) {
    if (e instanceof DataError) throw new ApiError(e.message, e.status);
    if (e instanceof OpenF1Error) throw new ApiError(`OpenF1 request failed: ${e.message}`, 502);
    throw e;
  }
}
