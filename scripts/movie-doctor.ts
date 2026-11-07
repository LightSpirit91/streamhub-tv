/**
 * Builds dist/movies.json, the StreamHub movie library. Runs every night.
 *
 * - Cumulative: starts from yesterday's library (--previous), so the
 *   library only grows.
 * - New arrivals: also scans the newest uploads every night, stamped with
 *   addedAt for the "New on StreamHub" row.
 * - Only films released 1990 or later are added (with an open license).
 *   Titles already in the library stay.
 * - Incremental: only titles we have never seen cost a metadata request.
 * - Credits from Wikidata (director, cast, country, IMDb id, Wikipedia).
 * - IMDb ratings from OMDb when the OMDB_API_KEY secret is set
 *   (free key, 1,000 lookups a day; ratings fill in over a few nights).
 *
 * Usage: npx tsx scripts/movie-doctor.ts [--limit 5000] [--previous prev/movies.json] [--out dist]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fileUrl, imdbIdFrom, isWatchable, metadataUrl, openLicense, runtimeMinutes, searchUrl, titleKey, toMovie,
  type ArchiveFile, type SearchDoc,
} from '../src/core/movies/archive';
import { creditsQuery, parseCredits } from '../src/core/movies/wikidata';
import { subFilesOf } from '../src/core/subtitles';
import { MIN_NEW_MOVIE_YEAR, newEnough, type Movie, type MovieCatalog } from '../src/core/movies/types';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LIMIT = Number(arg('--limit', '5000'));
const PREVIOUS = arg('--previous', 'prev/movies.json');
const OUT = arg('--out', 'dist');
const OMDB_KEY = process.env.OMDB_API_KEY;
const OMDB_DAILY = 850; // the other 150 of the 1,000 free daily lookups go to TV series
const UA = { 'User-Agent': 'StreamHub-MovieDoctor/1.1 (+https://github.com/LightSpirit91/streamhub-tv)' };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45_000);
      const res = await fetch(url, { ...init, headers: { ...UA, ...((init?.headers as Record<string, string>) ?? {}) }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return (await res.json()) as T;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`Failed: ${url}`);
}

/** OMDb call that never puts the key into an error message or log line. */
async function omdb<T>(query: string): Promise<T> {
  try {
    const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_KEY}&${query}`, { headers: UA });
    if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch {
    throw new Error('OMDb request failed');
  }
}

async function search(sort: string, max: number): Promise<SearchDoc[]> {
  const docs: SearchDoc[] = [];
  for (let page = 1; docs.length < max; page++) {
    const r = await json<{ response: { docs: SearchDoc[] } }>(searchUrl(Math.min(1000, max), page, sort, MIN_NEW_MOVIE_YEAR));
    if (!r.response.docs.length) break;
    docs.push(...r.response.docs);
  }
  return docs.filter(isWatchable);
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  const now = Date.now();
  const previous: Movie[] = existsSync(PREVIOUS) ? (JSON.parse(readFileSync(PREVIOUS, 'utf8')) as MovieCatalog).movies : [];
  // A bulk import (hundreds of titles sharing one timestamp) is not "new":
  // only titles that arrive through the newest-uploads scan count as new.
  const stamps = new Map<number, number>();
  for (const m of previous) if (m.addedAt) stamps.set(m.addedAt, (stamps.get(m.addedAt) ?? 0) + 1);
  for (const m of previous) if (m.addedAt && (stamps.get(m.addedAt) ?? 0) > 300) delete m.addedAt;
  // "New" rows show new films only: older titles never carry a new-arrival date.
  for (const m of previous) if (m.addedAt && m.source !== 'free' && (m.year ?? 0) < MIN_NEW_MOVIE_YEAR) delete m.addedAt;
  // Nothing from YouTube is kept.
  const library = new Map(previous.filter((m) => m.source !== 'youtube').map((m) => [m.id, m]));
  console.log(`previous library: ${previous.length}`);

  const [popular, newest] = await Promise.all([search('downloads desc', LIMIT), search('addeddate desc', 800)]);
  const docs = new Map<string, SearchDoc>();
  for (const d of [...popular, ...newest]) docs.set(d.identifier, d);
  const newestIds = new Set(newest.map((d) => d.identifier));
  console.log(`search: ${popular.length} popular + ${newest.length} newest = ${docs.size} candidates`);

  // Refresh known titles from search data; fetch metadata only for new ones.
  const fresh: SearchDoc[] = [];
  for (const d of docs.values()) {
    const m = library.get(d.identifier);
    if (m) m.popularity = Math.max(m.popularity, d.downloads ?? 0);
    else fresh.push(d);
  }
  let added = 0;
  await pool(fresh, 24, async (d) => {
    try {
      const meta = await json<{ files?: ArchiveFile[]; metadata?: Record<string, unknown> }>(metadataUrl(d.identifier));
      const md = meta.metadata ?? {};
      const m = toMovie({ ...d, runtime: d.runtime ?? (md.runtime as string | undefined) }, meta.files ?? []);
      // New films: released 1990 or later, and only with an open license
      // (Creative Commons / public domain) since they are not old enough to be
      // public domain by age.
      if (!m || !newEnough(m.year) || !openLicense(md.licenseurl)) return;
      if (previous.length && newestIds.has(m.id)) m.addedAt = now; // genuinely new uploads only
      m.imdbId = imdbIdFrom(md['external-identifier']) ?? imdbIdFrom(md.imdb);
      m.minutes ??= runtimeMinutes(md.runtime as string | undefined);
      m.subs = subFilesOf(meta.files ?? [], (n) => fileUrl(d.identifier, n), m.language);
      m.subsCheckedAt = now;
      library.set(m.id, m);
      added++;
    } catch {
      // skip this title tonight, retry tomorrow
    }
  });
  console.log(`new titles added: ${added}`);

  // Subtitle files (.srt / .vtt) shipped with films already in the library: 1,500 a night until all are checked.
  const needSubs = [...library.values()].filter((m) => m.source === 'archive' && !m.subsCheckedAt).slice(0, 1500);
  let withSubs = 0;
  await pool(needSubs, 24, async (m) => {
    try {
      const meta = await json<{ files?: ArchiveFile[] }>(metadataUrl(m.id));
      m.subs = subFilesOf(meta.files ?? [], (n) => fileUrl(m.id, n), m.language);
      m.subsCheckedAt = now;
      if (m.subs.length) withSubs++;
    } catch {
      // next night
    }
  });
  console.log(`subtitles: checked ${needSubs.length}, ${withSubs} have subtitle files`);

  // Credits from Wikidata for titles that haven't been checked yet.
  const needCredits = [...library.values()].filter((m) => m.director === undefined);
  let credited = 0;
  for (let i = 0; i < needCredits.length; i += 150) {
    const batch = needCredits.slice(i, i + 150);
    try {
      const q = creditsQuery(batch.map((m) => m.id));
      const res = await json<Parameters<typeof parseCredits>[0]>(
        `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/sparql-results+json' } },
      );
      const credits = parseCredits(res);
      for (const m of batch) {
        const c = credits.get(m.id);
        m.director = c?.director ?? []; // [] = checked, nothing found
        m.cast = c?.cast ?? [];
        if (c?.imdbId) m.imdbId ??= c.imdbId;
        if (c?.country) m.country = c.country;
        if (c?.wikipedia) m.wikipedia = c.wikipedia;
        if (c) credited++;
      }
    } catch {
      // Wikidata busy: these titles get another chance tomorrow.
    }
  }
  console.log(`credits from Wikidata: ${credited} of ${needCredits.length} checked`);

  // IMDb ratings via OMDb (optional).
  let rated = 0;
  if (OMDB_KEY) {
    const todo = [...library.values()]
      .filter((m) => m.imdbId && m.imdbRating === undefined)
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, OMDB_DAILY);
    await pool(todo, 6, async (m) => {
      try {
        const r = await omdb<{ imdbRating?: string; imdbVotes?: string; Director?: string; Actors?: string; Response?: string }>(`i=${m.imdbId}`);
        if (r.Response !== 'True') return;
        const rating = Number(r.imdbRating);
        m.imdbRating = Number.isFinite(rating) ? rating : 0;
        m.imdbVotes = Number(String(r.imdbVotes ?? '').replace(/,/g, '')) || undefined;
        if (!m.director?.length && r.Director && r.Director !== 'N/A') m.director = r.Director.split(', ');
        if (!m.cast?.length && r.Actors && r.Actors !== 'N/A') m.cast = r.Actors.split(', ');
        rated++;
      } catch {
        // try again tomorrow
      }
    });
  }
  console.log(OMDB_KEY ? `IMDb ratings fetched: ${rated}` : 'IMDb ratings: skipped (no OMDB_API_KEY secret)');

  // Merge duplicate uploads of the same film, keep the most popular copy.
  const seen = new Map<string, Movie>();
  for (const m of [...library.values()].filter((x) => isWatchable(x)).sort((a, b) => b.popularity - a.popularity)) {
    const key = m.source === 'free' ? m.id : titleKey(m.title);
    const prev = seen.get(key);
    if (!prev) seen.set(key, m);
    else if (!prev.year && m.year) prev.year = m.year;
  }
  const movies = [...seen.values()];
  const catalog: MovieCatalog = { version: 1, builtAt: now, movies };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'movies.json'), JSON.stringify(catalog));

  const tally = (f: (m: Movie) => string[]) => {
    const t: Record<string, number> = {};
    for (const m of movies) for (const k of f(m)) t[k] = (t[k] ?? 0) + 1;
    return t;
  };
  const report = [
    `# Movie library`,
    ``,
    `- Films: **${movies.length}** (${added} new tonight)`,
    `- With cast/director: ${movies.filter((m) => m.cast?.length || m.director?.length).length}`,
    `- With IMDb id: ${movies.filter((m) => m.imdbId).length} · with IMDb rating: ${movies.filter((m) => m.imdbRating).length}`,
    `- Subtitles: ${['en', 'es', 'ru', 'he'].map((l) => `${l} ${movies.filter((m) => m.subs?.some((s) => s.lang === l)).length}`).join(' · ')} (checked ${movies.filter((m) => m.subsCheckedAt).length} of ${movies.filter((m) => m.source === 'archive').length})`,
    `- Genres: ${JSON.stringify(tally((m) => m.genres))}`,
    `- Languages: ${JSON.stringify(tally((m) => (m.language ? [m.language] : [])))}`,
  ].join('\n');
  writeFileSync(join(OUT, 'movies-report.md'), report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
