import type { PlaylistEntry } from '../types';

/**
 * Famelack (github.com/famelack/famelack-channels): curated, uptime-checked
 * live TV with official YouTube live embeds. JSON per country.
 */
interface FamelackChannel {
  name: string;
  sources?: { streams?: string[]; youtube?: string[] };
  languages?: string[];
  country?: string;
  isGeoBlocked?: boolean;
}

export function parseFamelack(text: string): PlaylistEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (Array.isArray(data) ? data : []) as FamelackChannel[];
  const out: PlaylistEntry[] = [];
  for (const c of list) {
    if (!c?.name) continue;
    const name = c.isGeoBlocked ? `${c.name} [Geo-blocked]` : c.name;
    const country = c.country?.toUpperCase();
    const urls = [...(c.sources?.streams ?? []), ...(c.sources?.youtube ?? [])];
    for (const url of urls) {
      if (!/^https?:\/\//i.test(url)) continue;
      out.push({ name, url, groups: [], country: country === 'GB' ? 'UK' : country, language: c.languages?.[0], attrs: {} });
    }
  }
  return out;
}
