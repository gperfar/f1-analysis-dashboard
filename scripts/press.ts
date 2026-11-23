/**
 * Press coverage for each session, from outlets' public RSS feeds.
 *
 * Feeds only cover the last days or weeks, so every run adds new articles to
 * an archive (press-archive.json) and then assigns each recent session the
 * articles published right after it that are about that race weekend.
 * Only headlines and the feeds' short teasers are stored, with links.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { Article, PRESS_VERSION, SessionPress } from '../src/lib/press';
import { decodeEntities, normalize } from '../src/lib/videos';

const FEEDS = [
  { outlet: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/formula1/rss.xml' },
  { outlet: 'Autosport', url: 'https://www.autosport.com/rss/f1/news/' },
  { outlet: 'Motorsport.com', url: 'https://www.motorsport.com/rss/f1/news/' },
  { outlet: 'Formula1.com', url: 'https://www.formula1.com/en/latest/all.xml' },
  { outlet: 'RaceFans', url: 'https://www.racefans.net/feed/' },
];

const ARCHIVE_DAYS = 400;
/** Sessions keep collecting coverage for this long after they end. */
const COLLECT_FOR_MS = 5 * 24 * 3600_000;
const MAX_ARTICLES = 10;
/** Only sessions this recent get an AI digest. */
const AI_WINDOW_MS = 30 * 24 * 3600_000;

export interface SessionRef {
  year: number;
  round: number;
  code: string;
  name: string;
  event: string;
  location: string;
  country: string;
  start: number;
  end: number;
  /** Start of the next session of the same weekend, if any. */
  nextStart: number | null;
}

function text(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teaser(description: string): string {
  if (description.length <= 220) return description;
  const cut = description.slice(0, 220);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

async function fetchFeed(feed: { outlet: string; url: string }): Promise<Article[]> {
  const response = await fetch(feed.url, { headers: { 'User-Agent': 'f1-charts (+https://github.com)' } });
  if (!response.ok) throw new Error(`${feed.outlet} ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)]
    .map(([, item]) => {
      const date = Date.parse(text(item, 'pubDate') || text(item, 'dc:date'));
      return {
        outlet: feed.outlet,
        title: text(item, 'title'),
        teaser: teaser(text(item, 'description')),
        url: text(item, 'link') || (item.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? ''),
        published: Number.isNaN(date) ? '' : new Date(date).toISOString(),
      };
    })
    .filter((a) => a.title && a.url.startsWith('http') && a.published);
}

/** Words that tie an article to a race weekend. */
function eventTerms(s: SessionRef): string[] {
  const words = [s.event.replace(/grand prix/i, ''), s.location, s.country].map(normalize).filter((w) => w.length > 2);
  const extra: Record<string, string[]> = { brazil: ['interlagos'], 'united states': ['austin', 'cota'], mexico: ['mexico'], italy: ['monza', 'imola'], 'united kingdom': ['silverstone'], 'great britain': ['silverstone'], belgium: ['spa'], netherlands: ['zandvoort'], monaco: ['monaco'], japan: ['suzuka'], azerbaijan: ['baku'], 'saudi arabia': ['jeddah'], 'united arab emirates': ['abu dhabi', 'yas'], qatar: ['lusail'], hungary: ['hungaroring'], spain: ['barcelona', 'madrid'], canada: ['montreal'], singapore: ['marina bay'], australia: ['melbourne', 'albert park'], china: ['shanghai'], austria: ['red bull ring', 'spielberg'], bahrain: ['sakhir'] };
  return [...new Set([...words, ...(extra[normalize(s.country)] ?? [])])];
}

const SESSION_WORDS: Record<string, RegExp> = {
  R: /\b(race|wins?|won|victory|podium|grand prix|result|retire|penalt)/,
  S: /\bsprint\b/,
  Q: /\b(qualifying|pole|grid|q1|q2|q3|quali)/,
  SQ: /\b(sprint qualifying|sprint shootout|sprint pole)/,
  FP1: /\b(practice|fp1)\b/,
  FP2: /\b(practice|fp2)\b/,
  FP3: /\b(practice|fp3)\b/,
};

/** Articles about this session: published after it, before the next one, mentioning the weekend. */
export function matchArticles(session: SessionRef, articles: Article[]): Article[] {
  const from = session.end - 30 * 60_000;
  const to = Math.min(session.nextStart ?? Infinity, session.end + (session.code === 'R' ? 72 : 30) * 3600_000);
  const terms = eventTerms(session);
  const words = SESSION_WORDS[session.code];
  return articles
    .filter((a) => {
      const t = Date.parse(a.published);
      return t >= from && t <= to;
    })
    .map((a) => {
      const haystack = normalize(`${a.title} ${a.teaser}`);
      const score = (terms.some((w) => haystack.includes(w)) ? 3 : 0) + (words?.test(haystack) ? 2 : 0);
      return { a, score };
    })
    .filter((x) => x.score >= 3)
    .sort((x, y) => y.score - x.score || Date.parse(y.a.published) - Date.parse(x.a.published))
    .slice(0, MAX_ARTICLES)
    .map((x) => x.a);
}

async function digest(session: SessionRef, articles: Article[]): Promise<string | null> {
  const client = new Anthropic();
  const list = articles.map((a, i) => `${i + 1}. [${a.outlet}] ${a.title}${a.teaser ? ` — ${a.teaser}` : ''}`).join('\n');
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 3000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'You summarise how the press covered a Formula 1 session, for a data dashboard. Use only the headlines and teasers given: never add facts, quotes or causes that are not in them. Write one paragraph of 50-90 words in plain British English, naming outlets in parentheses where a point comes from one, e.g. "(Autosport)". No headings, lists or markdown.',
    messages: [{ role: 'user', content: `${session.event} ${session.year}, ${session.name}. Coverage:\n${list}\n\nWhat did the press focus on?` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const out = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return out || null;
}

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

export async function collectPress(out: string, sessions: SessionRef[]): Promise<{ archived: number; sessions: number }> {
  const archivePath = join(out, 'press-archive.json');
  const archive = (await readJson<{ version: number; articles: Article[] }>(archivePath)) ?? { version: PRESS_VERSION, articles: [] };
  const byUrl = new Map(archive.articles.map((a) => [a.url, a]));
  for (const feed of FEEDS) {
    try {
      (await fetchFeed(feed)).forEach((a) => byUrl.has(a.url) || byUrl.set(a.url, a));
    } catch (e) {
      console.warn(`  press feed failed: ${(e as Error).message}`);
    }
  }
  const cutoff = Date.now() - ARCHIVE_DAYS * 24 * 3600_000;
  const articles = [...byUrl.values()].filter((a) => Date.parse(a.published) >= cutoff).sort((a, b) => b.published.localeCompare(a.published));
  await writeJson(archivePath, { version: PRESS_VERSION, articles });

  const oldest = articles.length ? Date.parse(articles[articles.length - 1].published) : Date.now();
  const withAi = !!process.env.ANTHROPIC_API_KEY;
  let updated = 0;
  for (const session of sessions) {
    // only sessions the archive covers, and only while coverage is still coming in (or the file is missing)
    if (session.end < oldest) continue;
    const path = join(out, String(session.year), String(session.round), `${session.code}.press.json`);
    const existing = await readJson<SessionPress>(path);
    const recent = Date.now() - session.end < COLLECT_FOR_MS;
    const aiWanted = withAi && Date.now() - session.end < AI_WINDOW_MS;
    if (existing?.version === PRESS_VERSION && !recent && (existing.digest || !aiWanted || !existing.articles.length)) continue;

    const matched = matchArticles(session, articles);
    if (!matched.length && !existing) continue;
    const press: SessionPress = { version: PRESS_VERSION, builtAt: new Date().toISOString(), articles: matched };
    const sameArticles = existing?.articles.map((a) => a.url).join() === matched.map((a) => a.url).join();
    if (existing?.digest && sameArticles) press.digest = existing.digest;
    else if (aiWanted && matched.length >= 3) {
      try {
        press.digest = (await digest(session, matched)) ?? undefined;
      } catch (e) {
        console.warn(`  press digest failed for ${session.year} R${session.round} ${session.code}: ${(e as Error).message}`);
      }
    }
    await writeJson(path, press);
    updated++;
  }
  return { archived: articles.length, sessions: updated };
}
