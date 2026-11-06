export interface Episode {
  id: string;
  title: string;
  url: string;
  season?: number;
  episode?: number;
  minutes?: number;
}

export interface Show {
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
  source: 'archive' | 'youtube';
  popularity: number;
  addedAt?: number;
  episodes: Episode[];
}

export interface ShowCatalog {
  version: number;
  builtAt: number;
  shows: Show[];
}
