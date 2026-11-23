/**
 * Pre-computes session stories as static JSON for the website, so pages load
 * instantly and visitors don't each hit OpenF1's rate limit.
 *
 *   npx tsx scripts/build-data.ts [--out public/data] [--budget-minutes 40] [--years 2026,2025]
 *
 * Writes, under --out:
 *   {year}/season.json
 *   {year}/{round}/{CODE}.json             (every finished session)
 *   {year}/{round}/{CODE}.telemetry.json   (races, sprints, qualifying)
 *
 * Existing files are kept, so each run only adds what's new; newest sessions
 * are built first. With ANTHROPIC_API_KEY set, race/sprint/qualifying stories
 * from the last 30 days also get an AI-written recap (see ai-summary.ts);
 * older sessions keep the rule-based summary, so back-filling costs nothing.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setResponseStore } from '../src/lib/openf1';
import { clearSessionCache, FIRST_YEAR } from '../src/lib/f1data';
import { buildEnergy, buildPositions, buildSeason, buildStory, buildTelemetry, ENERGY_VERSION, kindOf, POSITIONS_VERSION, SessionStory, STORY_VERSION, TELEMETRY_VERSION } from '../src/lib/story';
import { fsStore } from './fs-store';
import { aiSummary } from './ai-summary';
import { collectVideos } from './videos';
import { collectPress, SessionRef } from './press';
import type { EventRef } from '../src/lib/videos';

const args = new Map<string, string>();
process.argv.slice(2).forEach((a, i, all) => a.startsWith('--') && args.set(a.slice(2), all[i + 1] ?? ''));

const OUT = args.get('out') ?? 'public/data';
const CACHE = args.get('cache') ?? '.openf1-cache';
const BUDGET_MS = Number(args.get('budget-minutes') ?? 40) * 60_000;
const currentYear = new Date().getUTCFullYear();
const YEARS = (args.get('years') ?? '')
  .split(',')
  .filter(Boolean)
  .map(Number);
if (!YEARS.length) for (let y = currentYear; y >= FIRST_YEAR; y--) YEARS.push(y);

// Sessions are final (won't change) this long after they end.
const FINAL_AFTER_MS = 3 * 3600_000;
const TELEMETRY_CODES = new Set(['R', 'S', 'Q', 'SQ']);
// Energy analysis downloads every driver's full car data (~6 MB each), so only races and sprints.
const ENERGY_CODES = new Set(['R', 'S']);
const started = Date.now();
const withAi = !!process.env.ANTHROPIC_API_KEY;
/** Only sessions this recent get AI text (recaps here, digests in press.ts). */
const AI_WINDOW_MS = 30 * 24 * 3600_000;

setResponseStore(fsStore(CACHE));

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

const outOfTime = () => Date.now() - started > BUDGET_MS;

async function main() {
  console.log(`Building data into ${OUT} for ${YEARS.join(', ')} (budget ${BUDGET_MS / 60_000} min, AI recaps ${withAi ? 'on' : 'off'})`);
  const todo: { year: number; round: number; code: string; end: number }[] = [];
  const events: EventRef[] = [];
  const sessionRefs: SessionRef[] = [];

  for (const year of YEARS) {
    if (outOfTime()) break;
    try {
      const season = await buildSeason(year);
      await writeJson(join(OUT, String(year), 'season.json'), season);
      for (const e of season.events) {
        events.push({ year, round: e.round, name: e.name, location: e.location, country: e.country });
        e.sessions.forEach((x, i) => {
          const end = Date.parse(x.dateEnd);
          if (end < Date.now())
            sessionRefs.push({
              year, round: e.round, code: x.code, name: x.name, event: e.name, location: e.location, country: e.country,
              start: Date.parse(x.dateStart), end, nextStart: e.sessions[i + 1] ? Date.parse(e.sessions[i + 1].dateStart) : null,
            });
        });
        for (const s of e.sessions) {
          const end = Date.parse(s.dateEnd);
          if (end < Date.now() - FINAL_AFTER_MS) todo.push({ year, round: e.round, code: s.code, end });
        }
      }
      console.log(`✓ ${year} season (${season.events.length} events)`);
    } catch (e) {
      console.warn(`✗ ${year} season: ${(e as Error).message}`);
    }
  }

  todo.sort((a, b) => b.end - a.end); // newest first

  // Official highlight videos (cheap: one feed request, plus searches if YOUTUBE_API_KEY is set)
  try {
    const videos = await collectVideos(join(OUT, 'videos.json'), events, todo.map((s) => `${s.year}/${s.round}/${s.code}`));
    console.log(`✓ videos: ${videos.added} new, ${videos.total} in total${process.env.YOUTUBE_API_KEY ? '' : ' (set YOUTUBE_API_KEY to back-fill older sessions)'}`);
  } catch (e) {
    console.warn(`✗ videos: ${(e as Error).message}`);
  }

  // Press coverage from outlets' RSS feeds (headlines, teasers and links)
  try {
    const press = await collectPress(OUT, sessionRefs);
    console.log(`✓ press: ${press.archived} articles archived, ${press.sessions} sessions updated`);
  } catch (e) {
    console.warn(`✗ press: ${(e as Error).message}`);
  }
  let built = 0;
  let skipped = 0;
  let failed = 0;

  for (const s of todo) {
    if (outOfTime()) {
      console.log('Time budget reached; the rest will be built on the next run.');
      break;
    }
    const base = join(OUT, String(s.year), String(s.round), s.code);
    const label = `${s.year} R${s.round} ${s.code}`;
    try {
      let story = await readJson<SessionStory>(`${base}.json`);
      const needsStory = !story || story.version !== STORY_VERSION;
      const wantsAi = withAi && kindOf(s.code) !== 'practice' && Date.now() - s.end < AI_WINDOW_MS;
      const needsAi = wantsAi && !story?.aiSummary;
      const needsTelemetry =
        TELEMETRY_CODES.has(s.code) && (await readJson<{ version: number }>(`${base}.telemetry.json`))?.version !== TELEMETRY_VERSION;

      const needsEnergy =
        ENERGY_CODES.has(s.code) && (await readJson<{ version: number }>(`${base}.energy.json`))?.version !== ENERGY_VERSION;

      const needsPositions =
        TELEMETRY_CODES.has(s.code) && (await readJson<{ version: number }>(`${base}.positions.json`))?.version !== POSITIONS_VERSION;

      if (!needsStory && !needsAi && !needsTelemetry && !needsEnergy && !needsPositions) {
        skipped++;
        continue;
      }
      if (needsStory) {
        const previousRecap = story?.aiSummary;
        story = await buildStory(s.year, s.round, s.code);
        if (previousRecap) story.aiSummary = previousRecap; // don't pay for it twice
      }
      if (needsAi && story) {
        try {
          const text = await aiSummary(story);
          if (text) story.aiSummary = text;
        } catch (e) {
          console.warn(`  AI recap failed for ${label}: ${(e as Error).message}`);
        }
      }
      if (story && (needsStory || needsAi)) await writeJson(`${base}.json`, story);
      if (needsTelemetry) await writeJson(`${base}.telemetry.json`, await buildTelemetry(s.year, s.round, s.code));
      if (needsEnergy) await writeJson(`${base}.energy.json`, await buildEnergy(s.year, s.round, s.code));
      if (needsPositions) await writeJson(`${base}.positions.json`, await buildPositions(s.year, s.round, s.code));
      built++;
      console.log(`✓ ${label}${story?.aiSummary && needsAi ? ' (+AI recap)' : ''}`);
    } catch (e) {
      failed++;
      console.warn(`✗ ${label}: ${(e as Error).message}`);
    } finally {
      clearSessionCache();
    }
  }

  console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s: ${built} built, ${skipped} up to date, ${failed} failed, ${todo.length - built - skipped - failed} left for later.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
