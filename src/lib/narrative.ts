/**
 * Headline facts and a short written summary for a session, derived only from
 * the story data (no AI): who won and by how much, who gained the most, the
 * fastest lap and pit stop, safety cars, championship impact...
 */

import type { SessionStory, DriverRef } from './story';

export interface Headline {
  /** Short label, e.g. "Winner". */
  label: string;
  /** The big value, e.g. "Kimi Antonelli". */
  value: string;
  /** One line of context, e.g. "+14.602s ahead of VER". */
  detail: string;
  /** Driver to colour the card with. */
  driver?: number;
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null) return '–';
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60).toFixed(3).padStart(6, '0');
    return `${h}:${String(m).padStart(2, '0')}:${s}`;
  }
  const m = Math.floor(seconds / 60);
  const s = (seconds - m * 60).toFixed(3).padStart(6, '0');
  return m ? `${m}:${s}` : (seconds).toFixed(3);
}

export const formatGap = (seconds: number) => `+${seconds.toFixed(3)}s`;

const ordinal = (n: number) => `P${n}`;

export function buildNarrative(story: SessionStory): { headlines: Headline[]; summary: string[] } {
  const byNumber = new Map(story.drivers.map((d) => [d.number, d]));
  const driver = (n: number | undefined | null): DriverRef | undefined => (n == null ? undefined : byNumber.get(n));
  const name = (n: number | undefined | null) => driver(n)?.name ?? `#${n}`;
  const code = (n: number | undefined | null) => driver(n)?.code ?? `#${n}`;
  const where = `${story.meta.event}${story.meta.code === 'R' ? '' : ` ${story.meta.name}`}`;

  if (story.meta.kind === 'race') return raceNarrative();
  if (story.meta.kind === 'qualifying') return qualifyingNarrative();
  return practiceNarrative();

  function raceNarrative() {
    const headlines: Headline[] = [];
    const summary: string[] = [];
    const finished = story.classification.filter((r) => r.position !== null);
    const [p1, p2, p3] = finished;

    if (p1) {
      const margin = typeof p2?.gap === 'number' ? p2.gap : null;
      headlines.push({
        label: 'Winner',
        value: name(p1.driver),
        detail: margin !== null ? `${formatGap(margin)} ahead of ${code(p2!.driver)}` : driver(p1.driver)?.team ?? '',
        driver: p1.driver,
      });
      let sentence = `${name(p1.driver)} won the ${where}`;
      if (p1.grid) sentence += p1.grid === 1 ? ' from pole position' : ` from ${ordinal(p1.grid)} on the grid`;
      if (margin !== null && p2) sentence += `, ${margin.toFixed(1)}s ahead of ${name(p2.driver)}`;
      sentence += p3 ? `, with ${name(p3.driver)} completing the podium.` : '.';
      summary.push(sentence);
    }

    // Biggest gain from grid to finish
    const movers = story.classification
      .filter((r) => r.grid && r.position)
      .map((r) => ({ driver: r.driver, gain: r.grid! - r.position!, grid: r.grid!, finish: r.position! }))
      .sort((a, b) => b.gain - a.gain);
    if (movers[0]?.gain > 0) {
      const m = movers[0];
      headlines.push({ label: 'Biggest climb', value: `+${m.gain} places`, detail: `${code(m.driver)}: ${ordinal(m.grid)} → ${ordinal(m.finish)}`, driver: m.driver });
      summary.push(`${name(m.driver)} made the biggest climb, from ${ordinal(m.grid)} to ${ordinal(m.finish)}.`);
    }
    const loser = movers[movers.length - 1];
    if (loser && loser.gain <= -4) summary.push(`${name(loser.driver)} had a day to forget, dropping from ${ordinal(loser.grid)} to ${ordinal(loser.finish)}.`);

    const fastest = story.fastest[0];
    if (fastest) {
      headlines.push({ label: 'Fastest lap', value: formatTime(fastest.time), detail: `${code(fastest.driver)} on lap ${fastest.lap}${fastest.compound ? ` (${fastest.compound.toLowerCase()})` : ''}`, driver: fastest.driver });
    }

    const stops = story.pits.filter((p) => p.stop && p.stop > 1.5).sort((a, b) => a.stop! - b.stop!);
    if (stops[0]) {
      headlines.push({ label: 'Fastest pit stop', value: `${stops[0].stop!.toFixed(1)}s`, detail: `${driver(stops[0].driver)?.team ?? ''} (${code(stops[0].driver)}), lap ${stops[0].lap}`, driver: stops[0].driver });
    }

    const sc = story.periods.filter((p) => p.type === 'SC').length;
    const vsc = story.periods.filter((p) => p.type === 'VSC').length;
    const red = story.periods.filter((p) => p.type === 'RED').length;
    const neutralised = [red && `${red} red flag${red > 1 ? 's' : ''}`, sc && `${sc} safety car${sc > 1 ? 's' : ''}`, vsc && `${vsc} virtual safety car${vsc > 1 ? 's' : ''}`].filter(Boolean) as string[];
    headlines.push({
      label: 'Interruptions',
      value: neutralised.length ? neutralised.join(', ') : 'None',
      detail: neutralised.length ? `First at lap ${Math.ceil(story.periods[0].start) || 1}` : 'Green flag all the way',
    });
    if (neutralised.length) summary.push(`The race was neutralised by ${listJoin(neutralised)}.`);

    const totalStops = story.pits.length;
    const winnerStops = p1 ? story.pits.filter((p) => p.driver === p1.driver).length : 0;
    if (totalStops) summary.push(`There were ${totalStops} pit stops in total${p1 ? `; the winner stopped ${winnerStops === 1 ? 'once' : `${winnerStops} times`}` : ''}.`);

    const onTrack = onTrackOvertakes(story);
    if (onTrack.length) {
      const counts = new Map<number, number>();
      onTrack.forEach((o) => counts.set(o.by, (counts.get(o.by) ?? 0) + 1));
      const [topBy, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
      headlines.push({ label: 'Overtakes', value: String(onTrack.length), detail: topBy ? `On track after lap 1 · most: ${code(topBy)} (${topCount})` : 'On track after lap 1', driver: topBy });
    }

    const weather = story.meta.weather;
    if (weather?.rain) summary.push('Rain fell at some point during the race.');

    // Championship impact
    const leaderAfter = story.standings.drivers.find((s) => s.positionAfter === 1);
    const secondAfter = story.standings.drivers.find((s) => s.positionAfter === 2);
    if (leaderAfter && secondAfter && leaderAfter.pointsAfter != null && secondAfter.pointsAfter != null) {
      const lead = leaderAfter.pointsAfter - secondAfter.pointsAfter;
      const changed = leaderAfter.positionBefore !== 1;
      headlines.push({
        label: 'Championship',
        value: `${code(leaderAfter.driver)} leads by ${lead}`,
        detail: changed ? `New leader (was ${ordinal(leaderAfter.positionBefore ?? 0)})` : `${leaderAfter.pointsAfter} pts vs ${code(secondAfter.driver)} ${secondAfter.pointsAfter}`,
        driver: leaderAfter.driver,
      });
      summary.push(
        changed
          ? `${name(leaderAfter.driver)} takes the championship lead, ${lead} points ahead of ${name(secondAfter.driver)}.`
          : `${name(leaderAfter.driver)} leads the championship by ${lead} points over ${name(secondAfter.driver)}.`
      );
    }
    return { headlines, summary };
  }

  function qualifyingNarrative() {
    const headlines: Headline[] = [];
    const summary: string[] = [];
    const rows = story.classification.filter((r) => r.position !== null);
    const best = (r: (typeof rows)[number]) => {
      const t = r.qTimes?.filter((v): v is number => v !== null) ?? [];
      return t.length ? t[t.length - 1] : null;
    };
    const [p1, p2] = rows;
    if (p1) {
      const t1 = best(p1);
      const t2 = p2 ? best(p2) : null;
      const margin = t1 !== null && t2 !== null ? t2 - t1 : null;
      headlines.push({ label: story.meta.code === 'SQ' ? 'Sprint pole' : 'Pole position', value: name(p1.driver), detail: `${formatTime(t1)}${margin !== null ? ` · ${formatGap(margin)} to ${code(p2!.driver)}` : ''}`, driver: p1.driver });
      summary.push(`${name(p1.driver)} took ${story.meta.code === 'SQ' ? 'sprint pole' : 'pole'} at the ${story.meta.event} with a ${formatTime(t1)}${margin !== null ? `, ${margin.toFixed(3)}s clear of ${name(p2!.driver)}` : ''}.`);
    }
    const front = rows.slice(0, 10).map((r) => driver(r.driver)?.team);
    const teamCounts = new Map<string, number>();
    front.forEach((t) => t && teamCounts.set(t, (teamCounts.get(t) ?? 0) + 1));
    const lockout = rows[0] && rows[1] && driver(rows[0].driver)?.team === driver(rows[1].driver)?.team;
    if (lockout) summary.push(`${driver(rows[0].driver)?.team} locked out the front row.`);

    // Who left the most time on the table (best lap vs ideal lap) in the top 10
    const lost = rows.slice(0, 10)
      .map((r) => {
        const ideal = story.bestSectors.find((b) => b.driver === r.driver)?.ideal;
        const fast = story.fastest.find((f) => f.driver === r.driver)?.time;
        return { driver: r.driver, lost: ideal && fast ? fast - ideal : null };
      })
      .filter((x): x is { driver: number; lost: number } => x.lost !== null)
      .sort((a, b) => b.lost - a.lost);
    if (lost[0] && lost[0].lost > 0.05) {
      headlines.push({ label: 'Most left on the table', value: `${lost[0].lost.toFixed(3)}s`, detail: `${code(lost[0].driver)}: best lap vs best sectors`, driver: lost[0].driver });
    }

    const knockedQ1 = rows.filter((r) => (r.qTimes?.filter((v) => v !== null).length ?? 0) === 1);
    if (knockedQ1.length && story.meta.code === 'Q') summary.push(`Out in Q1: ${listJoin(knockedQ1.map((r) => code(r.driver)))}.`);
    return { headlines, summary };
  }

  function practiceNarrative() {
    const headlines: Headline[] = [];
    const summary: string[] = [];
    const [f1, f2] = story.fastest;
    if (f1) {
      headlines.push({ label: 'Fastest', value: name(f1.driver), detail: `${formatTime(f1.time)}${f2 ? ` · ${formatGap(f2.time - f1.time)} to ${code(f2.driver)}` : ''}`, driver: f1.driver });
      summary.push(`${name(f1.driver)} topped ${story.meta.name} at the ${story.meta.event} with a ${formatTime(f1.time)}.`);
    }
    const mostLaps = [...story.laps].sort((a, b) => b.lap.length - a.lap.length)[0];
    if (mostLaps) headlines.push({ label: 'Most laps', value: String(mostLaps.lap.length), detail: name(mostLaps.driver), driver: mostLaps.driver });
    const totalLaps = story.laps.reduce((sum, s) => sum + s.lap.length, 0);
    summary.push(`${story.laps.length} drivers completed ${totalLaps} laps between them.`);
    return { headlines, summary };
  }
}

/**
 * OpenF1 "overtakes" are position swaps, including ones caused by pit stops.
 * Keep only real on-track passes: after lap 1, and not on a lap where the
 * passed car was pitting (or just leaving the pits).
 */
export function onTrackOvertakes(story: SessionStory) {
  const pitting = new Set<string>();
  for (const s of story.laps) {
    s.lap.forEach((lap, i) => {
      if (s.pitIn[i] || s.pitOut[i]) {
        pitting.add(`${s.driver}:${lap}`);
        pitting.add(`${s.driver}:${lap + 1}`);
      }
    });
  }
  for (const p of story.pits) {
    pitting.add(`${p.driver}:${p.lap}`);
    pitting.add(`${p.driver}:${p.lap + 1}`);
  }
  return story.overtakes.filter(
    (o) => o.lap !== null && o.lap > 1 && !pitting.has(`${o.on}:${o.lap}`) && !pitting.has(`${o.by}:${o.lap}`)
  );
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
