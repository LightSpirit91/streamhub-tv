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
  source: 'archive' | 'youtube';
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
