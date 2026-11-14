/** File-system response cache for running the data layer in Node. */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResponseStore } from '../src/lib/openf1';

export function fsStore(dir: string): ResponseStore {
  const pathFor = (url: string) => join(dir, `${createHash('sha1').update(url).digest('hex')}.json`);
  return {
    async get(url) {
      const path = pathFor(url);
      try {
        const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
        return { data: JSON.parse(text), savedAt: info.mtimeMs };
      } catch {
        return undefined;
      }
    },
    async put(url, data) {
      await mkdir(dir, { recursive: true });
      const path = pathFor(url);
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, path);
    },
  };
}
