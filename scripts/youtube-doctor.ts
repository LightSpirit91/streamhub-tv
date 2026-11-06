/**
 * Imports free full-length films and series that studios and broadcasters
 * publish themselves on YouTube: Israeli (Kan archive, Israel Film Archive,
 * Spielberg Jewish Film Archive), Russian/Soviet (Mosfilm, Lenfilm, Gorky),
 * Latin and American (FilmRise, Popcornflix, Paramount Movies).
 *
 * Needs the YOUTUBE_API_KEY secret (free, 10,000 quota units a day; this
 * job uses well under 3,000). Without it the job exits quietly.
 *
 * Usage: npx tsx scripts/youtube-doctor.ts [--out dist] [--previous prev]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Movie, MovieCatalog } from '../src/core/movies/types';
import type { Show, ShowCatalog } from '../src/core/shows/types';
import { genresFrom, isWatchable, cleanText, stripEmoji } from '../src/core/movies/archive';
import { isFilmTitle, tidyTitle } from '../src/core/movies/youtube';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', 'dist');
const PREV = arg('--previous', 'prev');
const KEY = process.env.YOUTUBE_API_KEY;
const API = 'https://www.googleapis.com/youtube/v3';

interface Source {
  /** Search phrase used once to find the official channel; the id is cached afterwards. */
  query: string;
  /** Substring that must appear in the channel title (guards against look-alikes). */
  expect: RegExp;
  language: string;
  country: string;
  /** What this channel publishes. */
  kind: 'movies' | 'shows' | 'both';
  /** Skip anything older than this year when a year can be detected. */
  minYear?: number;
}

export const YT_SOURCES: Source[] = [
  // Israel
  { query: 'כאן ארכיון', expect: /ארכיון|archive/i, language: 'Hebrew', country: 'Israel', kind: 'both', minYear: 1960 },
  { query: 'ארכיון הסרטים הישראלי סינמטק ירושלים', expect: /סינמטק|cinematheque|film archive/i, language: 'Hebrew', country: 'Israel', kind: 'both', minYear: 1960 },
  { query: 'Steven Spielberg Jewish Film Archive', expect: /spielberg/i, language: 'Hebrew', country: 'Israel', kind: 'movies', minYear: 1960 },
  { query: 'כאן חינוכית', expect: /חינוכית|educational/i, language: 'Hebrew', country: 'Israel', kind: 'shows', minYear: 1960 },
  { query: 'כאן 11 תאגיד השידור', expect: /כאן|kan/i, language: 'Hebrew', country: 'Israel', kind: 'both', minYear: 1960 },
  // Russia / USSR
  { query: 'Мосфильм', expect: /мосфильм|mosfilm/i, language: 'Russian', country: 'Russia', kind: 'movies' },
  { query: 'Ленфильм', expect: /ленфильм|lenfilm/i, language: 'Russian', country: 'Russia', kind: 'movies' },
  { query: 'Киностудия Горького', expect: /горьк|gorky/i, language: 'Russian', country: 'Russia', kind: 'movies' },
  // Latin America
  { query: 'FilmRise en Español películas completas', expect: /filmrise/i, language: 'Spanish', country: 'Latin America', kind: 'movies' },
  // USA
  { query: 'FilmRise Movies', expect: /filmrise/i, language: 'English', country: 'United States', kind: 'movies' },
  { query: 'Popcornflix', expect: /popcornflix/i, language: 'English', country: 'United States', kind: 'movies' },
  { query: 'Paramount Movies full free movies', expect: /paramount/i, language: 'English', country: 'United States', kind: 'movies' },
];

const minutesOf = (iso: string) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  return m ? (+(m[1] ?? 0)) * 60 + (+(m[2] ?? 0)) + Math.round(+(m[3] ?? 0) / 60) : 0;
};

async function yt<T>(path: string, params: Record<string, string>): Promise<T> {
  const q = new URLSearchParams({ ...params, key: KEY! }).toString();
  const res = await fetch(`${API}/${path}?${q}`);
  if (!res.ok) throw new Error(`${path} ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

interface Snip { title: string; description: string; liveBroadcastContent?: string; thumbnails?: Record<string, { url: string }>; publishedAt?: string; channelTitle?: string }

async function resolveChannel(s: Source, cache: Record<string, string>): Promise<string | undefined> {
  if (cache[s.query]) return cache[s.query];
  const r = await yt<{ items: { id: { channelId: string }; snippet: Snip }[] }>('search', { part: 'snippet', type: 'channel', q: s.query, maxResults: '5' });
  const hit = r.items.find((i) => s.expect.test(i.snippet.title));
  if (hit) cache[s.query] = hit.id.channelId;
  console.log(`  ${s.query} -> ${hit ? `${hit.snippet.title} (${hit.id.channelId})` : 'not found'}`);
  return hit?.id.channelId;
}

async function listPlaylist(id: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const r = await yt<{ items: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>('playlistItems', {
      part: 'contentDetails', playlistId: id, maxResults: '50', ...(page ? { pageToken: page } : {}),
    });
    ids.push(...r.items.map((i) => i.contentDetails.videoId));
    page = r.nextPageToken;
  } while (page && ids.length < max);
  return ids;
}

interface Video { id: string; minutes: number; snippet: Snip; embeddable: boolean; views: number }

async function videos(ids: string[]): Promise<Video[]> {
  const out: Video[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt<{ items: { id: string; snippet: Snip; contentDetails: { duration: string }; status: { embeddable: boolean }; statistics?: { viewCount?: string } }[] }>('videos', {
      part: 'snippet,contentDetails,status,statistics', id: ids.slice(i, i + 50).join(','),
    });
    // Skip live streams and premieres: only finished films and episodes.
    for (const v of r.items.filter((x) => !x.snippet.liveBroadcastContent || x.snippet.liveBroadcastContent === 'none')) out.push({ id: v.id, minutes: minutesOf(v.contentDetails.duration), snippet: v.snippet, embeddable: v.status.embeddable, views: Number(v.statistics?.viewCount ?? 0) });
  }
  return out;
}

/** A 4-digit year mentioned in a title or the start of a description. */
const yearIn = (text: string) => Number(/\b(19[0-9]\d|20[0-2]\d)\b/.exec(text)?.[1]) || undefined;
const tooOld = (src: Source, text: string) => {
  const y = yearIn(text);
  return !!(src.minYear && y && y < src.minYear);
};

const titleKeyOf = (t: string) => stripEmoji(t).toLowerCase().replace(/[^a-z0-9\u0590-\u05ff\u0400-\u04ff]+/g, '');

const thumb = (s: Snip) => s.thumbnails?.maxres?.url ?? s.thumbnails?.standard?.url ?? s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url ?? '';
const embed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}`;
const tidy = (t: string) => tidyTitle(stripEmoji(t)).replace(/\s*[|│].*$/, '').replace(/\b(full movie|фильм целиком|полный фильм|סרט מלא|película completa|hd|4k)\b/gi, '').replace(/[\s\-–:()]+$/, '').trim();

async function main() {
  if (!KEY) {
    console.log('YouTube import: skipped (no YOUTUBE_API_KEY secret)');
    writeFileSync(join(OUT, 'youtube-report.md'), '# Official channels\n\nSkipped: add the YOUTUBE_API_KEY secret to enable Israeli, Russian, Latin and American studio channels.');
    return;
  }
  const now = Date.now();
  const read = <T,>(p: string): T | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined);
  const cache = read<Record<string, string>>(join(PREV, 'youtube-channels.json')) ?? {};
  const moviesFile = join(OUT, 'movies.json');
  const showsFile = join(OUT, 'shows.json');
  const movies = read<MovieCatalog>(moviesFile) ?? { version: 1, builtAt: now, movies: [] };
  const shows = read<ShowCatalog>(showsFile) ?? { version: 1, builtAt: now, shows: [] };
  const knownMovies = new Map(movies.movies.map((m) => [m.id, m]));
  const knownShows = new Map(shows.shows.map((s) => [s.id, s]));
  const log: string[] = [];

  for (const src of YT_SOURCES) {
    try {
      const channelId = await resolveChannel(src, cache);
      if (!channelId) {
        log.push(`- ${src.query}: channel not found`);
        continue;
      }
      let nm = 0;
      let ns = 0;
      // Series: the channel's playlists made of episode-length videos.
      if (src.kind !== 'movies') {
        const pls = await yt<{ items: { id: string; snippet: Snip; contentDetails: { itemCount: number } }[] }>('playlists', {
          part: 'snippet,contentDetails', channelId, maxResults: '50',
        });
        for (const pl of pls.items.filter((p) => p.contentDetails.itemCount >= 3).slice(0, 40)) {
          const vids = (await videos(await listPlaylist(pl.id, 200))).filter((v) => v.embeddable && v.minutes >= 8);
          if (vids.length < 3) continue;
          if (tooOld(src, `${pl.snippet.title} ${pl.snippet.description.slice(0, 300)}`)) continue;
          const id = `yt:${pl.id}`;
          const show: Show = {
            id, title: tidy(pl.snippet.title), poster: thumb(pl.snippet), description: cleanText(pl.snippet.description),
            genres: genresFrom(pl.snippet.description, pl.snippet.title), language: src.language, country: src.country,
            source: 'youtube', popularity: Math.round(vids.reduce((n, v) => n + v.views, 0) / 40), addedAt: knownShows.get(id)?.addedAt ?? now,
            episodes: vids.map((v, i) => ({ id: v.id, title: tidy(v.snippet.title), url: embed(v.id), episode: i + 1, minutes: v.minutes })),
          };
          if (!isWatchable({ title: show.title, description: show.description })) continue;
          knownShows.set(id, show);
          ns++;
        }
      }
      // Films: feature-length uploads.
      if (src.kind !== 'shows') {
        const ch = await yt<{ items: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>('channels', { part: 'contentDetails', id: channelId });
        const uploads = ch.items[0]?.contentDetails.relatedPlaylists.uploads;
        if (uploads) {
          for (const v of await videos(await listPlaylist(uploads, 1500))) {
            if (!v.embeddable || v.minutes < 55) continue;
            if (tooOld(src, `${v.snippet.title} ${v.snippet.description.slice(0, 300)}`)) continue;
            if (!isFilmTitle(v.snippet.title)) continue;
            const id = `yt:${v.id}`;
            const title = tidy(v.snippet.title);
            if (!title || !isWatchable({ title, description: v.snippet.description })) continue;
            const year = Number(/\b(19[3-9]\d|20[0-2]\d)\b/.exec(`${v.snippet.title} ${v.snippet.description.slice(0, 300)}`)?.[1]) || undefined;
            const m: Movie = {
              id, title, year, genres: genresFrom(v.snippet.description, title), description: cleanText(v.snippet.description),
              poster: thumb(v.snippet), url: embed(v.id), minutes: v.minutes, language: src.language === 'English' ? undefined : src.language,
              country: src.country, quality: 'HD', source: 'youtube', popularity: Math.round(v.views / 40),
              addedAt: knownMovies.get(id)?.addedAt ?? now,
            };
            if (!knownMovies.has(id)) nm++;
            knownMovies.set(id, { ...knownMovies.get(id), ...m });
          }
        }
      }
      log.push(`- ${src.query}: ${nm} new films, ${ns} series`);
      console.log(log[log.length - 1]);
    } catch (e) {
      log.push(`- ${src.query}: error ${(e as Error).message.slice(0, 120)}`);
    }
  }

  // Re-check everything imported before with today's rules, and merge duplicates:
  // films by title (keep the most watched upload), series by title (merge episodes).
  const films = new Map<string, Movie>();
  for (const m of [...knownMovies.values()].sort((a, b) => b.popularity - a.popularity)) {
    if (m.source === 'youtube' && !isFilmTitle(m.title)) continue;
    const key = m.source === 'youtube' ? `yt:${titleKeyOf(m.title)}` : m.id;
    if (!films.has(key)) films.set(key, { ...m, title: stripEmoji(m.title) });
  }
  const series = new Map<string, Show>();
  for (const sh of [...knownShows.values()].sort((a, b) => b.popularity - a.popularity)) {
    const key = sh.source === 'youtube' ? `yt:${sh.language}:${titleKeyOf(sh.title)}` : sh.id;
    const cur = series.get(key);
    if (!cur) {
      series.set(key, { ...sh, title: stripEmoji(sh.title), episodes: sh.episodes.map((e) => ({ ...e, title: stripEmoji(e.title) })) });
    } else {
      const have = new Set(cur.episodes.map((e) => e.id));
      const extra = sh.episodes.filter((e) => !have.has(e.id)).map((e, i) => ({ ...e, title: stripEmoji(e.title), episode: cur.episodes.length + i + 1 }));
      cur.episodes.push(...extra);
      cur.popularity += sh.popularity;
    }
  }
  movies.movies = [...films.values()].sort((a, b) => b.popularity - a.popularity);
  shows.shows = [...series.values()].sort((a, b) => b.popularity - a.popularity);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(moviesFile, JSON.stringify(movies));
  writeFileSync(showsFile, JSON.stringify(shows));
  writeFileSync(join(OUT, 'youtube-channels.json'), JSON.stringify(cache));
  const yMovies = movies.movies.filter((m) => m.source === 'youtube').length;
  const yShows = shows.shows.filter((s) => s.source === 'youtube').length;
  const report = [`# Official channels`, ``, `- Films from studio channels: ${yMovies}`, `- Series from broadcaster channels: ${yShows}`, ``, ...log].join('\n');
  writeFileSync(join(OUT, 'youtube-report.md'), report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
