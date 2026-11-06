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
import { genresFromTmdb } from '../src/core/movies/youtube';
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
  // TMDB's genres are curated; they replace genres guessed from descriptions.
  const g = genresFromTmdb(meta.tmdbGenres);
  if (g) (item as { genres: string[] }).genres = g;
  // TMDB's synopsis replaces empty or one-line archive descriptions.
  if (meta.overview && (!item.description || item.description.length < 80)) item.description = meta.overview;
  delete (item as TmdbMeta).overview;
}

const tidyTitleForSearch = (t: string) => t.replace(/\s*\(.*?\)\s*/g, ' ').trim();

async function enrich<T extends Item>(items: T[], type: 'movie' | 'tv'): Promise<{ looked: number; found: number }> {
  const now = Date.now();
  // Free-to-stream titles (fresh-doctor) are complete already and re-checked weekly there.
  items = items.filter((i) => i.source !== 'free');
  const todo = [
    ...items.filter((i) => !i.tmdbCheckedAt),
    // Unmatched titles get another try weekly (titles get cleaned up over time).
    ...items.filter((i) => !i.tmdbId && i.tmdbCheckedAt && now - i.tmdbCheckedAt > 7 * 86_400_000).slice(0, 1500),
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
        const meta = await lookup({ ...item, title: item.source === 'youtube' ? tidyTitleForSearch(item.title) : item.title } as T, type);
        apply(item, meta);
        if (meta.tmdbId) found++;
      }
    }),
  );
  return { looked: todo.length, found };
}

/** Coming soon in Canada: release date, artwork, trailer. Not playable here; shown so you know what's coming. */
async function upcoming() {
  const genres = new Map((await tmdb<{ genres: { id: number; name: string }[] }>('/genre/movie/list', { language: 'en-US' }))?.genres.map((g) => [g.id, g.name]) ?? []);
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<number>();
  const out: unknown[] = [];
  for (let page = 1; page <= 4; page++) {
    const r = await tmdb<{ results: { id: number; title: string; release_date?: string; poster_path?: string; backdrop_path?: string; overview?: string; genre_ids?: number[]; popularity?: number; adult?: boolean }[] }>(
      '/movie/upcoming', { region: 'CA', language: 'en-US', page: String(page) },
    );
    for (const m of r?.results ?? []) {
      if (seen.has(m.id) || m.adult || !m.release_date || m.release_date < today || !m.poster_path) continue;
      seen.add(m.id);
      const d = await tmdb<Parameters<typeof parseDetails>[0]>(`/movie/${m.id}`, { append_to_response: 'videos,credits', language: 'en-US' });
      const meta = d ? parseDetails(d, 'movie') : {};
      out.push({
        id: `upcoming:${m.id}`, tmdbId: m.id, title: m.title, releaseDate: m.release_date, overview: m.overview ?? '',
        genres: (m.genre_ids ?? []).map((g) => genres.get(g)).filter(Boolean), posterHi: meta.posterHi, backdrop: meta.backdrop,
        trailer: meta.trailer, castPhotos: meta.castPhotos?.slice(0, 8), tagline: meta.tagline, popularity: m.popularity ?? 0,
      });
    }
  }
  out.sort((a, b) => String((a as { releaseDate: string }).releaseDate).localeCompare(String((b as { releaseDate: string }).releaseDate)));
  writeFileSync(join(OUT, 'upcoming.json'), JSON.stringify({ version: 1, builtAt: Date.now(), movies: out }));
  return out.length;
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
  try {
    report.push(`- Coming soon: ${await upcoming()} upcoming releases in Canada.`);
  } catch {
    report.push('- Coming soon: unavailable tonight.');
  }
  report.push('', 'This product uses the TMDB API but is not endorsed or certified by TMDB.');
  writeFileSync(join(OUT, 'tmdb-report.md'), report.join('\n'));
  console.log(report.join('\n'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'tmdb-doctor failed');
  process.exit(1);
});
