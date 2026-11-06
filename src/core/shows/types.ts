import type { FreeLink, TmdbMeta } from '../meta/tmdb';

export interface Episode {
  id: string;
  title: string;
  url: string;
  season?: number;
  episode?: number;
  minutes?: number;
}

export interface Show extends TmdbMeta {
  id: string;
  title: string;
  poster: string;
  description: string;
  genres: string[];
  year?: number;
  language?: string;
  country?: string;
  imdbId?: string;
  imdbRating?: number;
  imdbVotes?: number;
  cast?: string[];
  /** archive / youtube play inside StreamHub; free = watch free on a service like Tubi (opens there). */
  source: 'archive' | 'youtube' | 'free';
  freeOn?: FreeLink[];
  freeCheckedAt?: number;
  origin?: string[];
  /** First air date (YYYY-MM-DD) or, for free series, the latest episode date. */
  releaseDate?: string;
  seasons?: number;
  popularity: number;
  addedAt?: number;
  episodes: Episode[];
}

export interface ShowCatalog {
  version: number;
  builtAt: number;
  shows: Show[];
}
