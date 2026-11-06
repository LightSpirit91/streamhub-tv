export interface Movie {
  id: string;
  title: string;
  year?: number;
  genres: string[];
  description: string;
  poster: string;
  url: string;
  /** "1:32:10" style, when the source provides it. */
  runtime?: string;
  source: 'archive';
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
  'Romance', 'Mystery & Thriller', 'Animation', 'Musical', 'Documentary',
] as const;
