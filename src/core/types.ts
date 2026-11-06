/**
 * Core domain types. Everything in src/core is pure TypeScript with no
 * React Native imports, so it runs in the app, in tests, and in the nightly
 * Channel Doctor job on GitHub Actions.
 */

export type HubId =
  | 'spotlight'
  | 'sports'
  | 'fight'
  | 'usa'
  | 'canada'
  | 'latin'
  | 'russian'
  | 'israel'
  | 'cinema'
  | 'wildlife'
  | 'docs'
  | 'extreme'
  | 'news'
  | 'kids';

/** How much we trust where a stream URL comes from. Drives ranking. */
export type TrustTier = 'official' | 'public' | 'unverified';

/** One raw entry exactly as it appeared in a playlist. */
export interface PlaylistEntry {
  name: string;
  url: string;
  tvgId?: string;
  tvgName?: string;
  logo?: string;
  groups: string[];
  country?: string;
  language?: string;
  userAgent?: string;
  referrer?: string;
  /** Free-form attributes we did not map, kept for debugging and future use. */
  attrs: Record<string, string>;
}

export interface Stream {
  url: string;
  /** Vertical resolution parsed from labels like "(1080p)". 0 = unknown. */
  height: number;
  geoBlocked: boolean;
  notAlwaysOn: boolean;
  trust: TrustTier;
  headers?: Record<string, string>;
  format: 'hls' | 'dash' | 'progressive';
  /** Source id (see sources.ts) that delivered this stream. */
  source: string;
  /** Precomputed rank. Higher plays first. Health adjusts it at runtime. */
  score: number;
}

export interface Channel {
  /** Stable id: iptv-org tvg-id base (before "@") or a name+country slug. */
  id: string;
  name: string;
  logo?: string;
  country?: string;
  categories: string[];
  hubs: HubId[];
  /** Ordered best-first. Auto-failover walks this list. */
  streams: Stream[];
  /** Short identifying line, e.g. "News · Pluto TV" or "Sports · USA". */
  tagline?: string;
  /** Broadcaster / network from the iptv-org database. */
  network?: string;
  /** 0-100. Famous channels first in every row (see hubs.ts POPULAR). */
  popularity: number;
  /** Best stream height, cached for badges ("4K", "HD"). */
  bestHeight: number;
  /** Lowercased search text: name, country, categories, aliases. */
  search: string;
}

export interface Catalog {
  version: number;
  builtAt: number;
  sources: string[];
  channels: Channel[];
}

export interface StreamHealth {
  consecutiveFails: number;
  lastOkAt?: number;
  lastFailAt?: number;
}
