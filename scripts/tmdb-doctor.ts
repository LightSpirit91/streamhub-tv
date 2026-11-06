/**
 * Enriches dist/movies.json and dist/shows.json with TMDB: hi-res posters,
 * backdrops, cast photos, tagline, trailer and where to watch in Canada.
 *
 * Needs the TMDB_API_KEY secret (the "API Read Access Token", sent as a
 * Bearer header, never in a URL). Without it the job exits quietly.
 * Incremental: each title is looked up once; streaming availability is
 * refreshed every 14 days for the most popular titles.
 *
 * Usage: npx tsx scripts/tmdb-doctor.ts [--out dist]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDetails, pickSearchHit, type TmdbMeta } from '../src/core/meta/tmdb';
import type { Movie, MovieCatalog } from '../src/core/movies/types';
import type { Show, ShowCatalog } from '../src/core/shows/types';

const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist';
const TOKEN = process.env.TMDB_API_KEY;
const API = 'https://api.themoviedb.org/3';
const REFRESH_MS = 14 * 86_400_000;
const REFRESH_MAX = 800;

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T | undefined> {
  const q = new URLSearchParams(params).toString();
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${API}${path}${q ? `?${q}` : ''}`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return undefined;
}

type Item = (Movie | Show) & TmdbMeta & { imdbId?: string };

async function lookup(item: Item, type: 'movie' | 'tv'): Promise<TmdbMeta> {
  let id = item.tmdbId;
  if (!id && item.imdbId) {
    const f = await tmdb<{ movie_results: { id: number }[]; tv_results: { id: number }[] }>(`/find/${item.imdbId}`, { external_source: 'imdb_id' });
    id = (type === 'movie' ? f?.movie_results : f?.tv_results)?.[0]?.id;
  }
  if (!id) {
    const title = item.title.replace(/:.*$/, '').trim();
    const yearKey = type === 'movie' ? 'year' : 'first_air_date_year';
    const tries = item.year ? [{ query: title, [yearKey]: String(item.year) }, { query: title }] : [{ query: title }];
    for (const p of tries) {
      const s = await tmdb<{ results: Parameters<typeof pickSearchHit>[0] }>(`/search/${type}`, p);
      const hit = s && pickSearchHit(s.results, title, item.year);
      if (hit) {
        id = hit.id;
        break;
      }
    }
  }
  if (!id) return { tmdbCheckedAt: Date.now() };
  const extra = type === 'movie' ? 'credits,videos,watch/providers' : 'aggregate_credits,videos,watch/providers';
  const d = await tmdb<Parameters<typeof parseDetails>[0]>(`/${type}/${id}`, { append_to_response: extra, language: 'en-US' });
  return d ? parseDetails(d, type) : { tmdbCheckedAt: Date.now() };
}

function apply(item: Item, meta: TmdbMeta) {
  Object.assign(item, meta);
  // TMDB's synopsis replaces empty or one-line archive descriptions.
  if (meta.overview && (!item.description || item.description.length < 80)) item.description = meta.overview;
  delete (item as TmdbMeta).overview;
}

async function enrich<T extends Item>(items: T[], type: 'movie' | 'tv'): Promise<{ looked: number; found: number }> {
  const now = Date.now();
  const todo = [
    ...items.filter((i) => !i.tmdbCheckedAt),
    ...items
      .filter((i) => i.tmdbId && i.tmdbCheckedAt && now - i.tmdbCheckedAt > REFRESH_MS)
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, REFRESH_MAX),
  ];
  let found = 0;
  let i = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (i < todo.length) {
        const item = todo[i++];
        const meta = await lookup(item, type);
        apply(item, meta);
        if (meta.tmdbId) found++;
      }
    }),
  );
  return { looked: todo.length, found };
}

async function main() {
  const report = ['# TMDB', ''];
  if (!TOKEN) {
    report.push('Skipped: add the TMDB_API_KEY secret.');
    writeFileSync(join(OUT, 'tmdb-report.md'), report.join('\n'));
    console.log(report.join('\n'));
    return;
  }
  const moviesFile = join(OUT, 'movies.json');
  const showsFile = join(OUT, 'shows.json');
  if (existsSync(moviesFile)) {
    const c = JSON.parse(readFileSync(moviesFile, 'utf8')) as MovieCatalog;
    const r = await enrich(c.movies as Item[] as Movie[], 'movie');
    writeFileSync(moviesFile, JSON.stringify(c));
    const withPosters = c.movies.filter((m) => m.posterHi).length;
    const withWatch = c.movies.filter((m) => m.watch?.providers.length).length;
    report.push(`- Films: looked up ${r.looked}, matched ${r.found}. Total with HD poster ${withPosters}, with Canadian streaming info ${withWatch}.`);
  }
  if (existsSync(showsFile)) {
    const c = JSON.parse(readFileSync(showsFile, 'utf8')) as ShowCatalog;
    const r = await enrich(c.shows as Item[] as Show[], 'tv');
    writeFileSync(showsFile, JSON.stringify(c));
    report.push(`- Series: looked up ${r.looked}, matched ${r.found}. Total with HD poster ${c.shows.filter((s) => s.posterHi).length}.`);
  }
  report.push('', 'This product uses the TMDB API but is not endorsed or certified by TMDB.');
  writeFileSync(join(OUT, 'tmdb-report.md'), report.join('\n'));
  console.log(report.join('\n'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'tmdb-doctor failed');
  process.exit(1);
});
