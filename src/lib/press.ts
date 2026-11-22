/** Press coverage of a session: articles from outlets' public RSS feeds. */

export const PRESS_VERSION = 1;

export interface Article {
  outlet: string;
  title: string;
  /** Short teaser from the feed (not the article itself). */
  teaser: string;
  url: string;
  published: string;
}

export interface SessionPress {
  version: number;
  builtAt: string;
  articles: Article[];
  /** Optional Claude-written digest of what the coverage focused on, from headlines and teasers only. */
  digest?: string;
}
