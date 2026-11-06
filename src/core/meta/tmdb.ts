/**
 * TMDB (themoviedb.org) metadata: hi-res posters, backdrops, cast with
 * photos, tagline, trailer and "where to watch" in Canada.
 * This product uses the TMDB API but is not endorsed or certified by TMDB.
 */
export const TMDB_IMG = 'https://image.tmdb.org/t/p';
export const TMDB_REGION = 'CA';

export interface CastMember {
  name: string;
  role?: string;
  photo?: string;
}

export interface Provider {
  name: string;
  logo?: string;
  /** stream = subscription, free = free, ads = free with ads, rent / buy */
  type: 'stream' | 'free' | 'ads' | 'rent' | 'buy';
}

export interface WatchInfo {
  /** TMDB/JustWatch page listing every option in Canada */
  link?: string;
  providers: Provider[];
}

/** Everything TMDB adds to a movie or a show. */
export interface TmdbMeta {
  tmdbId?: number;
  tmdbType?: 'movie' | 'tv';
  posterHi?: string;
  backdrop?: string;
  tagline?: string;
  overview?: string;
  tmdbRating?: number;
  tmdbGenres?: string[];
  castPhotos?: CastMember[];
  trailer?: string;
  watch?: WatchInfo;
  /** ms timestamp of the last lookup (also set when nothing was found) */
  tmdbCheckedAt?: number;
}

const img = (path: string | null | undefined, size: string) => (path ? `${TMDB_IMG}/${size}${path}` : undefined);

interface RawPerson { name: string; character?: string; profile_path?: string | null; order?: number }
interface RawProvider { provider_name: string; logo_path?: string | null; display_priority?: number }
interface RawDetails {
  id: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
  tagline?: string;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  genres?: { name: string }[];
  credits?: { cast?: RawPerson[] };
  aggregate_credits?: { cast?: (RawPerson & { roles?: { character: string }[] })[] };
  videos?: { results?: { site: string; type: string; key: string; official?: boolean }[] };
  'watch/providers'?: { results?: Record<string, { link?: string } & Partial<Record<'flatrate' | 'free' | 'ads' | 'rent' | 'buy', RawProvider[]>>> };
}

export function parseDetails(d: RawDetails, type: 'movie' | 'tv', now = Date.now()): TmdbMeta {
  const people = (d.credits?.cast ?? d.aggregate_credits?.cast ?? []) as (RawPerson & { roles?: { character: string }[] })[];
  const cast = people
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, 12)
    .map((p) => ({ name: p.name, role: p.character || p.roles?.[0]?.character || undefined, photo: img(p.profile_path, 'w185') }));

  const vids = d.videos?.results ?? [];
  const trailer =
    vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ??
    vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
    vids.find((v) => v.site === 'YouTube' && v.type === 'Teaser');

  const region = d['watch/providers']?.results?.[TMDB_REGION];
  const providers: Provider[] = [];
  const seen = new Set<string>();
  const add = (list: RawProvider[] | undefined, t: Provider['type']) => {
    for (const p of (list ?? []).slice().sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))) {
      const k = `${p.provider_name}:${t}`;
      if (seen.has(k)) continue;
      seen.add(k);
      providers.push({ name: p.provider_name, logo: img(p.logo_path, 'w92'), type: t });
    }
  };
  add(region?.free, 'free');
  add(region?.ads, 'ads');
  add(region?.flatrate, 'stream');
  add(region?.rent, 'rent');
  add(region?.buy, 'buy');

  return {
    tmdbId: d.id,
    tmdbType: type,
    posterHi: img(d.poster_path, 'w500'),
    backdrop: img(d.backdrop_path, 'w1280'),
    tagline: d.tagline || undefined,
    overview: d.overview || undefined,
    tmdbRating: d.vote_count && d.vote_count >= 20 ? Math.round((d.vote_average ?? 0) * 10) / 10 : undefined,
    tmdbGenres: d.genres?.map((g) => g.name),
    castPhotos: cast.length ? cast : undefined,
    trailer: trailer ? `https://www.youtube-nocookie.com/embed/${trailer.key}` : undefined,
    watch: providers.length || region?.link ? { link: region?.link, providers } : undefined,
    tmdbCheckedAt: now,
  };
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an) /, '').replace(/[^a-z0-9Ѐ-ӿ֐-׿]/g, '');

interface SearchHit { id: number; title?: string; name?: string; original_title?: string; original_name?: string; release_date?: string; first_air_date?: string; popularity?: number }

/** Picks a search hit only when the title matches and the year is within one. */
export function pickSearchHit(hits: SearchHit[], title: string, year?: number): SearchHit | undefined {
  const want = norm(title);
  return hits.find((h) => {
    const names = [h.title, h.name, h.original_title, h.original_name].filter(Boolean).map((x) => norm(x!));
    if (!names.includes(want)) return false;
    const y = Number((h.release_date ?? h.first_air_date ?? '').slice(0, 4));
    return !year || !y || Math.abs(y - year) <= 1;
  });
}

export const PROVIDER_LABEL: Record<Provider['type'], string> = {
  free: 'Free',
  ads: 'Free with ads',
  stream: 'Subscription',
  rent: 'Rent',
  buy: 'Buy',
};
