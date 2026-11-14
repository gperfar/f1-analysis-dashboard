/**
 * F1 session data built on OpenF1 (2023 onwards).
 *
 * `getSchedule(year)` lists the season's events and their sessions, and
 * `loadSession(year, round, code)` returns a `Session` with drivers, laps,
 * stints, positions, weather and lazily-loaded telemetry.
 */

import { getJson, openf1Get, Row } from './openf1';

export const FIRST_YEAR = 2023;

/** OpenF1 session_name -> short code used in the app. */
const SESSION_CODES: Record<string, string> = {
  'Practice 1': 'FP1',
  'Practice 2': 'FP2',
  'Practice 3': 'FP3',
  'Sprint Qualifying': 'SQ',
  'Sprint Shootout': 'SQ', // 2023 name for sprint qualifying
  Sprint: 'S',
  Qualifying: 'Q',
  Race: 'R',
};

// A session's data is treated as final this long after it ends; until then
// responses are cached only briefly so new laps show up.
const FINAL_AFTER_MS = 3 * 3600_000;
const LIVE_TTL = 120;
const SCHEDULE_TTL = 3600;

/** The session exists but there's no data for it (yet). HTTP-like status for the UI. */
export class DataError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Parse OpenF1 dates ("2026-11-08T17:16:29.782000+00:00") to epoch ms. */
export function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  // Trim microseconds to milliseconds: not every browser parses 6 digits.
  const ms = Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(ms) ? null : ms;
}

/** Format epoch ms for an OpenF1 filter (UTC, no offset: '+' breaks URLs). */
function apiDate(ms: number): string {
  return new Date(ms).toISOString().replace('Z', '');
}

export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  const minutes = Math.floor(seconds / 60);
  const secs = (seconds - minutes * 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${secs}`;
}

// -- schedule -------------------------------------------------------------------

export interface SessionMeta {
  code: string;
  name: string;
  session_key: number;
  date_start: string;
  date_end: string;
}

export interface Event {
  round: number;
  meeting_key: number;
  name: string;
  country: string;
  location: string;
  date_start: string;
  circuit_key: number;
  circuit_info_url: string | null;
  year: number;
  sessions: SessionMeta[];
}

const scheduleCache = new Map<number, Promise<Event[]>>();

export function getSchedule(year: number): Promise<Event[]> {
  if (year < FIRST_YEAR) return Promise.resolve([]);
  let pending = scheduleCache.get(year);
  if (!pending) {
    pending = fetchSchedule(year);
    pending.catch(() => scheduleCache.delete(year));
    scheduleCache.set(year, pending);
  }
  return pending;
}

async function fetchSchedule(year: number): Promise<Event[]> {
  const ttl = year < new Date().getUTCFullYear() ? undefined : SCHEDULE_TTL;
  const [meetings, sessions] = await Promise.all([
    openf1Get('meetings', { params: { year }, ttl }),
    openf1Get('sessions', { params: { year }, ttl }),
  ]);

  return meetings
    .filter((m) => !m.is_cancelled && !String(m.meeting_name).toLowerCase().includes('testing'))
    .sort((a, b) => String(a.date_start).localeCompare(String(b.date_start)))
    .map((m, i) => ({
      round: i + 1,
      meeting_key: m.meeting_key,
      name: m.meeting_name,
      country: m.country_name,
      location: m.location,
      date_start: m.date_start,
      circuit_key: m.circuit_key,
      circuit_info_url: m.circuit_info_url ?? null,
      year,
      sessions: sessions
        .filter((s) => s.meeting_key === m.meeting_key && SESSION_CODES[s.session_name] && !s.is_cancelled)
        .map((s) => ({
          code: SESSION_CODES[s.session_name],
          name: s.session_name,
          session_key: s.session_key,
          date_start: s.date_start,
          date_end: s.date_end,
        }))
        .sort((a, b) => a.date_start.localeCompare(b.date_start)),
    }));
}

// -- sessions -------------------------------------------------------------------

export interface DriverInfo {
  number: string;
  abbreviation: string;
  name: string;
  team: string;
  team_color: string | null;
}

export interface Telemetry {
  time: number[]; // seconds from lap start
  distance: number[]; // metres
  speed: number[]; // km/h
  throttle: (number | null)[];
  brake: (number | null)[];
  gear: (number | null)[];
}

export interface StartRow {
  driver: string;
  name: string;
  team: string;
  time_to_100: number | null;
  time_to_200: number | null;
}

export class Session {
  code: string;
  name: string;
  sessionKey: number;
  dateStart: number | null;
  dateEnd: number | null;
  isFinal: boolean;
  loadedAt = Date.now();

  laps: Row[] = [];
  lapsByDriver = new Map<number, Row[]>();
  drivers = new Map<number, Row>();
  stints: Row[] = [];
  positions: Row[] = [];
  weather: Row[] = [];
  results: Row[] = [];
  pits: Row[] = [];
  raceControl: Row[] = [];
  overtakes: Row[] = [];
  championshipDrivers: Row[] = [];
  championshipTeams: Row[] = [];
  radio: Row[] = [];

  private ttl: number | undefined;
  private fastestTelemetry?: Promise<[Row, Telemetry | null][]>;
  private startAnalysisResult?: Promise<StartRow[]>;
  private circuit?: Promise<any | null>;

  constructor(public event: Event, info: SessionMeta) {
    this.code = info.code;
    this.name = info.name;
    this.sessionKey = info.session_key;
    this.dateStart = parseDate(info.date_start);
    this.dateEnd = parseDate(info.date_end);
    this.isFinal = this.dateEnd !== null && Date.now() - this.dateEnd > FINAL_AFTER_MS;
    this.ttl = this.isFinal ? undefined : LIVE_TTL;
  }

  private get(endpoint: string, params: Record<string, string | number>, filters?: string[]) {
    return openf1Get(endpoint, { params, filters, ttl: this.ttl });
  }

  async load(): Promise<void> {
    if (this.dateStart !== null && this.dateStart > Date.now()) {
      const start = new Date(this.dateStart).toISOString().slice(0, 16).replace('T', ' ');
      throw new DataError(`${this.event.name} ${this.name} hasn't taken place yet (starts ${start} UTC).`, 503);
    }
    const key = { session_key: this.sessionKey };
    // Laps first: if there are none, don't spend requests on the rest.
    this.laps = (await this.get('laps', key)).filter((l) => l.lap_number != null);
    if (!this.laps.length) {
      throw new DataError(
        `OpenF1 has no lap data for ${this.event.name} ${this.name} yet. ` +
          'Data usually appears shortly after the session ends.',
        503
      );
    }
    const isRace = this.code === 'R' || this.code === 'S';
    const none = Promise.resolve([] as Row[]);
    const [drivers, stints, weather, results, positions, pits, raceControl, overtakes, champDrivers, champTeams, radio] =
      await Promise.all([
        this.get('drivers', key),
        this.get('stints', key),
        this.get('weather', key),
        this.get('session_result', key),
        // Race-only extras: grid positions, pit stops, flags, overtakes, standings
        isRace ? this.get('position', key) : none,
        isRace ? this.get('pit', key) : none,
        this.get('race_control', key),
        isRace ? this.get('overtakes', key) : none,
        isRace ? this.get('championship_drivers', key) : none,
        isRace ? this.get('championship_teams', key) : none,
        this.get('team_radio', key),
      ]);
    drivers.forEach((d) => this.drivers.set(d.driver_number, d));
    this.stints = stints;
    this.positions = positions;
    this.weather = weather;
    this.results = results;
    this.pits = pits;
    this.raceControl = raceControl;
    this.overtakes = overtakes;
    this.championshipDrivers = champDrivers;
    this.championshipTeams = champTeams;
    this.radio = radio;

    this.laps.sort((a, b) => a.driver_number - b.driver_number || a.lap_number - b.lap_number);
    for (const lap of this.laps) {
      const list = this.lapsByDriver.get(lap.driver_number) ?? [];
      list.push(lap);
      this.lapsByDriver.set(lap.driver_number, list);
    }
  }

  // -- drivers --------------------------------------------------------------

  /** Drivers in finishing order when results exist, else by number. */
  driverNumbers(): number[] {
    const order = new Map<number, number>(this.results.map((r) => [r.driver_number, r.position || 99]));
    const numbers = new Set<number>([...this.drivers.keys(), ...this.lapsByDriver.keys()]);
    return [...numbers].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a - b);
  }

  driverInfo(number: number): DriverInfo {
    const d = this.drivers.get(number) ?? {};
    const name = `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim();
    return {
      number: String(number),
      abbreviation: d.name_acronym || String(number),
      name: name || d.full_name || String(number),
      team: d.team_name || 'Unknown',
      team_color: d.team_colour ? `#${d.team_colour}` : null,
    };
  }

  label() {
    return { event_name: this.event.name, year: this.event.year, session_name: this.name };
  }

  // -- laps -----------------------------------------------------------------

  /** Each driver's fastest timed lap, fastest first. */
  fastestLaps(): Row[] {
    const result: Row[] = [];
    for (const laps of this.lapsByDriver.values()) {
      const timed = laps.filter((l) => l.lap_duration);
      if (timed.length) result.push(timed.reduce((a, b) => (b.lap_duration < a.lap_duration ? b : a)));
    }
    return result.sort((a, b) => a.lap_duration - b.lap_duration);
  }

  /** [lap_number, end time ms] for a driver's laps. */
  lapEndTimes(number: number): [number, number][] {
    const laps = this.lapsByDriver.get(number) ?? [];
    const ends: [number, number][] = [];
    laps.forEach((lap, i) => {
      const start = parseDate(lap.date_start);
      let end: number | null = null;
      if (start !== null && lap.lap_duration) end = start + lap.lap_duration * 1000;
      else if (i + 1 < laps.length) end = parseDate(laps[i + 1].date_start);
      if (end !== null) ends.push([lap.lap_number, end]);
    });
    return ends;
  }

  /** [lap_number, position] using the position at the end of each lap. */
  positionsByLap(number: number): [number, number][] {
    const events = this.positions
      .filter((p) => p.driver_number === number)
      .map((p) => [parseDate(p.date) ?? 0, p.position] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    if (!events.length) return [];
    const result: [number, number][] = [];
    for (const [lapNumber, end] of this.lapEndTimes(number)) {
      // last position update at or before the end of the lap
      let lo = 0;
      let hi = events.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid][0] <= end) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) result.push([lapNumber, events[lo - 1][1]]);
    }
    return result;
  }

  /** "driver_number:lap_number" -> compound and tyre age, from stints. */
  compoundByLap(): Map<string, { compound: string; tyre_life: number }> {
    const result = new Map<string, { compound: string; tyre_life: number }>();
    for (const stint of this.stints) {
      const number = stint.driver_number;
      const laps = this.lapsByDriver.get(number) ?? [];
      const start = stint.lap_start;
      const end = stint.lap_end ?? (laps.length ? laps[laps.length - 1].lap_number : start);
      if (start == null || end == null) continue;
      const age = stint.tyre_age_at_start ?? 0;
      for (let lap = start; lap <= end; lap++) {
        result.set(`${number}:${lap}`, {
          compound: stint.compound || 'UNKNOWN',
          tyre_life: age + (lap - start) + 1,
        });
      }
    }
    return result;
  }

  // -- telemetry ------------------------------------------------------------

  /**
   * [lap, telemetry] for each driver's fastest lap, fastest first.
   * One car_data request per driver, so the first call for a session takes a
   * while (rate limit); the shared promise makes charts reuse that work.
   */
  fastestLapTelemetry(): Promise<[Row, Telemetry | null][]> {
    this.fastestTelemetry ??= Promise.all(
      this.fastestLaps().map(async (lap) => [lap, await this.lapTelemetry(lap)] as [Row, Telemetry | null])
    );
    return this.fastestTelemetry;
  }

  private async lapTelemetry(lap: Row): Promise<Telemetry | null> {
    const start = parseDate(lap.date_start);
    if (start === null || !lap.lap_duration) return null;
    const end = start + lap.lap_duration * 1000;
    const rows = (
      await this.get('car_data', { session_key: this.sessionKey, driver_number: lap.driver_number }, [
        `date>=${apiDate(start)}`,
        `date<${apiDate(end)}`,
      ])
    ).filter((r) => r.speed != null);
    if (rows.length < 2) return null;

    const time = rows.map((r) => ((parseDate(r.date) ?? start) - start) / 1000);
    const speed = rows.map((r) => Number(r.speed)); // km/h
    // trapezoidal integration of speed over time = distance in metres
    const distance = [0];
    for (let i = 1; i < rows.length; i++) {
      const avgMs = (speed[i] + speed[i - 1]) / 2 / 3.6;
      distance.push(distance[i - 1] + (time[i] - time[i - 1]) * avgMs);
    }
    return {
      time,
      distance,
      speed,
      throttle: rows.map((r) => r.throttle ?? null),
      brake: rows.map((r) => r.brake ?? null),
      gear: rows.map((r) => r.n_gear ?? null),
    };
  }

  /**
   * Time from launch to 100 and 200 km/h at the race start. Lap 1 date_start
   * is the same for every driver (lights out), so one car_data request for a
   * window around it covers the whole grid.
   */
  startAnalysis(): Promise<StartRow[]> {
    this.startAnalysisResult ??= this.computeStartAnalysis();
    return this.startAnalysisResult;
  }

  private async computeStartAnalysis(): Promise<StartRow[]> {
    const lap1Starts = this.laps
      .filter((l) => l.lap_number === 1)
      .map((l) => parseDate(l.date_start))
      .filter((t): t is number => t !== null);
    if (!lap1Starts.length) return [];
    const lightsOut = Math.min(...lap1Starts);
    const rows = await this.get('car_data', { session_key: this.sessionKey }, [
      `date>=${apiDate(lightsOut - 10_000)}`,
      `date<${apiDate(lightsOut + 25_000)}`,
    ]);

    const byDriver = new Map<number, [number, number][]>();
    for (const r of rows) {
      if (r.speed == null) continue;
      const list = byDriver.get(r.driver_number) ?? [];
      list.push([((parseDate(r.date) ?? lightsOut) - lightsOut) / 1000, Number(r.speed)]);
      byDriver.set(r.driver_number, list);
    }

    const result: StartRow[] = [];
    for (const [number, samples] of byDriver) {
      samples.sort((a, b) => a[0] - b[0]);
      const firstMoving = samples.findIndex(([, v]) => v > 10);
      if (firstMoving <= 0) continue;
      // launch = last stationary sample before the car starts moving
      const launch = samples[firstMoving - 1][0];
      const info = this.driverInfo(number);
      result.push({
        driver: info.abbreviation,
        name: info.name,
        team: info.team,
        time_to_100: timeToReach(samples, 100, launch),
        time_to_200: timeToReach(samples, 200, launch),
      });
    }
    return result.sort(
      (a, b) =>
        Number(a.time_to_100 === null) - Number(b.time_to_100 === null) ||
        (a.time_to_100 ?? 0) - (b.time_to_100 ?? 0)
    );
  }

  // -- circuit --------------------------------------------------------------

  /** Track outline, rotation and corners from MultiViewer (what FastF1 uses). */
  circuitInfo(): Promise<any | null> {
    const url =
      this.event.circuit_info_url ??
      `https://api.multiviewer.app/api/v1/circuits/${this.event.circuit_key}/${this.event.year}`;
    this.circuit ??= getJson(url).catch((e) => {
      console.error(`Circuit info error for ${url}`, e);
      return null;
    });
    return this.circuit;
  }
}

function timeToReach(samples: [number, number][], target: number, launch: number): number | null {
  const i = samples.findIndex(([, v]) => v >= target);
  if (i <= 0) return null;
  const [t0, v0] = samples[i - 1];
  const [t1, v1] = samples[i];
  // interpolate between the samples either side of the target speed
  const tCross = t0 + ((target - v0) * (t1 - t0)) / (v1 - v0);
  return Math.round((tCross - launch) * 1000) / 1000;
}

// -- session registry -------------------------------------------------------------

const sessions = new Map<string, Promise<Session>>();

async function findEvent(year: number, round: number): Promise<Event> {
  if (year < FIRST_YEAR) throw new DataError(`Only seasons from ${FIRST_YEAR} onwards are available.`, 404);
  const event = (await getSchedule(year)).find((e) => e.round === round);
  if (!event) throw new DataError(`No round ${round} in ${year}.`, 404);
  return event;
}

/** Load (once) and return a session. Concurrent callers share the load. */
export function loadSession(year: number, round: number, code: string): Promise<Session> {
  code = code.toUpperCase();
  const key = `${year}_${round}_${code}`;
  const existing = sessions.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const event = await findEvent(year, round);
    const info = event.sessions.find((s) => s.code === code);
    if (!info) {
      const available = event.sessions.map((s) => s.name).join(', ') || 'none';
      throw new DataError(`${event.name} ${year} has no ${code} session. Available: ${available}.`, 404);
    }
    const session = new Session(event, info);
    await session.load();
    return session;
  })();
  sessions.set(key, pending);
  pending.then(
    (session) => {
      // Sessions that may still change are reloaded after a couple of minutes.
      if (!session.isFinal) setTimeout(() => sessions.delete(key), LIVE_TTL * 1000);
    },
    () => sessions.delete(key) // retry on the next request
  );
  return pending;
}

/** Drop loaded sessions from memory (the data build calls this between sessions). */
export function clearSessionCache() {
  sessions.clear();
}
