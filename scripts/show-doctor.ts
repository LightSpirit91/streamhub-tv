/**
 * Builds dist/shows.json: classic TV series from the Internet Archive,
 * grouped into shows with numbered episodes. Cumulative like the movies.
 * Usage: npx tsx scripts/show-doctor.ts [--limit 2500] [--previous prev/shows.json] [--out dist]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metadataUrl, type ArchiveFile, type SearchDoc } from '../src/core/movies/archive';
import { isClassicShow, itemToShowParts, showSearchUrl } from '../src/core/shows/archive';
import type { Episode, Show, ShowCatalog } from '../src/core/shows/types';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LIMIT = Number(arg('--limit', '2500'));
const PREVIOUS = arg('--previous', 'prev/shows.json');
const OUT = arg('--out', 'dist');
const UA = { 'User-Agent': 'StreamHub-ShowDoctor/1.0 (+https://github.com/LightSpirit91/streamhub-tv)' };
const OMDB_KEY = process.env.OMDB_API_KEY;
const OMDB_DAILY = 150;

/** OMDb series lookup by title; the key never reaches an error message or log. */
async function omdbSeries(title: string, year?: number) {
  try {
    const q = new URLSearchParams({ t: title, type: 'series', ...(year ? { y: String(year) } : {}) });
    const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_KEY}&${q}`, { headers: UA });
    const r = (await res.json()) as { Response?: string; imdbID?: string; imdbRating?: string; imdbVotes?: string; Actors?: string; Plot?: string; Title?: string };
    return r.Response === 'True' ? r : undefined;
  } catch {
    return undefined;
  }
}

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
  // Keep only episodes from items still in tonight's curated search, and only
  // classic shows: this purges anything that came from collections we dropped.
  const allowed = new Set(docs.map((d) => d.identifier));
  for (const [key, show] of shows) {
    show.episodes = show.episodes.filter((e) => allowed.has(e.id.split('/')[0]));
    if (!show.episodes.length || !isClassicShow(show.title, show.year, show.description)) shows.delete(key);
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
            // Newest first: no new classic series once the library exists; known ones still get new episodes.
            if (prev?.shows.length) continue;
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
  // IMDb ratings for the most-watched series (title match, 150 a night).
  let rated = 0;
  if (OMDB_KEY) {
    const todo = list.filter((x) => x.imdbRating === undefined).slice(0, OMDB_DAILY);
    for (const show of todo) {
      const r = await omdbSeries(show.title, show.year);
      show.imdbRating = r ? Number(r.imdbRating) || 0 : 0; // 0 = looked up, no rating
      if (!r) continue;
      show.imdbId = r.imdbID;
      show.imdbVotes = Number(String(r.imdbVotes ?? '').replace(/,/g, '')) || undefined;
      if (r.Actors && r.Actors !== 'N/A') show.cast = r.Actors.split(', ');
      if (!show.description && r.Plot && r.Plot !== 'N/A') show.description = r.Plot;
      rated++;
    }
  }
  console.log(OMDB_KEY ? `series ratings looked up: ${rated}` : 'series ratings: skipped (no OMDB_API_KEY secret)');

  // Keep free-to-stream series (fresh-doctor maintains them). Nothing from YouTube is kept.
  const yt = (prev?.shows ?? []).filter((s) => s.source === 'free');
  const catalog: ShowCatalog = { version: 1, builtAt: now, shows: [...list, ...yt] };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'shows.json'), JSON.stringify(catalog));
  const report = `# TV shows\n\n- Series: **${catalog.shows.length}** (${list.length} classic, ${yt.length} free to stream)\n- Episodes: ${catalog.shows.reduce((n, s) => n + s.episodes.length, 0)} (${addedEps} added tonight)\n- Top: ${list.slice(0, 15).map((s) => `${s.title} (${s.episodes.length})`).join(', ')}`;
  writeFileSync(join(OUT, 'shows-report.md'), report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
