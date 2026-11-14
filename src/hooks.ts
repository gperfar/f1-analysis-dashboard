import { createContext, useContext, useEffect, useState } from 'react';
import { subscribeProgress, Progress } from './lib/openf1';

// -- routing ---------------------------------------------------------------------------
// Hash routes work on GitHub Pages without server-side rewrites:
//   #/                      -> latest session
//   #/2026                  -> season page
//   #/2026/20/R             -> session story

export type Route =
  | { page: 'latest' }
  | { page: 'season'; year: number }
  | { page: 'session'; year: number; round: number; code: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [year, round, code] = parts;
  if (year && /^\d{4}$/.test(year)) {
    if (round && /^\d+$/.test(round)) return { page: 'session', year: +year, round: +round, code: (code ?? 'R').toUpperCase() };
    return { page: 'season', year: +year };
  }
  return { page: 'latest' };
}

export function routeHref(route: Route): string {
  if (route.page === 'season') return `#/${route.year}`;
  if (route.page === 'session') return `#/${route.year}/${route.round}/${route.code}`;
  return '#/';
}

export function navigate(route: Route, replace = false) {
  const href = routeHref(route);
  if (replace) window.history.replaceState(null, '', href);
  else window.location.hash = href;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

// -- async data ------------------------------------------------------------------------

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Run a loader when `key` changes; ignores results of stale loads. */
export function useAsync<T>(load: () => Promise<T>, key: string): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let active = true;
    setState({ data: null, error: null, loading: true });
    load().then(
      (data) => active && setState({ data, error: null, loading: false }),
      (e) => active && setState({ data: null, error: e?.message ?? String(e), loading: false })
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** Live count of OpenF1 requests in progress, for loading indicators. */
export function useProgress(): Progress {
  const [progress, setProgress] = useState<Progress>({ started: 0, finished: 0 });
  useEffect(() => subscribeProgress(setProgress), []);
  return progress;
}

// -- driver focus ----------------------------------------------------------------------
// Clicking a driver highlights them in every chart and dims everyone else.

export interface FocusState {
  focused: Set<number>;
  toggle: (driver: number) => void;
  clear: () => void;
}

export const FocusContext = createContext<FocusState>({ focused: new Set(), toggle: () => {}, clear: () => {} });

export function useFocusState(): FocusState {
  const [focused, setFocused] = useState<Set<number>>(new Set());
  return {
    focused,
    toggle: (driver) =>
      setFocused((current) => {
        const next = new Set(current);
        if (next.has(driver)) next.delete(driver);
        else next.add(driver);
        return next;
      }),
    clear: () => setFocused(new Set()),
  };
}

export function useFocus() {
  return useContext(FocusContext);
}

/** Opacity for a driver's marks: full when nobody is focused or they are. */
export function focusOpacity(focused: Set<number>, driver: number, dim = 0.15) {
  return focused.size === 0 || focused.has(driver) ? 1 : dim;
}
