import type { CastMember } from '../meta/tmdb';

/** A film coming to Canada soon (TMDB). Shown with its date; not playable until it is free somewhere. */
export interface UpcomingMovie {
  id: string;
  tmdbId: number;
  title: string;
  releaseDate: string;
  overview: string;
  genres: string[];
  posterHi?: string;
  backdrop?: string;
  trailer?: string;
  tagline?: string;
  castPhotos?: CastMember[];
  popularity: number;
}

export function releaseLabel(date: string, now = new Date()): string {
  const d = new Date(`${date}T12:00:00`);
  const days = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  const md = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  if (days <= 0) return 'Out now';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days · ${md}`;
  return md;
}
