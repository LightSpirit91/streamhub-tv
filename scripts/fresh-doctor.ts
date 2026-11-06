/**
 * Finds the newest movies and series you can watch free in Canada (free or
 * free with ads, on services like Tubi, Pluto TV, The Roku Channel, CBC Gem)
 * and adds them to dist/movies.json and dist/shows.json. Runs every night.
 *
 * - Newest first: every night it scans the latest releases, what is popular
 *   right now, and what is airing new episodes.
 * - These titles open on the service that streams them (StreamHub links to
 *   it); they are not copied or re-streamed.
 * - Cumulative: titles stay while they are still free; each is re-checked
 *   weekly and dropped when it stops being free.
 * - Plex and Samsung TV Plus are never offered.
 *
 * Needs the TMDB_API_KEY secret (API Read Access Token, sent as a Bearer
 * header, never in a URL). Without it the job exits quietly.
 *
 * Usage: npx tsx scripts/fresh-doctor.ts [--out dist]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freeLinks, parseDetails, type TmdbMeta } from '../src/core/meta/tmdb';
import { genresFromTmdb } from '../src/core/movies/youtube';
import { isWatchable, titleKey } from '../src/core/movies/archive';
import { MIN_NEW_MOVIE_YEAR, type Movie, type MovieCatalog } from '../src/core/movies/types';
import type { Show, ShowCatalog } from '../src/core/shows/types';

const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist';
const TOKEN = process.env.TMDB_API_KEY;
const API = 'https://api.themoviedb.org/3';
const DAY = 86_400_000;
const RECHECK_MS = 7 * DAY;
const RECHECK_MAX = 1500;
/** TMDB popularity is a small number; scale it next to download/view counts. */
const POP_SCALE = 5000;

const LANG: Record<string, string> = {
  es: 'Spanish', ru: 'Russian', he: 'Hebrew', fr: 'French', it: 'Italian', de: 'German', ja: 'Japanese',
  pt: 'Portuguese', uk: 'Ukrainian', ko: 'Korean', hi: 'Hindi', zh: 'Chinese', yi: 'Yiddish', tr: 'Turkish',
};

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

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Ids from several discover scans (newest, popular now, popular since 1990). */
async function discover(type: 'movie' | 'tv'): Promise<number[]> {
  const now = Date.now();
  const today = iso(now);
  const y = new Date().getUTCFullYear();
  const date = type === 'movie' ? 'primary_release_date' : 'first_air_date';
  const base = { watch_region: 'CA', with_watch_monetization_types: 'free|ads', include_adult: 'false', language: 'en-US' };
  const scans: [Record<string, string>, number][] = [
    [{ sort_by: `${date}.desc`, [`${date}.lte`]: today, [`${date}.gte`]: `${MIN_NEW_MOVIE_YEAR}-01-01`, 'vote_count.gte': '3' }, 20],
    [{ sort_by: 'popularity.desc', [`${date}.gte`]: `${y - 2}-01-01`, [`${date}.lte`]: today }, 10],
    [{ sort_by: 'popularity.desc', [`${date}.gte`]: `${MIN_NEW_MOVIE_YEAR}-01-01`, [`${date}.lte`]: today }, 15],
  ];
  // Series with brand-new episodes, even when the show itself is older.
  if (type === 'tv') scans.push([{ sort_by: 'popularity.desc', 'air_date.gte': iso(now - 45 * DAY), 'air_date.lte': today }, 10]);
  const ids = new Set<number>();
  for (const [params, pages] of scans) {
    for (let page = 1; page <= pages; page++) {
      const r = await tmdb<{ results: { id: number; adult?: boolean }[]; total_pages: number }>(`/discover/${type}`, { ...base, ...params, page: String(page) });
      for (const x of r?.results ?? []) if (!x.adult) ids.add(x.id);
      if (!r || page >= r.total_pages) break;
    }
  }
  return [...ids];
}

interface Extra {
  title?: string; name?: string; release_date?: string; first_air_date?: string; last_air_date?: string;
  runtime?: number; episode_run_time?: number[]; number_of_seasons?: number; original_language?: string;
  production_countries?: { name: string }[]; origin_country?: string[]; popularity?: number;
  external_ids?: { imdb_id?: string | null }; adult?: boolean;
}

async function details(type: 'movie' | 'tv', id: number) {
  const extra = type === 'movie' ? 'credits,videos,watch/providers,external_ids' : 'aggregate_credits,videos,watch/providers,external_ids';
  const d = await tmdb<Parameters<typeof parseDetails>[0] & Extra>(`/${type}/${id}`, { append_to_response: extra, language: 'en-US' });
  if (!d || d.adult) return undefined;
  return { meta: parseDetails(d, type), d };
}

/** Shared fields for a free movie or series. */
function common(meta: TmdbMeta, d: Extra, title: string) {
  const { overview, ...rest } = meta;
  return {
    ...rest,
    title,
    description: overview ?? '',
    poster: meta.posterHi ?? '',
    genres: genresFromTmdb(meta.tmdbGenres) ?? meta.tmdbGenres ?? [],
    language: d.original_language && d.original_language !== 'en' ? LANG[d.original_language] ?? undefined : undefined,
    imdbId: d.external_ids?.imdb_id ?? undefined,
    popularity: Math.round((d.popularity ?? 0) * POP_SCALE),
    freeOn: freeLinks(meta, title),
    freeCheckedAt: Date.now(),
    source: 'free' as const,
  };
}

/** Re-check where a title streams free; returns false when it no longer does. */
async function stillFree(item: (Movie | Show) & { freeCheckedAt?: number }, type: 'movie' | 'tv'): Promise<boolean> {
  const r = await tmdb<{ id: number } & Record<string, unknown>>(`/${type}/${item.tmdbId}/watch/providers`);
  if (!r) return true; // TMDB busy: keep it, try next week
  const meta = parseDetails({ id: item.tmdbId!, 'watch/providers': r as never }, type);
  item.watch = meta.watch;
  item.freeOn = freeLinks({ ...meta, tmdbId: item.tmdbId, tmdbType: type }, item.title);
  item.freeCheckedAt = Date.now();
  return item.freeOn.length > 0;
}

type Free<T> = T & { freeCheckedAt?: number };

async function run<T extends Movie | Show>(type: 'movie' | 'tv', items: T[], build: (meta: TmdbMeta, d: Extra) => T | undefined) {
  const now = Date.now();
  const firstImport = !items.some((x) => x.source === 'free');
  // Titles that already play inside StreamHub are never duplicated as "free elsewhere".
  const playable = items.filter((x) => x.source !== 'free');
  const playIds = new Set(playable.map((x) => x.tmdbId).filter(Boolean));
  const playTitles = new Set(playable.map((x) => `${titleKey(x.title)}|${x.year ?? ''}`));
  const known = new Map(items.filter((x) => x.source === 'free').map((x) => [x.tmdbId!, x as Free<T>]));

  // 1) Weekly re-check: drop titles that stopped being free.
  const due = [...known.values()].filter((x) => now - (x.freeCheckedAt ?? 0) > RECHECK_MS).slice(0, RECHECK_MAX);
  let dropped = 0;
  await pool(due, 6, async (x) => {
    if (!(await stillFree(x, type))) {
      known.delete(x.tmdbId!);
      dropped++;
    }
  });

  // 2) Tonight's newest and most popular free titles.
  const ids = (await discover(type)).filter((id) => !known.has(id) && !playIds.has(id));
  let added = 0;
  await pool(ids, 6, async (id) => {
    const r = await details(type, id);
    if (!r) return;
    const item = build(r.meta, r.d) as Free<T> | undefined;
    if (!item || !(item as { freeOn?: unknown[] }).freeOn?.length) return;
    if (!item.year || item.year < MIN_NEW_MOVIE_YEAR) return;
    if (!isWatchable({ title: item.title, description: item.description })) return;
    if (playTitles.has(`${titleKey(item.title)}|${item.year}`)) return;
    // First import: only what came out in the last two months counts as "just added".
    const recent = (item.releaseDate ?? '') >= iso(now - 60 * DAY);
    if (!firstImport || recent) item.addedAt = now;
    known.set(id, item);
    added++;
  });

  return { list: [...playable, ...known.values()] as T[], added, dropped, total: known.size, scanned: ids.length };
}

async function main() {
  const report = ['# Newest free movies and series', ''];
  if (!TOKEN) {
    report.push('Skipped: add the TMDB_API_KEY secret.');
    writeFileSync(join(OUT, 'fresh-report.md'), report.join('\n'));
    console.log(report.join('\n'));
    return;
  }
  const moviesFile = join(OUT, 'movies.json');
  const showsFile = join(OUT, 'shows.json');

  if (existsSync(moviesFile)) {
    const c = JSON.parse(readFileSync(moviesFile, 'utf8')) as MovieCatalog;
    const r = await run<Movie>('movie', c.movies, (meta, d) => {
      const title = d.title ?? '';
      const year = Number((d.release_date ?? '').slice(0, 4)) || undefined;
      if (!title) return undefined;
      return {
        ...common(meta, d, title), id: `tmdb:movie:${meta.tmdbId}`, year, releaseDate: d.release_date || undefined, url: '',
        minutes: d.runtime || undefined, country: d.production_countries?.[0]?.name, quality: 'HD',
      };
    });
    c.movies = r.list.sort((a, b) => b.popularity - a.popularity);
    c.builtAt = Date.now();
    writeFileSync(moviesFile, JSON.stringify(c));
    report.push(`- Movies: ${r.total} free to stream (${r.added} new tonight, ${r.dropped} no longer free, ${r.scanned} looked up)`);
  }

  if (existsSync(showsFile)) {
    const c = JSON.parse(readFileSync(showsFile, 'utf8')) as ShowCatalog;
    const r = await run<Show>('tv', c.shows, (meta, d) => {
      const title = d.name ?? '';
      const year = Number((d.first_air_date ?? '').slice(0, 4)) || undefined;
      if (!title) return undefined;
      return {
        ...common(meta, d, title), id: `tmdb:tv:${meta.tmdbId}`, year, releaseDate: d.last_air_date || d.first_air_date || undefined,
        seasons: d.number_of_seasons, country: d.origin_country?.[0], episodes: [],
      };
    });
    c.shows = r.list.sort((a, b) => b.popularity - a.popularity);
    c.builtAt = Date.now();
    writeFileSync(showsFile, JSON.stringify(c));
    report.push(`- Series: ${r.total} free to stream (${r.added} new tonight, ${r.dropped} no longer free, ${r.scanned} looked up)`);
  }

  report.push('', 'This product uses the TMDB API but is not endorsed or certified by TMDB.');
  writeFileSync(join(OUT, 'fresh-report.md'), report.join('\n'));
  console.log(report.join('\n'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'fresh-doctor failed');
  process.exit(1);
});
