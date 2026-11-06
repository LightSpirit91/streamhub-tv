import type { PlaylistEntry } from '../types';

const ATTR_RE = /([A-Za-z0-9_-]+)="([^"]*)"/g;

/**
 * Parses M3U / M3U8 playlists, built for big feeds (10k+ entries, several MB).
 *
 * - Walks the text with indexOf instead of split('\n'), so a 10 MB feed never
 *   becomes a 300k-element array.
 * - Handles #EXTINF attributes (tvg-id, tvg-logo, group-title, tvg-country,
 *   tvg-language), #EXTVLCOPT user-agent/referrer, #EXTGRP, CRLF line endings,
 *   a BOM, and names that contain commas.
 * - Skips anything that is not an http(s) URL (e.g. Twitch/YouTube pages are
 *   kept out later by the normalizer, local files are dropped here).
 */
export function parseM3U(text: string): PlaylistEntry[] {
  const out: PlaylistEntry[] = [];
  let pending: Omit<PlaylistEntry, 'url'> | null = null;
  let pendingGroup: string | undefined;
  let ua: string | undefined;
  let ref: string | undefined;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const len = text.length;

  while (pos < len) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = len;
    let line = text.slice(pos, end);
    pos = end + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    line = line.trim();
    if (!line) continue;

    if (line.charCodeAt(0) === 35 /* # */) {
      if (line.startsWith('#EXTINF')) {
        pending = parseExtinf(line);
        ua = undefined;
        ref = undefined;
        pendingGroup = undefined;
      } else if (line.startsWith('#EXTVLCOPT:')) {
        const opt = line.slice(11);
        const eq = opt.indexOf('=');
        if (eq > 0) {
          const key = opt.slice(0, eq).trim().toLowerCase();
          const val = opt.slice(eq + 1).trim();
          if (key === 'http-user-agent') ua = val;
          else if (key === 'http-referrer' || key === 'http-referer') ref = val;
        }
      } else if (line.startsWith('#EXTGRP:')) {
        pendingGroup = line.slice(8).trim();
      }
      continue;
    }

    // A URL line closes the current entry.
    if (pending && /^https?:\/\//i.test(line)) {
      const entry: PlaylistEntry = { ...pending, url: line };
      if (pendingGroup && entry.groups.length === 0) entry.groups = [pendingGroup];
      if (ua) entry.userAgent = ua;
      if (ref) entry.referrer = ref;
      out.push(entry);
    }
    pending = null;
    ua = undefined;
    ref = undefined;
    pendingGroup = undefined;
  }
  return out;
}

function parseExtinf(line: string): Omit<PlaylistEntry, 'url'> {
  // The display name is after the last comma that sits outside quotes.
  let inQuote = false;
  let nameStart = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 34 /* " */) inQuote = !inQuote;
    else if (c === 44 /* , */ && !inQuote) {
      nameStart = i + 1;
      break;
    }
  }
  const head = nameStart === -1 ? line : line.slice(0, nameStart - 1);
  const name = nameStart === -1 ? '' : line.slice(nameStart).trim();

  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(head))) attrs[m[1].toLowerCase()] = m[2].trim();

  const groups = (attrs['group-title'] ?? '')
    .split(';')
    .map((g) => g.trim())
    .filter(Boolean);

  return {
    name: name || attrs['tvg-name'] || 'Unknown',
    tvgId: attrs['tvg-id'] || undefined,
    tvgName: attrs['tvg-name'] || undefined,
    logo: attrs['tvg-logo'] || undefined,
    groups,
    country: attrs['tvg-country']?.split(/[;,]/)[0]?.trim().toUpperCase() || undefined,
    language: attrs['tvg-language'] || undefined,
    attrs,
  };
}
