/**
 * Channel sources StreamHub uses, each one switchable on the device, with
 * attribution. Only public, free-to-view sources are listed here; sources
 * that were researched and left out are documented in docs/SOURCES.md.
 */
import type { Channel } from '../types';

export interface SourceGroup {
  id: string;
  name: string;
  /** Who publishes it, shown as attribution. */
  credit: string;
  license: string;
  about: string;
  /** Stream source ids (see sources.ts) that belong to this group. */
  match: RegExp;
}

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    id: 'iptv-org',
    name: 'iptv-org',
    credit: 'iptv-org/iptv (github.com/iptv-org/iptv)',
    license: 'Public domain (Unlicense) playlists of publicly available streams',
    about: 'Community index of public live channels, by country, category and language. Its blocklist (copyright claims, adult) is applied nightly.',
    match: /^iptv-org:/,
  },
  {
    id: 'free-tv',
    name: 'Free-TV',
    credit: 'Free-TV/IPTV (github.com/Free-TV/IPTV)',
    license: 'Curated list; channels officially free to air only',
    about: 'Hand-curated mainstream channels that are free over the air in their country; one link per channel.',
    match: /^free-tv$/,
  },
  {
    id: 'famelack',
    name: 'Famelack',
    credit: 'famelack/famelack-channels (github.com/famelack/famelack-channels)',
    license: 'Public channel list with uptime checks',
    about: 'Uptime-checked public channels by country.',
    match: /^famelack:/,
  },
  {
    id: 'discovered',
    name: 'Daily discovery',
    credit: 'Found by StreamHub in public GitHub playlists (repo noted per link)',
    license: 'Only links on broadcaster / free-TV hosts StreamHub already plays from',
    about: 'New links found by the daily GitHub search. Each one passed the safety rules and a real playback check, and is re-checked every night. No PPV, no account links, no faked headers.',
    match: /^discovered$/,
  },
];

export const groupOf = (sourceId: string) => SOURCE_GROUPS.find((g) => g.match.test(sourceId))?.id;

/** Removes streams from switched-off groups; channels left with no stream are hidden. */
export function withoutGroups(channels: Channel[], off: string[]): Channel[] {
  if (!off.length) return channels;
  const out: Channel[] = [];
  for (const ch of channels) {
    const streams = ch.streams.filter((s) => !off.includes(groupOf(s.source) ?? ''));
    if (!streams.length) continue;
    out.push(streams.length === ch.streams.length ? ch : { ...ch, streams });
  }
  return out;
}

/** How many channels each group contributes (a channel can come from several). */
export function groupCounts(channels: Channel[]): Record<string, number> {
  const n: Record<string, number> = {};
  for (const ch of channels) for (const g of new Set(ch.streams.map((s) => groupOf(s.source)).filter(Boolean) as string[])) n[g] = (n[g] ?? 0) + 1;
  return n;
}
