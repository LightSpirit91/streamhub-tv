import type { Catalog, Channel, HubId, PlaylistEntry, StreamHealth } from '../types';
import { channelKey, countryFromTvgId, parseName, toStream } from './normalize';
import { classify, popularity, spotlightScore } from './hubs';
import { BLOCKED_CATEGORIES, type PlaylistSource } from './sources';

export const CATALOG_VERSION = 1;
const SPOTLIGHT_SIZE = 24;

export interface SourceBatch {
  source: Pick<PlaylistSource, 'id' | 'countryFilter' | 'tag'>;
  entries: PlaylistEntry[];
}

/**
 * Merges playlist batches into one deduped catalog.
 * - Same channel from several sources -> one Channel with several streams,
 *   ranked best-first. That ranked list is the auto-failover chain.
 * - Same URL twice -> kept once.
 * - Logos and categories fill in from whichever source has them.
 */
export function buildCatalog(batches: SourceBatch[], now = Date.now()): Catalog {
  const map = new Map<string, Channel>();

  for (const { source, entries } of batches) {
    for (const e of entries) {
      const info = parseName(e.name);
      const country = e.country === 'GB' ? 'UK' : e.country ?? countryFromTvgId(e.tvgId);
      if (source.countryFilter && !source.countryFilter.has(country ?? 'INT')) continue;

      const cats = e.groups
        .map((g) => g.toLowerCase())
        .filter((g) => g !== 'undefined' && g.length < 40);
      if (cats.some((c) => BLOCKED_CATEGORIES.has(c))) continue;
      if (source.tag) cats.push(source.tag);

      const stream = toStream(e, info, source.id);
      if (!stream) continue;

      const key = channelKey(e, info.clean, country);
      let ch = map.get(key);
      if (!ch) {
        ch = {
          id: key,
          name: info.clean,
          logo: e.logo,
          country,
          categories: [],
          hubs: [],
          streams: [],
          popularity: 0,
          bestHeight: 0,
          search: '',
        };
        map.set(key, ch);
      }
      if (!ch.logo && e.logo) ch.logo = e.logo;
      if (!ch.country && country) ch.country = country;
      // Prefer the shortest clean name ("Kan 11" over "Kan 11 HD Live").
      if (info.clean.length < ch.name.length && info.clean.length > 1) ch.name = info.clean;
      for (const c of cats) if (!ch.categories.includes(c) && !isCountryLabel(c)) ch.categories.push(c);
      if (!ch.streams.some((s) => s.url === stream.url)) ch.streams.push(stream);
    }
  }

  const channels = [...map.values()];
  for (const ch of channels) finalizeChannel(ch);
  assignSpotlight(channels);
  channels.sort(byRank);

  return {
    version: CATALOG_VERSION,
    builtAt: now,
    sources: batches.map((b) => b.source.id),
    channels,
  };
}

export function finalizeChannel(ch: Channel): void {
  ch.streams.sort((a, b) => b.score - a.score);
  ch.bestHeight = ch.streams.reduce((m, s) => Math.max(m, s.height), 0);
  ch.hubs = classify(ch);
  ch.popularity = popularity(ch.name, ch.country);
  ch.search = [ch.name, ch.country ?? '', ...ch.categories, ...ch.hubs].join(' ').toLowerCase();
}

/** Row order everywhere: famous first, then best stream. */
export function byRank(a: Channel, b: Channel): number {
  return b.popularity - a.popularity || (b.streams[0]?.score ?? 0) - (a.streams[0]?.score ?? 0);
}

function assignSpotlight(channels: Channel[]): void {
  const ranked = channels
    .filter((c) => c.streams[0] && c.streams[0].trust !== 'unverified' && !c.streams[0].geoBlocked)
    .map((c) => [c, spotlightScore(c)] as const)
    .sort((a, b) => b[1] - a[1]);
  // Diversity: one channel per brand ("CBS News Boston" and "CBS News Miami"
  // count as one), and no country takes more than a third of the row.
  const brands = new Set<string>();
  const perCountry = new Map<string, number>();
  const maxPerCountry = Math.ceil(SPOTLIGHT_SIZE / 3);
  let picked = 0;
  for (const [c] of ranked) {
    if (picked >= SPOTLIGHT_SIZE) break;
    const brand = c.name.toLowerCase().split(/[\s-]+/)[0];
    const cc = c.country ?? 'INT';
    if (brands.has(brand) || (perCountry.get(cc) ?? 0) >= maxPerCountry) continue;
    brands.add(brand);
    perCountry.set(cc, (perCountry.get(cc) ?? 0) + 1);
    if (!c.hubs.includes('spotlight')) c.hubs.unshift('spotlight');
    picked++;
  }
}

// Free-TV uses country names as group-title. They are not genres.
const COUNTRY_LABELS = /^(usa|canada|russia|israel|mexico|argentina|chile|colombia|peru|venezuela|uk|spain|international)$/;
function isCountryLabel(g: string) {
  return COUNTRY_LABELS.test(g);
}

/**
 * Re-ranks streams with on-device health data: recent failures sink, recent
 * successes rise. Channels whose every stream failed 3+ times in a row are
 * hidden until the next 24h refresh re-tests them.
 */
export function applyHealth(
  channels: Channel[],
  health: Record<string, StreamHealth>,
  now = Date.now(),
): Channel[] {
  const DAY = 86_400_000;
  const out: Channel[] = [];
  for (const ch of channels) {
    let dead = 0;
    const streams = ch.streams
      .map((s) => {
        const h = health[s.url];
        if (!h) return s;
        let adj = 0;
        if (h.consecutiveFails >= 3) dead++;
        adj -= h.consecutiveFails * 25;
        if (h.lastOkAt && now - h.lastOkAt < DAY) adj += 15;
        return adj ? { ...s, score: s.score + adj } : s;
      })
      .sort((a, b) => b.score - a.score);
    if (streams.length && dead === streams.length) continue;
    out.push(streams === ch.streams ? ch : { ...ch, streams });
  }
  return out;
}

export function channelsInHub(channels: Channel[], hub: HubId): Channel[] {
  return channels.filter((c) => c.hubs.includes(hub));
}
