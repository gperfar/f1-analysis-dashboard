/**
 * "Key moments" of a race: the handful of events that tell it at a glance
 * (lead changes, safety cars, penalties, retirements, weather calls, passes
 * for the podium, the fastest lap). Derived from the story data only.
 */

import type { SessionStory } from './story';
import { formatTime, onTrackOvertakes } from './narrative';

export type MomentType = 'start' | 'lead' | 'sc' | 'vsc' | 'red' | 'penalty' | 'retirement' | 'weather' | 'pass' | 'fastest' | 'finish';

export interface Moment {
  lap: number;
  type: MomentType;
  title: string;
  detail?: string;
  drivers: number[];
}

/** Lower = more important; used to trim the list. */
const priority: Record<MomentType, number> = {
  start: 0, finish: 0, red: 1, lead: 2, sc: 3, retirement: 4, penalty: 5, weather: 5, vsc: 6, pass: 7, fastest: 8,
};

const WET = new Set(['INTERMEDIATE', 'WET']);
const MAX_MOMENTS = 14;

export function keyMoments(story: SessionStory): Moment[] {
  if (story.meta.kind !== 'race') return [];
  const drivers = new Map(story.drivers.map((d) => [d.number, d]));
  const code = (n: number) => drivers.get(n)?.code ?? String(n);
  const moments: Moment[] = [];
  const totalLaps = story.meta.totalLaps;

  // Who led each lap
  const leaderByLap = new Map<number, number>();
  for (const s of story.laps) s.position.forEach((p, i) => p === 1 && leaderByLap.set(s.lap[i], s.driver));
  const pitted = new Set(story.pits.flatMap((p) => [`${p.driver}:${p.lap}`, `${p.driver}:${p.lap + 1}`]));

  // Start
  const pole = story.classification.find((r) => r.grid === 1)?.driver;
  const lap1Leader = leaderByLap.get(1);
  const gains = story.start.filter((s) => s.grid && s.afterLap1).map((s) => ({ d: s.driver, g: s.grid! - s.afterLap1! })).sort((a, b) => b.g - a.g);
  if (lap1Leader !== undefined) {
    const detail = [
      pole !== undefined && pole !== lap1Leader ? `${code(lap1Leader)} beats polesitter ${code(pole)} into the lead` : `${code(lap1Leader)} keeps the lead`,
      gains[0]?.g >= 3 ? `${code(gains[0].d)} gains ${gains[0].g} places` : null,
    ].filter(Boolean).join(' · ');
    moments.push({ lap: 1, type: 'start', title: 'Lights out', detail, drivers: [lap1Leader] });
  }

  // Lead changes
  let previous = lap1Leader;
  for (let lap = 2; lap <= totalLaps; lap++) {
    const leader = leaderByLap.get(lap);
    if (leader === undefined || previous === undefined || leader === previous) {
      previous = leader ?? previous;
      continue;
    }
    const viaPits = pitted.has(`${previous}:${lap}`) || pitted.has(`${previous}:${lap - 1}`);
    moments.push({
      lap,
      type: 'lead',
      title: `${code(leader)} takes the lead`,
      detail: viaPits ? `as ${code(previous)} pits` : `from ${code(previous)}`,
      drivers: [leader, previous],
    });
    previous = leader;
  }

  // Safety cars, VSCs, red flags
  for (const p of story.periods) {
    const lap = Math.max(1, Math.ceil(p.start));
    const laps = Math.max(1, Math.round(p.end - p.start));
    const type = p.type === 'SC' ? 'sc' : p.type === 'VSC' ? 'vsc' : 'red';
    const title = p.type === 'SC' ? 'Safety car' : p.type === 'VSC' ? 'Virtual safety car' : 'Red flag';
    moments.push({ lap, type, title, detail: p.type === 'RED' ? 'Race suspended' : `${laps} lap${laps > 1 ? 's' : ''}`, drivers: [] });
  }

  // Penalties handed out (not "served")
  for (const m of story.messages ?? []) {
    if (m.kind !== 'penalty' || /SERVED/i.test(m.text) || !m.lap) continue;
    const what = m.text.toUpperCase().match(/\d+ SECOND TIME PENALTY|DRIVE THROUGH|STOP AND GO|GRID PENALTY|DISQUALIFIED/)?.[0];
    const reason = m.text.split(' - ').slice(1).join(' - ').replace(/\s*\(\d{2}:\d{2}:\d{2}\)\s*$/, '');
    moments.push({
      lap: m.lap,
      type: 'penalty',
      title: `${m.drivers.map(code).join(', ')} penalised`,
      detail: [what?.toLowerCase(), reason.toLowerCase()].filter(Boolean).join(' · '),
      drivers: m.drivers,
    });
  }

  // Retirements: last lap of drivers who didn't finish
  for (const r of story.classification.filter((x) => x.status === 'DNF')) {
    const s = story.laps.find((x) => x.driver === r.driver);
    const lap = s?.lap[s.lap.length - 1] ?? r.laps;
    if (lap) moments.push({ lap, type: 'retirement', title: `${code(r.driver)} retires`, detail: `after ${lap} lap${lap > 1 ? 's' : ''}`, drivers: [r.driver] });
  }

  // Weather calls: several drivers switching to or from wet tyres on the same lap
  const switches = new Map<string, number[]>();
  for (const st of story.stints) {
    if (st.from <= 1) continue;
    const before = story.stints.find((x) => x.driver === st.driver && x.to === st.from - 1);
    if (!before) continue;
    const toWet = WET.has(st.compound) && !WET.has(before.compound);
    const toDry = !WET.has(st.compound) && WET.has(before.compound);
    if (!toWet && !toDry) continue;
    const key = `${toWet ? 'wet' : 'dry'}:${st.from}`;
    switches.set(key, [...(switches.get(key) ?? []), st.driver]);
  }
  const lastByKind = new Map<string, number>();
  for (const [key, list] of [...switches].sort((a, b) => Number(a[0].split(':')[1]) - Number(b[0].split(':')[1]))) {
    const [kind, lapText] = key.split(':');
    const lap = Number(lapText);
    // One moment per wave of switches: skip laps close to one already reported.
    if (lap - (lastByKind.get(kind) ?? -99) <= 4) continue;
    const near = [...switches].filter(([k]) => k.startsWith(kind) && Math.abs(Number(k.split(':')[1]) - lap) <= 4).flatMap(([, l]) => l);
    if (near.length < 3) continue;
    lastByKind.set(kind, lap);
    moments.push({
      lap,
      type: 'weather',
      title: kind === 'wet' ? 'Switch to wet tyres' : 'Back on slicks',
      detail: `${near.length} drivers within a few laps, first ${list.map(code).slice(0, 3).join(', ')}`,
      drivers: list.slice(0, 3),
    });
  }

  // On-track passes for a podium place
  for (const o of onTrackOvertakes(story)) {
    if (o.position > 3 || o.lap === null) continue;
    moments.push({ lap: o.lap, type: 'pass', title: `${code(o.by)} passes ${code(o.on)}`, detail: `for P${o.position}`, drivers: [o.by, o.on] });
  }

  const fastest = story.fastest[0];
  if (fastest) moments.push({ lap: fastest.lap, type: 'fastest', title: 'Fastest lap', detail: `${code(fastest.driver)}, ${formatTime(fastest.time)}`, drivers: [fastest.driver] });

  const winner = story.classification[0];
  if (winner?.position === 1 && totalLaps) {
    const second = story.classification[1];
    moments.push({
      lap: totalLaps,
      type: 'finish',
      title: `${code(winner.driver)} wins`,
      detail: typeof second?.gap === 'number' ? `by ${second.gap.toFixed(1)}s from ${code(second.driver)}` : undefined,
      drivers: [winner.driver],
    });
  }

  // Keep the most important ones, then show them in lap order.
  const kept = moments
    .map((m, i) => ({ m, i }))
    .sort((a, b) => priority[a.m.type] - priority[b.m.type] || a.i - b.i)
    .slice(0, MAX_MOMENTS)
    .map(({ m }) => m);
  return kept.sort((a, b) => a.lap - b.lap || priority[a.type] - priority[b.type]);
}
