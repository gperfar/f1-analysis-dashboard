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
 * also get an AI-written recap (see ai-summary.ts).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setResponseStore } from '../src/lib/openf1';
import { clearSessionCache, FIRST_YEAR } from '../src/lib/f1data';
import { buildSeason, buildStory, buildTelemetry, kindOf, SessionStory, STORY_VERSION } from '../src/lib/story';
import { fsStore } from './fs-store';
import { aiSummary } from './ai-summary';

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
const started = Date.now();
const withAi = !!process.env.ANTHROPIC_API_KEY;

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

  for (const year of YEARS) {
    if (outOfTime()) break;
    try {
      const season = await buildSeason(year);
      await writeJson(join(OUT, String(year), 'season.json'), season);
      for (const e of season.events) {
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
      const wantsAi = withAi && kindOf(s.code) !== 'practice';
      const needsAi = wantsAi && !story?.aiSummary;
      const needsTelemetry =
        TELEMETRY_CODES.has(s.code) && (await readJson<{ version: number }>(`${base}.telemetry.json`))?.version !== STORY_VERSION;

      if (!needsStory && !needsAi && !needsTelemetry) {
        skipped++;
        continue;
      }
      if (needsStory) story = await buildStory(s.year, s.round, s.code);
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
