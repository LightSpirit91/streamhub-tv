/**
 * Builds dist/shows.json: classic TV series from the Internet Archive,
 * grouped into shows with numbered episodes. Cumulative like the movies.
 * Usage: npx tsx scripts/show-doctor.ts [--limit 2500] [--previous prev/shows.json] [--out dist]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metadataUrl, type ArchiveFile, type SearchDoc } from '../src/core/movies/archive';
import { itemToShowParts, showSearchUrl } from '../src/core/shows/archive';
import type { Episode, Show, ShowCatalog } from '../src/core/shows/types';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LIMIT = Number(arg('--limit', '2500'));
const PREVIOUS = arg('--previous', 'prev/shows.json');
const OUT = arg('--out', 'dist');
const UA = { 'User-Agent': 'StreamHub-ShowDoctor/1.0 (+https://github.com/LightSpirit91/streamhub-tv)' };

async function json<T>(url: string): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45_000);
      const res = await fetch(url, { headers: UA, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return (await res.json()) as T;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`Failed: ${url}`);
}

async function main() {
  const now = Date.now();
  const prev: ShowCatalog | undefined = existsSync(PREVIOUS) ? JSON.parse(readFileSync(PREVIOUS, 'utf8')) : undefined;
  const shows = new Map<string, Show>((prev?.shows ?? []).filter((s) => s.source === 'archive').map((s) => [s.id, s]));
  const knownItems = new Set([...shows.values()].flatMap((s) => s.episodes.map((e) => e.id.split('/')[0])));

  const docs: SearchDoc[] = [];
  for (let page = 1; docs.length < LIMIT; page++) {
    const r = await json<{ response: { docs: SearchDoc[] } }>(showSearchUrl(Math.min(1000, LIMIT), page));
    if (!r.response.docs.length) break;
    docs.push(...r.response.docs);
  }
  const fresh = docs.filter((d) => !knownItems.has(d.identifier));
  console.log(`search: ${docs.length} items, ${fresh.length} new`);

  let i = 0;
  let addedEps = 0;
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      while (i < fresh.length) {
        const d = fresh[i++];
        try {
          const meta = await json<{ files?: (ArchiveFile & { title?: string; length?: string })[] }>(metadataUrl(d.identifier));
          const part = itemToShowParts(d, meta.files ?? []);
          if (!part) continue;
          const cur = shows.get(part.key);
          if (!cur) {
            shows.set(part.key, { ...part.show, addedAt: prev ? now : undefined, episodes: part.episodes });
          } else {
            const have = new Set(cur.episodes.map((e) => e.id));
            cur.episodes.push(...part.episodes.filter((e) => !have.has(e.id)));
            cur.popularity += part.show.popularity;
            if (!cur.description && part.show.description) cur.description = part.show.description;
          }
          addedEps += part.episodes.length;
        } catch {
          // retry tomorrow
        }
      }
    }),
  );

  const order = (a: Episode, b: Episode) =>
    (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || a.title.localeCompare(b.title, undefined, { numeric: true });
  const list = [...shows.values()]
    .filter((s) => s.episodes.length >= 2)
    .map((s) => ({ ...s, episodes: s.episodes.sort(order) }))
    .sort((a, b) => b.popularity - a.popularity);
  // Keep YouTube shows from the previous build; youtube-doctor refreshes them.
  const yt = (prev?.shows ?? []).filter((s) => s.source === 'youtube');
  const catalog: ShowCatalog = { version: 1, builtAt: now, shows: [...list, ...yt] };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'shows.json'), JSON.stringify(catalog));
  const report = `# TV shows\n\n- Series: **${catalog.shows.length}** (${list.length} classic, ${yt.length} from official channels)\n- Episodes: ${catalog.shows.reduce((n, s) => n + s.episodes.length, 0)} (${addedEps} added tonight)\n- Top: ${list.slice(0, 15).map((s) => `${s.title} (${s.episodes.length})`).join(', ')}`;
  writeFileSync(join(OUT, 'shows-report.md'), report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
