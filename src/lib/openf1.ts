/**
 * Browser client for the OpenF1 API (https://openf1.org).
 *
 * Historical data (2023 onwards) is free and needs no account, but OpenF1
 * allows 30 requests per minute per IP and answers a burst over that with
 * a 60-second penalty. This client:
 *
 * - caches responses in the browser (Cache API), so a finished session is
 *   downloaded once per visitor;
 * - spaces requests out so it never goes over the limit;
 * - shares in-flight requests, so parallel charts don't repeat them;
 * - retries after a 429 or a network error.
 */

export const OPENF1_URL = 'https://api.openf1.org/v1';

const CACHE_NAME = 'openf1-v1';
const MAX_REQUESTS_PER_MINUTE = 28; // a little under OpenF1's 30
const MIN_MS_BETWEEN_REQUESTS = 400;
const MAX_ATTEMPTS = 4;

export class OpenF1Error extends Error {}

/** Records come back as plain JSON objects. */
export type Row = Record<string, any>;

export interface GetOptions {
  /** Equality filters, e.g. { session_key: 9158 }. */
  params?: Record<string, string | number>;
  /** Comparison filters as OpenF1 expects them, e.g. ['date>=2024-03-02T15:00:00']. */
  filters?: string[];
  /** Seconds a cached response stays valid; undefined caches forever. */
  ttl?: number;
}

const sent: number[] = []; // timestamps of recent requests
let queue: Promise<void> = Promise.resolve();
const inFlight = new Map<string, Promise<any>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until sending one more request stays under the rate limit. */
function waitForSlot(): Promise<void> {
  const slot = queue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] > 60_000) sent.shift();
      let wait = 0;
      if (sent.length >= MAX_REQUESTS_PER_MINUTE) wait = 60_000 - (now - sent[0]) + 100;
      else if (sent.length) wait = MIN_MS_BETWEEN_REQUESTS - (now - sent[sent.length - 1]);
      if (wait <= 0) {
        sent.push(now);
        return;
      }
      await sleep(wait);
    }
  });
  queue = slot;
  return slot;
}

export function buildUrl(endpoint: string, options: GetOptions = {}): string {
  const parts = Object.entries(options.params ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  parts.push(...(options.filters ?? []));
  return `${OPENF1_URL}/${endpoint}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/** Where responses are cached. The browser uses the Cache API; the Node
 *  data-build script swaps in a file-system store with `setResponseStore`. */
export interface ResponseStore {
  get(url: string): Promise<{ data: any; savedAt: number } | undefined>;
  put(url: string, data: unknown): Promise<void>;
}

const browserStore: ResponseStore = {
  async get(url) {
    const cache = await openCache();
    const hit = await cache?.match(url);
    if (!hit) return undefined;
    try {
      return { data: await hit.json(), savedAt: Number(hit.headers.get('x-saved-at') ?? 0) };
    } catch {
      return undefined;
    }
  },
  async put(url, data) {
    const cache = await openCache();
    await cache?.put(
      url,
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json', 'x-saved-at': String(Date.now()) },
      })
    );
  },
};

let store: ResponseStore = browserStore;

export function setResponseStore(newStore: ResponseStore) {
  store = newStore;
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null; // e.g. private mode or an insecure origin
  }
}

async function readCache(url: string, ttl?: number): Promise<any | undefined> {
  const hit = await store.get(url).catch(() => undefined);
  if (!hit) return undefined;
  if (ttl !== undefined && Date.now() - hit.savedAt > ttl * 1000) return undefined;
  return hit.data;
}

async function writeCache(url: string, data: unknown): Promise<void> {
  // Don't cache empty answers: OpenF1 may still be processing the session.
  if (Array.isArray(data) ? data.length === 0 : !data) return;
  try {
    await store.put(url, data);
  } catch {
    // Storage full or unavailable: the data still works, it just isn't cached.
  }
}

async function fetchJson(url: string, rateLimited: boolean): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (rateLimited) await waitForSlot();
    let response: Response;
    try {
      response = await fetch(url);
    } catch (e) {
      // A 429 without CORS headers also surfaces as a network error.
      lastError = e;
      await sleep(rateLimited ? 15_000 : 2_000 * (attempt + 1));
      continue;
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? 60);
      console.warn(`OpenF1 rate limit hit, waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      continue;
    }
    // OpenF1 answers 404 {"detail": "No results found."} for empty queries
    if (rateLimited && response.status === 404) return [];
    if (response.status >= 500) {
      lastError = new OpenF1Error(`${response.status} from ${url}`);
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new OpenF1Error(`${response.status} from ${url}`);
    return response.json();
  }
  throw new OpenF1Error(`Request failed after ${MAX_ATTEMPTS} attempts: ${url} (${lastError})`);
}

/** Network progress, for loading indicators: requests started and finished. */
export interface Progress {
  started: number;
  finished: number;
}
const progress: Progress = { started: 0, finished: 0 };
const listeners = new Set<(p: Progress) => void>();

export function subscribeProgress(listener: (p: Progress) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  // Reset the counters once everything has finished, so the next batch starts at 0/N.
  const snapshot = { ...progress };
  if (progress.started === progress.finished) progress.started = progress.finished = 0;
  listeners.forEach((l) => l(snapshot));
}

async function cachedGet(url: string, ttl: number | undefined, rateLimited: boolean) {
  const cached = await readCache(url, ttl);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(url);
  if (pending) return pending;
  progress.started++;
  notify();
  const request = fetchJson(url, rateLimited)
    .then(async (data) => {
      await writeCache(url, data);
      return data;
    })
    .finally(() => {
      inFlight.delete(url);
      progress.finished++;
      notify();
    });
  inFlight.set(url, request);
  return request;
}

/** GET /v1/{endpoint} and return the list of records. */
export function openf1Get(endpoint: string, options: GetOptions = {}): Promise<Row[]> {
  return cachedGet(buildUrl(endpoint, options), options.ttl, true);
}

/** GET any JSON URL through the same cache (used for circuit info). */
export function getJson(url: string, ttl?: number): Promise<any> {
  return cachedGet(url, ttl, false);
}
