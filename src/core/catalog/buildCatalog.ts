import type { Catalog, Channel, HubId, PlaylistEntry, StreamHealth } from '../types';
import { channelKey, countryFromTvgId, isBannedStream, parseName, toStream } from './normalize';
import { classify, popularity, spotlightScore } from './hubs';
import { BLOCKED_CATEGORIES, type PlaylistSource } from './sources';

export const CATALOG_VERSION = 1;
const FAST_SOURCE = /_(pluto|samsung|roku|plex|tubi|xumo|stirr|stingray|firetv|vizio|tcl|distro|amagi)$/;

const nameKey = (n: string) =>
  n.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\b(hd|sd|fhd|uhd|4k|tv)\b/g, '').replace(/[^a-z0-9\u0400-\u04ff\u0590-\u05ff]+/g, '');

/**
 * Same channel listed by several sources under different ids (an iptv-org id,
 * a Pluto id, a Plex id...) -> one channel whose streams fail over across all.
 * Only exact same name AND same country merge.
 */
function mergeSameName(map: Map<string, Channel>) {
  const seen = new Map<string, Channel>();
  for (const [id, ch] of map) {
    const key = `${nameKey(ch.name)}|${ch.country ?? ''}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, ch);
      continue;
    }
    for (const st of ch.streams) if (!first.streams.some((x) => x.url === st.url)) first.streams.push(st);
    if (!first.logo && ch.logo) first.logo = ch.logo;
    for (const c of ch.categories) if (!first.categories.includes(c)) first.categories.push(c);
    map.delete(id);
  }
}
const SPOTLIGHT_SIZE = 24;

export interface SourceBatch {
  source: Pick<PlaylistSource, 'id' | 'countryFilter' | 'tag' | 'country' | 'byName' | 'deny' | 'nameFilter'>;
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
  // Block lists (Samsung TV Plus, Plex): their URLs are removed everywhere.
  const denied = new Set(batches.filter((b) => b.source.deny).flatMap((b) => b.entries.map((e) => e.url)));

  for (const { source, entries } of batches) {
    if (source.deny) continue;
    // "iptv-org:raw:ca_pluto" -> CA. Used when an entry has no tvg-id, so a
    // channel from the Pluto TV Canada lineup is labelled Canada, not unknown.
    const sourceCountry = /^iptv-org:(?:country|raw):([a-z]{2})(?:_|$)/.exec(source.id)?.[1].toUpperCase();
    for (const raw of entries) {
      // Whole-country lineups: default the country, and merge by name instead of
      // the lineup's internal ids so the same channel from two lists becomes one.
      const e = source.byName ? { ...raw, tvgId: undefined, country: raw.country ?? source.country } : raw;
      const info = parseName(e.name);
      if (source.nameFilter && !source.nameFilter.test(info.clean)) continue;
      const country = (e.country === 'GB' ? 'UK' : e.country) ?? countryFromTvgId(e.tvgId) ?? sourceCountry;
      if (source.countryFilter && !source.countryFilter.has(country ?? 'INT')) continue;

      const cats = e.groups
        .map((g) => g.toLowerCase())
        .filter((g) => g !== 'undefined' && g.length < 40);
      if (cats.some((c) => BLOCKED_CATEGORIES.has(c))) continue;
      if (source.tag) cats.push(source.tag);

      if (denied.has(e.url)) continue;
      const stream = toStream(e, info, source.id);
      if (!stream || isBannedStream(stream)) continue;

      // The same free (FAST) channel ships in Pluto/Samsung/Roku lineups for
      // several countries without a tvg-id. Merge them into one channel whose
      // streams fail over across regions.
      const fast = !e.tvgId && (FAST_SOURCE.test(source.id) || !!source.byName);
      const key = fast ? channelKey(e, info.clean, 'fast') : channelKey(e, info.clean, country);
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

  mergeSameName(map);
  const channels = [...map.values()].filter((c) => c.streams.length);
  for (const ch of channels) finalizeChannel(ch);
  assignSpotlight(channels);
  channels.sort(byRank);

  return {
    version: CATALOG_VERSION,
    builtAt: now,
    sources: batches.filter((b) => !b.source.deny).map((b) => b.source.id),
    channels,
  };
}

export function finalizeChannel(ch: Channel): void {
  ch.streams.sort((a, b) => b.score - a.score);
  ch.bestHeight = ch.streams.reduce((m, s) => Math.max(m, s.height), 0);
  ch.hubs = classify(ch);
  ch.popularity = popularity(ch.name, ch.country);
  ch.search = [ch.name, ...(ch.altNames ?? []), ch.country ?? '', ch.network ?? '', ...ch.categories, ...ch.hubs].join(' ').toLowerCase();
}

/** Row order everywhere: famous first, then best stream. */
export function byRank(a: Channel, b: Channel): number {
  return b.popularity - a.popularity || (b.streams[0]?.score ?? 0) - (a.streams[0]?.score ?? 0);
}

export function assignSpotlight(channels: Channel[]): void {
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

/** Drops banned streams (YouTube, Samsung TV Plus, Plex) from an already built catalog. */
export function withoutBanned(channels: Channel[]): Channel[] {
  const out: Channel[] = [];
  for (const ch of channels) {
    const streams = ch.streams.filter((s) => !isBannedStream(s));
    if (!streams.length) continue;
    out.push(streams.length === ch.streams.length ? ch : { ...ch, streams });
  }
  return out;
}

export function channelsInHub(channels: Channel[], hub: HubId): Channel[] {
  return channels.filter((c) => c.hubs.includes(hub));
}
