/**
 * Collects official highlight videos for sessions into videos.json.
 *
 * - Always: reads the Formula 1 YouTube channel's public feed (latest ~15
 *   uploads, no key needed). Running every few hours catches new highlights.
 * - With YOUTUBE_API_KEY set: also searches for highlights of older sessions
 *   (YouTube Data API, a limited number per run to stay within the free quota).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodeEntities, EventRef, matchHighlight, SEARCH_LABELS, VideoIndex, VIDEOS_VERSION } from '../src/lib/videos';

const CHANNEL_ID = 'UCB_qr75-ydFVKSF9Dmo6izg'; // Formula 1
const MAX_SEARCHES_PER_RUN = 40; // 100 quota units each; the free daily quota is 10,000

interface Candidate {
  id: string;
  title: string;
  published: string | null;
}

async function feedVideos(): Promise<Candidate[]> {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  if (!response.ok) throw new Error(`YouTube feed ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => ({
    id: entry.match(/<yt:videoId>([^<]+)/)?.[1] ?? '',
    title: decodeEntities(entry.match(/<title>([^<]*)/)?.[1] ?? ''),
    published: entry.match(/<published>([^<]+)/)?.[1] ?? null,
  }));
}

async function searchVideos(query: string, key: string): Promise<Candidate[]> {
  const params = new URLSearchParams({ part: 'snippet', channelId: CHANNEL_ID, q: query, type: 'video', maxResults: '5', key });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!response.ok) throw new Error(`YouTube search ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { items?: { id: { videoId: string }; snippet: { title: string; publishedAt: string } }[] };
  return (data.items ?? []).map((i) => ({ id: i.id.videoId, title: decodeEntities(i.snippet.title), published: i.snippet.publishedAt }));
}

/**
 * Update `path` (videos.json) with any highlights found.
 * `wanted` lists finished sessions ("year/round/CODE"), newest first.
 */
export async function collectVideos(path: string, events: EventRef[], wanted: string[]): Promise<{ added: number; total: number }> {
  let index: VideoIndex = { version: VIDEOS_VERSION, videos: {} };
  try {
    const existing = JSON.parse(await readFile(path, 'utf8')) as VideoIndex;
    if (existing.version === VIDEOS_VERSION) index = existing;
  } catch {
    // first run
  }
  let added = 0;
  const add = (c: Candidate, expected?: string) => {
    const key = matchHighlight(c.title, events);
    if (!key || index.videos[key] || (expected && key !== expected) || !c.id) return false;
    index.videos[key] = { id: c.id, title: c.title, published: c.published };
    added++;
    return true;
  };

  try {
    (await feedVideos()).forEach((c) => add(c));
  } catch (e) {
    console.warn(`  YouTube feed failed: ${(e as Error).message}`);
  }

  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    const byKey = new Map(events.map((e) => [`${e.year}/${e.round}`, e]));
    const missing = wanted.filter((k) => !index.videos[k]).slice(0, MAX_SEARCHES_PER_RUN);
    for (const target of missing) {
      const [year, round, code] = target.split('/');
      const event = byKey.get(`${year}/${round}`);
      if (!event || !SEARCH_LABELS[code]) continue;
      try {
        const results = await searchVideos(`${SEARCH_LABELS[code]} Highlights ${year} ${event.name}`, key);
        results.some((c) => add(c, target));
      } catch (e) {
        console.warn(`  YouTube search failed for ${target}: ${(e as Error).message}`);
        break; // most likely out of quota for today
      }
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index));
  return { added, total: Object.keys(index.videos).length };
}
