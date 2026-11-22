/**
 * Official highlight videos, matched to sessions by title. The F1 YouTube
 * channel names them consistently, e.g. "Race Highlights | 2026 Monaco Grand Prix".
 * The data build collects them into videos.json (see scripts/videos.ts).
 */

export const VIDEOS_VERSION = 1;

export interface VideoRef {
  id: string;
  title: string;
  published: string | null;
}

export interface VideoIndex {
  version: number;
  /** Keyed by "year/round/CODE". */
  videos: Record<string, VideoRef>;
}

export interface EventRef {
  year: number;
  round: number;
  name: string;
  location: string;
  country: string;
}

/** Session label in video titles -> session code. */
const LABELS: Record<string, string> = {
  race: 'R',
  qualifying: 'Q',
  sprint: 'S',
  'sprint qualifying': 'SQ',
  'sprint shootout': 'SQ',
  fp1: 'FP1',
  fp2: 'FP2',
  fp3: 'FP3',
};

export const SEARCH_LABELS: Record<string, string> = { R: 'Race', Q: 'Qualifying', S: 'Sprint', SQ: 'Sprint Qualifying', FP1: 'FP1', FP2: 'FP2', FP3: 'FP3' };

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents: São Paulo -> Sao Paulo
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** "year/round/CODE" for an official highlights title, or null if it isn't one. */
export function matchHighlight(title: string, events: EventRef[]): string | null {
  const m = decodeEntities(title).match(/^(.+?) Highlights \| (\d{4}) (.+?)(?: \|.*)?$/i);
  if (!m) return null;
  const code = LABELS[normalize(m[1])];
  if (!code) return null; // e.g. "F2 Feature Race Highlights"
  const year = Number(m[2]);
  const name = normalize(m[3]);
  const candidates = events.filter((e) => e.year === year);
  const event =
    candidates.find((e) => normalize(e.name) === name) ??
    candidates.find((e) => {
      const n = normalize(e.name);
      return n.includes(name) || name.includes(n) || name.includes(normalize(e.location)) || name.includes(normalize(e.country));
    });
  return event ? `${year}/${event.round}/${code}` : null;
}
