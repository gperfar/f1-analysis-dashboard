/**
 * Turns a loaded session into a `SessionStory`: one plain-JSON object with
 * everything the session page needs (classification, laps, stints, pit
 * stops, flag periods, standings, circuit...). Telemetry is separate
 * (`TelemetrySet`) because it's the slow part to download.
 *
 * The same code runs in the browser (live, from OpenF1) and in the Node
 * build script that pre-computes stories for GitHub Pages.
 */

import { loadSession, parseDate, Session, getSchedule, FIRST_YEAR, Event } from './f1data';
import { openf1Get, Row } from './openf1';
import { buildNarrative, Headline } from './narrative';

export const STORY_VERSION = 2;
/** Telemetry files have their own version, so story changes don't force re-downloading them. */
export const TELEMETRY_VERSION = 1;

export type SessionKind = 'race' | 'qualifying' | 'practice';

export function kindOf(code: string): SessionKind {
  const c = code.toUpperCase();
  if (c === 'R' || c === 'S') return 'race';
  if (c === 'Q' || c === 'SQ') return 'qualifying';
  return 'practice';
}

export interface DriverRef {
  number: number;
  code: string;
  name: string;
  team: string;
  color: string;
  /** Second driver of a team: drawn dashed so teammates can be told apart. */
  dashed: boolean;
  headshot: string | null;
}

export interface ClassificationRow {
  driver: number;
  position: number | null;
  status: 'Finished' | 'DNF' | 'DNS' | 'DSQ' | 'NC';
  laps: number;
  /** Race: total time; qualifying: [Q1, Q2, Q3] best laps. */
  time: number | null;
  qTimes: (number | null)[] | null;
  gap: number | string | null;
  points: number | null;
  grid: number | null;
}

/** Per-driver lap data as parallel arrays (compact JSON). */
export interface LapSeries {
  driver: number;
  lap: number[];
  time: (number | null)[];
  /** Seconds from the first lap's start (lights out in a race). */
  end: (number | null)[];
  compound: (string | null)[];
  tyreAge: (number | null)[];
  pitOut: boolean[];
  pitIn: boolean[];
  /** Race only: position and gap to leader at the end of each lap. */
  position: (number | null)[];
  gap: (number | null)[];
  s1: (number | null)[];
  s2: (number | null)[];
  s3: (number | null)[];
  /** Speed trap, km/h. */
  trap: (number | null)[];
}

export interface Stint {
  driver: number;
  stint: number;
  compound: string;
  from: number;
  to: number;
  ageAtStart: number;
}

export interface PitStop {
  driver: number;
  lap: number;
  /** Stationary time, seconds (may be missing). */
  stop: number | null;
  /** Time in the pit lane, seconds. */
  lane: number | null;
}

export interface FlagPeriod {
  type: 'SC' | 'VSC' | 'RED';
  /** Fractional lap numbers on the leader's timeline. */
  start: number;
  end: number;
}

export interface FastestLap {
  driver: number;
  lap: number;
  time: number;
  sectors: (number | null)[];
  compound: string | null;
}

export interface StartRow {
  driver: number;
  grid: number | null;
  afterLap1: number | null;
  timeTo100: number | null;
  timeTo200: number | null;
}

export interface StandingRow {
  driver?: number;
  team?: string;
  positionBefore: number | null;
  positionAfter: number | null;
  pointsBefore: number | null;
  pointsAfter: number | null;
}

export interface RadioClip {
  driver: number;
  /** Seconds from `meta.t0`. */
  t: number;
  /** Lap (fractional) on the leader's timeline; races only. */
  lap: number | null;
  url: string;
}

export type MessageKind = 'penalty' | 'investigation' | 'track-limits' | 'flag' | 'conditions' | 'other';

export interface RaceControlMessage {
  t: number;
  lap: number | null;
  kind: MessageKind;
  text: string;
  /** Drivers named in the message. */
  drivers: number[];
  flag: string | null;
}

export interface Circuit {
  x: number[];
  y: number[];
  /** Rotation applied to the raw coordinates (radians), also used for replay positions. */
  rotation: number;
  /** Corner positions; `distance` is metres from the start/finish line. */
  corners: { label: string; x: number; y: number; textX: number; textY: number; distance: number | null }[];
}

export interface SessionStory {
  version: number;
  builtAt: string;
  meta: {
    year: number;
    round: number;
    code: string;
    name: string;
    kind: SessionKind;
    sessionKey: number;
    event: string;
    country: string;
    location: string;
    dateStart: string | null;
    dateEnd: string | null;
    /** Start of lap 1 (lights out in a race); lap `end` times are relative to it. */
    t0: string | null;
    totalLaps: number;
    weather: { air: number | null; track: number | null; humidity: number | null; rain: boolean } | null;
  };
  drivers: DriverRef[];
  classification: ClassificationRow[];
  laps: LapSeries[];
  stints: Stint[];
  pits: PitStop[];
  periods: FlagPeriod[];
  fastest: FastestLap[];
  /** Best individual sectors per driver: the "ideal lap". */
  bestSectors: { driver: number; sectors: (number | null)[]; ideal: number | null }[];
  start: StartRow[];
  overtakes: { lap: number | null; by: number; on: number; position: number }[];
  standings: { drivers: StandingRow[]; teams: StandingRow[] };
  radio: RadioClip[];
  messages: RaceControlMessage[];
  circuit: Circuit | null;
  headlines: Headline[];
  summary: string[];
  /** Optional AI-written recap (only in pre-computed data). */
  aiSummary?: string;
}

export interface TelemetryLap {
  driver: number;
  lap: number;
  lapTime: number;
  time: number[];
  distance: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
}

export interface TelemetrySet {
  version: number;
  drivers: TelemetryLap[];
}

// -- helpers ---------------------------------------------------------------------------

const round3 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 1000);
const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function driverRefs(session: Session, order: number[]): DriverRef[] {
  const seenTeams = new Map<string, number>();
  return order.map((n) => {
    const info = session.driverInfo(n);
    const raw = session.drivers.get(n) ?? {};
    const teamCount = seenTeams.get(info.team) ?? 0;
    seenTeams.set(info.team, teamCount + 1);
    return {
      number: n,
      code: info.abbreviation,
      name: info.name,
      team: info.team,
      color: info.team_color ?? '#888888',
      dashed: teamCount > 0,
      headshot: raw.headshot_url ?? null,
    };
  });
}

function classification(session: Session, kind: SessionKind, grid: Map<number, number>): ClassificationRow[] {
  const rows: ClassificationRow[] = session.results.map((r) => {
    const status: ClassificationRow['status'] = r.dsq ? 'DSQ' : r.dns ? 'DNS' : r.dnf ? 'DNF' : 'Finished';
    const isQuali = Array.isArray(r.duration);
    return {
      driver: r.driver_number,
      position: r.position ?? null,
      status,
      laps: r.number_of_laps ?? 0,
      time: isQuali ? null : round3(r.duration),
      qTimes: isQuali ? r.duration.map((d: number | null) => round3(d)) : null,
      gap: Array.isArray(r.gap_to_leader) ? null : r.gap_to_leader ?? null,
      points: r.points ?? null,
      grid: grid.get(r.driver_number) ?? null,
    };
  });

  if (!rows.length) {
    // No official results (common for practice): order by fastest lap.
    const fastest = session.fastestLaps();
    fastest.forEach((lap, i) =>
      rows.push({
        driver: lap.driver_number,
        position: i + 1,
        status: 'Finished',
        laps: session.lapsByDriver.get(lap.driver_number)?.length ?? 0,
        time: null,
        qTimes: null,
        gap: i === 0 ? 0 : round3(lap.lap_duration - fastest[0].lap_duration),
        points: null,
        grid: null,
      })
    );
  }
  rows.sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  if (kind === 'practice') return rows;
  return rows;
}

/** Grid slots: each driver's first reported position in the session. */
function gridPositions(session: Session): Map<number, number> {
  const first = new Map<number, [number, number]>();
  for (const p of session.positions) {
    const t = parseDate(p.date) ?? 0;
    const current = first.get(p.driver_number);
    if (!current || t < current[0]) first.set(p.driver_number, [t, p.position]);
  }
  return new Map([...first].map(([n, [, pos]]) => [n, pos]));
}

function lapSeries(session: Session, kind: SessionKind, t0: number): LapSeries[] {
  const compounds = session.compoundByLap();
  const pitLaps = new Set(session.pits.map((p) => `${p.driver_number}:${p.lap_number}`));
  const series: LapSeries[] = [];
  const endsByLap = new Map<number, [number, number][]>(); // lap -> [driver, end ms]

  for (const [n, laps] of session.lapsByDriver) {
    const ends = new Map(session.lapEndTimes(n));
    const s: LapSeries = {
      driver: n,
      lap: [], time: [], end: [], compound: [], tyreAge: [], pitOut: [], pitIn: [],
      position: [], gap: [], s1: [], s2: [], s3: [], trap: [],
    };
    for (const lap of laps) {
      const end = ends.get(lap.lap_number) ?? null;
      const tyre = compounds.get(`${n}:${lap.lap_number}`);
      s.lap.push(lap.lap_number);
      s.time.push(round3(lap.lap_duration));
      s.end.push(end === null ? null : round3((end - t0) / 1000));
      s.compound.push(tyre?.compound ?? null);
      s.tyreAge.push(tyre?.tyre_life ?? null);
      s.pitOut.push(!!lap.is_pit_out_lap);
      s.pitIn.push(pitLaps.has(`${n}:${lap.lap_number}`));
      s.position.push(null);
      s.gap.push(null);
      s.s1.push(round3(lap.duration_sector_1));
      s.s2.push(round3(lap.duration_sector_2));
      s.s3.push(round3(lap.duration_sector_3));
      s.trap.push(lap.st_speed ?? null);
      if (end !== null) {
        const list = endsByLap.get(lap.lap_number) ?? [];
        list.push([n, end]);
        endsByLap.set(lap.lap_number, list);
      }
    }
    series.push(s);
  }

  if (kind === 'race') {
    // Race order at the end of each lap = order in which drivers completed it.
    for (const [lapNumber, list] of endsByLap) {
      list.sort((a, b) => a[1] - b[1]);
      const leaderEnd = list[0][1];
      list.forEach(([n, end], i) => {
        const s = series.find((x) => x.driver === n)!;
        const idx = s.lap.indexOf(lapNumber);
        s.position[idx] = i + 1;
        s.gap[idx] = round3((end - leaderEnd) / 1000);
      });
    }
  }
  return series;
}

/** Leader's lap-completion times (ms), index = lap number; [0] = race start. */
function leaderTimeline(session: Session, t0: number): number[] {
  const best = new Map<number, number>();
  for (const n of session.lapsByDriver.keys()) {
    for (const [lap, end] of session.lapEndTimes(n)) {
      if (!best.has(lap) || end < best.get(lap)!) best.set(lap, end);
    }
  }
  const timeline = [t0];
  for (let lap = 1; best.has(lap); lap++) timeline.push(best.get(lap)!);
  return timeline;
}

function toLapFraction(timeline: number[], t: number): number {
  if (t <= timeline[0]) return 0;
  for (let i = 1; i < timeline.length; i++) {
    if (t < timeline[i]) return i - 1 + (t - timeline[i - 1]) / (timeline[i] - timeline[i - 1]);
  }
  return timeline.length - 1;
}

/** Safety car, VSC and red flag periods from race control messages. */
function flagPeriods(session: Session, timeline: number[]): FlagPeriod[] {
  const messages = [...session.raceControl].sort((a, b) => (parseDate(a.date) ?? 0) - (parseDate(b.date) ?? 0));
  const periods: FlagPeriod[] = [];
  const open: Partial<Record<FlagPeriod['type'], number>> = {};
  const close = (type: FlagPeriod['type'], t: number) => {
    if (open[type] === undefined) return;
    const start = toLapFraction(timeline, open[type]!);
    const end = Math.max(start + 0.2, toLapFraction(timeline, t));
    periods.push({ type, start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 });
    delete open[type];
  };

  for (const m of messages) {
    const t = parseDate(m.date);
    if (t === null) continue;
    const text = String(m.message ?? '').toUpperCase();
    if (text.includes('VSC DEPLOYED') || text.includes('VIRTUAL SAFETY CAR DEPLOYED')) open.VSC ??= t;
    else if (text.includes('VSC ENDING') || text.includes('VIRTUAL SAFETY CAR ENDING')) close('VSC', t);
    else if (text.includes('SAFETY CAR DEPLOYED')) open.SC ??= t;
    else if (text.includes('SAFETY CAR IN THIS LAP')) {
      // The SC comes in at the end of the current lap.
      const lap = Math.ceil(toLapFraction(timeline, t));
      close('SC', timeline[Math.min(lap, timeline.length - 1)] ?? t);
    } else if (m.flag === 'RED' || text === 'RED FLAG') open.RED ??= t;
    else if (text.includes('GREEN LIGHT') && open.RED !== undefined) close('RED', t);
  }
  const last = timeline[timeline.length - 1];
  (Object.keys(open) as FlagPeriod['type'][]).forEach((type) => close(type, last));
  return periods.sort((a, b) => a.start - b.start);
}

async function circuit(session: Session): Promise<Circuit | null> {
  const info = await session.circuitInfo();
  if (!info?.x?.length) return null;
  const angle = (Number(info.rotation ?? 0) / 180) * Math.PI;
  const rotate = (x: number, y: number): [number, number] => [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
  const points = (info.x as number[]).map((x, i) => rotate(x, info.y[i]));
  return {
    x: points.map((p) => Math.round(p[0])),
    y: points.map((p) => Math.round(p[1])),
    rotation: angle,
    corners: (info.corners ?? []).map((c: any) => {
      const a = (c.angle / 180) * Math.PI;
      const [px, py] = rotate(c.trackPosition.x, c.trackPosition.y);
      const [tx, ty] = rotate(c.trackPosition.x + 750 * Math.cos(a), c.trackPosition.y + 750 * Math.sin(a));
      return {
        label: `${c.number}${c.letter ?? ''}`,
        x: Math.round(px), y: Math.round(py), textX: Math.round(tx), textY: Math.round(ty),
        // MultiViewer's `length` is the distance along the lap in decimetres
        distance: typeof c.length === 'number' ? Math.round(c.length) / 10 : null,
      };
    }),
  };
}

/** Sort a race control message into a kind, for filtering and colouring. */
export function classifyMessage(m: Row): MessageKind | null {
  const text = String(m.message ?? '').toUpperCase();
  if (m.flag === 'BLUE' || m.flag === 'CLEAR' || text.startsWith('CLEAR IN TRACK SECTOR')) return null; // noise
  if (/BLACK AND WHITE/.test(text)) return 'flag'; // a warning, not a penalty
  if (/PENALTY|DRIVE THROUGH|STOP AND GO|DISQUALIFIED|REPRIMAND|GRID DROP/.test(text)) return 'penalty';
  if (/TRACK LIMITS|DELETED/.test(text)) return 'track-limits';
  if (/INVESTIGAT|NOTED|NO FURTHER|REVIEWED/.test(text)) return 'investigation';
  if (m.category === 'SafetyCar' || m.category === 'Flag' || /RED FLAG|GREEN LIGHT|CHEQUERED|SESSION (STARTED|RESUMED|SUSPENDED)/.test(text)) return 'flag';
  if (/GRIP|RAIN|WET|OVERTAKE (ENABLED|DISABLED)|DRS/.test(text)) return 'conditions';
  return 'other';
}

/** Driver numbers named in a message, e.g. "CARS 87 (BEA) AND 55 (SAI)". */
function driversIn(m: Row): number[] {
  const found = new Set<number>();
  if (typeof m.driver_number === 'number') found.add(m.driver_number);
  for (const match of String(m.message ?? '').matchAll(/(\d{1,2}) \([A-Z]{3}\)/g)) found.add(Number(match[1]));
  return [...found];
}

// -- story -------------------------------------------------------------------------------

export async function buildStory(year: number, round: number, code: string): Promise<SessionStory> {
  const session = await loadSession(year, round, code);
  const kind = kindOf(session.code);

  const lap1 = session.laps.filter((l) => l.lap_number === 1).map((l) => parseDate(l.date_start)).filter((t): t is number => t !== null);
  // Race: lights out (start of lap 1). Other sessions: the session's start time.
  const t0 = kind === 'race' && lap1.length ? Math.min(...lap1) : session.dateStart ?? (lap1.length ? Math.min(...lap1) : 0);

  const grid = kind === 'race' ? gridPositions(session) : new Map<number, number>();
  const classificationRows = classification(session, kind, grid);
  const order = [
    ...classificationRows.map((r) => r.driver),
    ...session.driverNumbers().filter((n) => !classificationRows.some((r) => r.driver === n)),
  ].filter((n) => session.drivers.has(n) || session.lapsByDriver.has(n));
  const drivers = driverRefs(session, order);

  const laps = lapSeries(session, kind, t0);
  const timeline = kind === 'race' ? leaderTimeline(session, t0) : [];
  const periods = kind === 'race' ? flagPeriods(session, timeline) : [];
  const compounds = session.compoundByLap();

  const fastest: FastestLap[] = session.fastestLaps().map((lap) => ({
    driver: lap.driver_number,
    lap: lap.lap_number,
    time: round3(lap.lap_duration)!,
    sectors: [round3(lap.duration_sector_1), round3(lap.duration_sector_2), round3(lap.duration_sector_3)],
    compound: compounds.get(`${lap.driver_number}:${lap.lap_number}`)?.compound ?? null,
  }));

  const bestSectors = [...session.lapsByDriver].map(([n, driverLaps]) => {
    const best = [1, 2, 3].map((i) => {
      const values = driverLaps.map((l) => l[`duration_sector_${i}`]).filter((v): v is number => typeof v === 'number' && v > 0);
      return values.length ? Math.min(...values) : null;
    });
    return {
      driver: n,
      sectors: best.map(round3),
      ideal: best.every((v) => v !== null) ? round3(best.reduce((a, b) => a! + b!, 0)) : null,
    };
  });

  let start: StartRow[] = [];
  if (session.code === 'R') {
    const launches = await session.startAnalysis().catch(() => []);
    start = order.map((n) => {
      const s = laps.find((x) => x.driver === n);
      const launch = launches.find((l) => l.driver === session.driverInfo(n).abbreviation);
      return {
        driver: n,
        grid: grid.get(n) ?? null,
        afterLap1: s && s.lap[0] === 1 ? s.position[0] : null,
        timeTo100: launch?.time_to_100 ?? null,
        timeTo200: launch?.time_to_200 ?? null,
      };
    });
  }

  const weatherValues = (key: string) => session.weather.map((w) => w[key]).filter((v): v is number => typeof v === 'number');
  const mean = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null);

  const story: SessionStory = {
    version: STORY_VERSION,
    builtAt: new Date().toISOString(),
    meta: {
      year,
      round,
      code: session.code,
      name: session.name,
      kind,
      sessionKey: session.sessionKey,
      event: session.event.name,
      country: session.event.country,
      location: session.event.location,
      dateStart: session.dateStart ? new Date(session.dateStart).toISOString() : null,
      dateEnd: session.dateEnd ? new Date(session.dateEnd).toISOString() : null,
      t0: t0 ? new Date(t0).toISOString() : null,
      totalLaps: Math.max(0, ...laps.map((s) => s.lap[s.lap.length - 1] ?? 0)),
      weather: session.weather.length
        ? {
            air: mean(weatherValues('air_temperature')),
            track: mean(weatherValues('track_temperature')),
            humidity: mean(weatherValues('humidity')),
            rain: session.weather.some((w) => w.rainfall > 0),
          }
        : null,
    },
    drivers,
    classification: classificationRows,
    laps,
    stints: session.stints
      .filter((s) => s.lap_start != null)
      .map((s) => ({
        driver: s.driver_number,
        stint: s.stint_number,
        compound: s.compound ?? 'UNKNOWN',
        from: s.lap_start,
        to: s.lap_end ?? s.lap_start,
        ageAtStart: s.tyre_age_at_start ?? 0,
      })),
    pits: session.pits.map((p) => ({
      driver: p.driver_number,
      lap: p.lap_number,
      stop: round3(p.stop_duration),
      lane: round3(p.lane_duration ?? p.pit_duration),
    })),
    periods,
    fastest,
    bestSectors,
    start,
    overtakes: session.overtakes.map((o) => ({
      lap: timeline.length ? Math.ceil(toLapFraction(timeline, parseDate(o.date) ?? 0)) || 1 : null,
      by: o.overtaking_driver_number,
      on: o.overtaken_driver_number,
      position: o.position,
    })),
    standings: {
      drivers: session.championshipDrivers.map((c) => ({
        driver: c.driver_number,
        positionBefore: c.position_start ?? null,
        positionAfter: c.position_current ?? null,
        pointsBefore: c.points_start ?? null,
        pointsAfter: c.points_current ?? null,
      })),
      teams: session.championshipTeams.map((c) => ({
        team: c.team_name,
        positionBefore: c.position_start ?? null,
        positionAfter: c.position_current ?? null,
        pointsBefore: c.points_start ?? null,
        pointsAfter: c.points_current ?? null,
      })),
    },
    radio: session.radio
      .filter((r) => r.recording_url && r.date)
      .map((r) => {
        const at = parseDate(r.date)!;
        return {
          driver: r.driver_number,
          t: Math.round((at - t0) / 100) / 10,
          lap: timeline.length ? Math.round(toLapFraction(timeline, at) * 100) / 100 : null,
          url: r.recording_url,
        };
      })
      .sort((a, b) => a.t - b.t),
    messages: session.raceControl
      .map((m) => ({ m, kind: classifyMessage(m), at: parseDate(m.date) }))
      .filter((x): x is { m: Row; kind: MessageKind; at: number } => x.kind !== null && x.at !== null)
      .sort((a, b) => a.at - b.at)
      .map(({ m, kind, at }) => ({
        t: Math.round((at - t0) / 100) / 10,
        lap: typeof m.lap_number === 'number' ? m.lap_number : null,
        kind,
        text: String(m.message),
        drivers: driversIn(m),
        flag: m.flag ?? null,
      })),
    circuit: await circuit(session),
    headlines: [],
    summary: [],
  };

  const narrative = buildNarrative(story);
  story.headlines = narrative.headlines;
  story.summary = narrative.summary;
  return story;
}

/** Clean racing laps for pace analysis: no lap 1, pit laps, flag periods or outliers. */
export function cleanLaps(story: SessionStory, s: LapSeries): { lap: number; time: number; age: number | null; compound: string | null }[] {
  const flagged = (lap: number) => story.periods.some((p) => lap > Math.floor(p.start) && lap <= Math.ceil(p.end));
  const candidates = s.lap
    .map((lap, i) => ({ lap, time: s.time[i], age: s.tyreAge[i], compound: s.compound[i], pit: s.pitIn[i] || s.pitOut[i] }))
    .filter((l): l is { lap: number; time: number; age: number | null; compound: string | null; pit: boolean } =>
      l.time !== null && l.lap > 1 && !l.pit && !flagged(l.lap));
  const med = median(candidates.map((l) => l.time));
  return candidates
    .filter((l) => med === null || l.time < med * 1.07)
    .map(({ lap, time, age, compound }) => ({ lap, time, age, compound }));
}

export async function buildTelemetry(year: number, round: number, code: string): Promise<TelemetrySet> {
  const session = await loadSession(year, round, code);
  const laps = await session.fastestLapTelemetry();
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    version: STORY_VERSION,
    drivers: laps
      .filter(([, t]) => t)
      .map(([lap, t]) => ({
        driver: lap.driver_number,
        lap: lap.lap_number,
        lapTime: lap.lap_duration,
        time: t!.time.map((v) => Math.round(v * 1000) / 1000),
        distance: t!.distance.map(r1),
        speed: t!.speed.map(Math.round),
        throttle: t!.throttle.map((v) => Math.round(v ?? 0)),
        brake: t!.brake.map((v) => (v ? 1 : 0)),
        gear: t!.gear.map((v) => v ?? 0),
      })),
  };
}

// -- season ------------------------------------------------------------------------------

export interface SeasonEvent {
  round: number;
  name: string;
  country: string;
  location: string;
  dateStart: string;
  dateEnd: string | null;
  sessions: { code: string; name: string; dateStart: string; dateEnd: string; sessionKey: number }[];
  /** Top three of the race, when it has been run. */
  podium: number[];
  pole: number | null;
  sprintWinner: number | null;
}

export interface SeasonStory {
  version: number;
  builtAt: string;
  year: number;
  events: SeasonEvent[];
  drivers: Omit<DriverRef, 'dashed'>[];
  /** Points after each scoring session, in order. */
  standings: {
    labels: { round: number; code: string; event: string }[];
    drivers: { driver: number; points: (number | null)[] }[];
    teams: { team: string; color: string; points: (number | null)[] }[];
  };
}

export async function buildSeason(year: number): Promise<SeasonStory> {
  const events: Event[] = await getSchedule(year);
  if (!events.length || year < FIRST_YEAR) {
    return { version: STORY_VERSION, builtAt: new Date().toISOString(), year, events: [], drivers: [], standings: { labels: [], drivers: [], teams: [] } };
  }
  const keys = events.map((e) => e.meeting_key);
  const range = [`meeting_key>=${Math.min(...keys)}`, `meeting_key<=${Math.max(...keys)}`];
  const ttl = year < new Date().getUTCFullYear() ? undefined : 3600;
  const [results, champDrivers, champTeams, driverRows] = await Promise.all([
    openf1Get('session_result', { filters: [...range, 'position<=3'], ttl }),
    openf1Get('championship_drivers', { filters: range, ttl }),
    openf1Get('championship_teams', { filters: range, ttl }),
    openf1Get('drivers', { filters: range, ttl }),
  ]);

  const sessionCode = new Map<number, { code: string; round: number; event: string }>();
  events.forEach((e) => e.sessions.forEach((s) => sessionCode.set(s.session_key, { code: s.code, round: e.round, event: e.name })));
  const top = (sessionKey: number | undefined, n: number) =>
    results
      .filter((r) => r.session_key === sessionKey && r.position && r.position <= n)
      .sort((a, b) => a.position - b.position)
      .map((r) => r.driver_number as number);

  // Latest info per driver (teams can change mid-season)
  const latest = new Map<number, Row>();
  for (const d of [...driverRows].sort((a, b) => a.session_key - b.session_key)) latest.set(d.driver_number, d);
  const teamColor = new Map<string, string>();
  latest.forEach((d) => d.team_name && d.team_colour && teamColor.set(d.team_name, `#${d.team_colour}`));

  const scoringKeys = [...new Set([...champDrivers, ...champTeams].map((c) => c.session_key as number))]
    .filter((k) => sessionCode.has(k))
    .sort((a, b) => {
      const ea = sessionCode.get(a)!;
      const eb = sessionCode.get(b)!;
      return ea.round - eb.round || (ea.code === 'S' ? -1 : 1) - (eb.code === 'S' ? -1 : 1);
    });

  const pointsFor = <K extends string | number>(rows: Row[], keyOf: (r: Row) => K) => {
    const byKey = new Map<K, (number | null)[]>();
    for (const r of rows) {
      const i = scoringKeys.indexOf(r.session_key);
      if (i < 0) continue;
      const list = byKey.get(keyOf(r)) ?? Array(scoringKeys.length).fill(null);
      list[i] = r.points_current;
      byKey.set(keyOf(r), list);
    }
    // carry points forward through sessions a driver missed
    byKey.forEach((list) => list.forEach((v, i) => (list[i] = v ?? (i ? list[i - 1] : 0))));
    return byKey;
  };

  const driverPoints = pointsFor(champDrivers, (r) => r.driver_number as number);
  const teamPoints = pointsFor(champTeams, (r) => r.team_name as string);
  const last = (l: (number | null)[]) => l[l.length - 1] ?? 0;

  return {
    version: STORY_VERSION,
    builtAt: new Date().toISOString(),
    year,
    events: events.map((e) => {
      const byCode = (code: string) => e.sessions.find((s) => s.code === code)?.session_key;
      return {
        round: e.round,
        name: e.name,
        country: e.country,
        location: e.location,
        dateStart: e.date_start,
        dateEnd: e.sessions.length ? e.sessions[e.sessions.length - 1].date_end : null,
        sessions: e.sessions.map((s) => ({ code: s.code, name: s.name, dateStart: s.date_start, dateEnd: s.date_end, sessionKey: s.session_key })),
        podium: top(byCode('R'), 3),
        pole: top(byCode('Q'), 1)[0] ?? null,
        sprintWinner: top(byCode('S'), 1)[0] ?? null,
      };
    }),
    drivers: [...latest.values()].map((d) => ({
      number: d.driver_number,
      code: d.name_acronym,
      name: `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || d.full_name,
      team: d.team_name,
      color: d.team_colour ? `#${d.team_colour}` : '#888888',
      headshot: d.headshot_url ?? null,
    })),
    standings: {
      labels: scoringKeys.map((k) => sessionCode.get(k)!),
      drivers: [...driverPoints].map(([driver, points]) => ({ driver, points })).sort((a, b) => last(b.points) - last(a.points)),
      teams: [...teamPoints]
        .map(([team, points]) => ({ team, color: teamColor.get(team) ?? '#888888', points }))
        .sort((a, b) => last(b.points) - last(a.points)),
    },
  };
}
