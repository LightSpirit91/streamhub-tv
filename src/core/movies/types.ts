import type { FreeLink, TmdbMeta } from '../meta/tmdb';
import type { SubFile } from '../subtitles';

export interface Movie extends TmdbMeta {
  id: string;
  title: string;
  year?: number;
  genres: string[];
  description: string;
  poster: string;
  url: string;
  /** "1:32:10" style, when the source provides it. */
  runtime?: string;
  minutes?: number;
  /** Original language when it is not English (drives the World Cinema rows). */
  language?: string;
  /** "HD 1080p", "HD 720p", "SD". */
  quality?: string;
  /** When this film first entered the StreamHub library (ms). */
  addedAt?: number;
  imdbId?: string;
  /** IMDb rating out of 10 and vote count (via OMDb, when a key is configured). */
  imdbRating?: number;
  imdbVotes?: number;
  director?: string[];
  cast?: string[];
  country?: string;
  wikipedia?: string;
  /** archive / youtube play inside StreamHub; free = watch free on a service like Tubi (opens there). */
  source: 'archive' | 'youtube' | 'free';
  /** Where a 'free' title streams (free or with ads), with links. */
  freeOn?: FreeLink[];
  /** Last time the free availability was checked (ms). */
  freeCheckedAt?: number;
  /** Open license (Creative Commons / public-domain mark) of an Internet Archive film. */
  license?: string;
  /** Subtitle files that ship with the film (English, Spanish, Russian, Hebrew). */
  subs?: SubFile[];
  subsCheckedAt?: number;
  /** Production countries as ISO codes (free titles), e.g. ['US']. */
  origin?: string[];
  /** Release date (YYYY-MM-DD) when known; newest-first ordering uses it. */
  releaseDate?: string;
  /** Popularity at the source, used for ordering. */
  popularity: number;
}

export interface MovieCatalog {
  version: number;
  builtAt: number;
  movies: Movie[];
}

export const MOVIE_GENRES = [
  'Drama', 'Comedy', 'Crime & Noir', 'Horror', 'Sci-Fi', 'Western', 'War', 'Adventure',
  'Romance', 'Mystery & Thriller', 'Animation', 'Musical', 'Documentary', 'Silent Era',
] as const;

/** World Cinema rows, in the profile's order of interest. */
export const WORLD_ROWS: { language: string; title: string }[] = [
  { language: 'Russian', title: 'Russian & Soviet Cinema' },
  { language: 'Spanish', title: 'Cine en Español' },
  { language: 'Hebrew', title: 'Israeli & Hebrew Cinema' },
  { language: 'Yiddish', title: 'Yiddish Classics' },
  { language: 'French', title: 'French Cinema' },
  { language: 'Italian', title: 'Italian Cinema' },
  { language: 'German', title: 'German Cinema' },
  { language: 'Japanese', title: 'Japanese Cinema' },
  { language: 'Portuguese', title: 'Portuguese & Brazilian Cinema' },
  { language: 'Ukrainian', title: 'Ukrainian Cinema' },
];

export const DECADES = [1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010];

/** New films are only added when they were released in this year or later. */
export const MIN_NEW_MOVIE_YEAR = 1990;
export const newEnough = (year?: number): boolean => !!year && year >= MIN_NEW_MOVIE_YEAR;

/** Newest first: release date, then year. */
export const releaseKey = (m: { releaseDate?: string; year?: number }): string => m.releaseDate ?? (m.year ? `${m.year}-00-00` : '');
export const byNewest = <T extends { releaseDate?: string; year?: number }>(a: T, b: T): number => releaseKey(b).localeCompare(releaseKey(a));

/** Free-elsewhere titles are American or Canadian productions only. */
export function northAmerican(x: { origin?: string[]; country?: string }): boolean {
  if (x.origin?.length) return x.origin.some((c) => c === 'US' || c === 'CA');
  return /^(US|CA|USA|United States( of America)?|Canada)$/i.test(x.country ?? '');
}

/**
 * Internet Archive films dated 1990 or later are only kept with an open
 * license: anything that recent is under copyright unless the owner released it.
 */
export const archiveAllowed = (m: { source: string; year?: number; license?: string }): boolean =>
  m.source !== 'archive' || !m.year || m.year < MIN_NEW_MOVIE_YEAR || !!m.license;
