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

/** A free (or free with ads) service where a title can be watched, with a link to it. */
export interface FreeLink {
  name: string;
  logo?: string;
  type: 'free' | 'ads';
  url: string;
}

/**
 * Services never offered: filler (Plex, Samsung TV Plus), YouTube, and paid
 * services that TMDB lists as "with ads" (an ad tier still needs a subscription).
 */
const SKIP_PROVIDERS =
  /plex|samsung|youtube|amazon|prime video|apple|crave|amc|shahid|wow presents|netflix|disney|paramount|\bmax\b|starz|britbox|acorn|mubi|hayu|sundance|shudder|hollywood suite|super channel|fubo|sling|philo|discovery\+|peacock|hulu|stack ?tv/i;
/** Services that play without an account or sign-up. Only these are offered. */
const NO_SIGNUP = /^(tubi|pluto)/i;

/** False for services StreamHub never links to (paid, filler, or needing an account). */
export const allowedService = (name: string): boolean => !SKIP_PROVIDERS.test(name) && NO_SIGNUP.test(name);

/** Links for a free title with today's rules: rebuilt from availability when known, else filtered. */
export function currentFreeLinks(item: TmdbMeta & { freeOn?: FreeLink[]; title: string }): FreeLink[] {
  return item.watch?.providers.length ? freeLinks(item, item.title) : (item.freeOn ?? []).filter((l) => allowedService(l.name));
}

/** Free with a public library card. */
const LIBRARY = /hoopla|kanopy/i;

/** Direct search pages for services whose URL format is stable; others use the TMDB watch page. */
const SEARCH_URL: [RegExp, (q: string) => string][] = [
  [/^tubi/i, (q) => `https://tubitv.com/search/${encodeURIComponent(q)}`],
];

/** Free / free-with-ads places to watch, best first. Empty when there are none. */
export function freeLinks(meta: TmdbMeta, title: string): FreeLink[] {
  const fallback = meta.watch?.link ?? (meta.tmdbId ? `https://www.themoviedb.org/${meta.tmdbType ?? 'movie'}/${meta.tmdbId}/watch?locale=${TMDB_REGION}` : undefined);
  const out: FreeLink[] = [];
  for (const p of meta.watch?.providers ?? []) {
    if ((p.type !== 'free' && p.type !== 'ads') || !allowedService(p.name) || out.some((x) => x.name === p.name)) continue;
    const direct = SEARCH_URL.find(([re]) => re.test(p.name))?.[1](title);
    const url = direct ?? fallback;
    if (url) out.push({ name: LIBRARY.test(p.name) ? `${p.name} (library card)` : p.name, logo: p.logo, type: p.type, url });
  }
  // Watch-right-away services first, library-card ones last.
  return out.sort((a, b) => Number(LIBRARY.test(a.name)) - Number(LIBRARY.test(b.name)));
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
