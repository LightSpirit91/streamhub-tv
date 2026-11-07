import type { Channel } from '../types';

/**
 * Fills in real logos, network and a short identifying line from the
 * iptv-org channel database (github.com/iptv-org/database).
 */
export interface DbChannel {
  id: string;
  name: string;
  alt_names?: string;
  network?: string;
  country?: string;
  categories?: string;
  is_nsfw?: string;
  closed?: string;
}

export interface DbLogo {
  channel: string;
  feed?: string;
  in_use?: string;
  width?: string;
  format?: string;
  url: string;
}

const COUNTRY: Record<string, string> = {
  US: 'USA', CA: 'Canada', RU: 'Russia', IL: 'Israel', MX: 'Mexico', AR: 'Argentina', CO: 'Colombia', CL: 'Chile',
  PE: 'Peru', VE: 'Venezuela', EC: 'Ecuador', UY: 'Uruguay', PY: 'Paraguay', BO: 'Bolivia', CR: 'Costa Rica',
  PA: 'Panama', GT: 'Guatemala', HN: 'Honduras', SV: 'El Salvador', NI: 'Nicaragua', DO: 'Dominican Republic',
  PR: 'Puerto Rico', CU: 'Cuba', UK: 'UK', GB: 'UK', UA: 'Ukraine', KZ: 'Kazakhstan', BY: 'Belarus', FR: 'France',
  DE: 'Germany', ES: 'Spain', IT: 'Italy', IN: 'India', AT: 'Austria', ZA: 'South Africa',
};

const CATEGORY: Record<string, string> = {
  general: 'General', news: 'News', sports: 'Sports', movies: 'Movies', series: 'Series', entertainment: 'Entertainment',
  documentary: 'Documentary', kids: 'Kids', music: 'Music', comedy: 'Comedy', lifestyle: 'Lifestyle', culture: 'Culture',
  religious: 'Religious', business: 'Business', weather: 'Weather', outdoor: 'Outdoor', travel: 'Travel', cooking: 'Cooking',
  science: 'Science', education: 'Education', classic: 'Classics', family: 'Family', animation: 'Animation', auto: 'Motors',
  legislative: 'Parliament', relax: 'Relax', shop: 'Shopping', public: 'Public TV',
};

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\b(hd|sd|fhd|uhd|4k|tv|channel)\b/g, '').replace(/[^a-z0-9Ѐ-ӿ֐-׿]+/g, '');

function bestLogo(list: DbLogo[]): string | undefined {
  const rank = (l: DbLogo) =>
    (l.in_use === 'TRUE' ? 1000 : 0) + (l.feed ? 0 : 500) + (l.format === 'PNG' || l.format === 'SVG' ? 200 : 0) + Math.min(400, Number(l.width) || 0) / 4;
  return [...list].sort((a, b) => rank(b) - rank(a))[0]?.url;
}

export function tagline(categories: string[], network?: string, country?: string): string | undefined {
  const cat = categories.map((c) => CATEGORY[c]).find(Boolean);
  const where = network || (country ? COUNTRY[country] ?? country : undefined);
  const parts = [cat, where].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export function enrichChannels(channels: Channel[], db: DbChannel[], logos: DbLogo[]): { logos: number; taglines: number } {
  const byId = new Map(db.map((c) => [c.id.toLowerCase(), c]));
  const byName = new Map<string, DbChannel[]>();
  for (const c of db) {
    for (const n of [c.name, ...(c.alt_names ?? '').split(';')].filter(Boolean)) {
      const k = norm(n);
      if (!k) continue;
      byName.set(k, [...(byName.get(k) ?? []), c]);
    }
  }
  const logosBy = new Map<string, DbLogo[]>();
  for (const l of logos) {
    const k = l.channel.toLowerCase();
    logosBy.set(k, [...(logosBy.get(k) ?? []), l]);
  }

  let nLogos = 0;
  let nTag = 0;
  for (const ch of channels) {
    // Pluto TV streams carry the channel id: jmp2.uk/plu-<id>.m3u8
    const pluto = ch.streams.map((st) => /plu-([0-9a-f]{24})/.exec(st.url)?.[1]).find(Boolean);
    if (pluto) {
      ch.network ??= 'Pluto TV';
      ch.logo ??= `https://images.pluto.tv/channels/${pluto}/colorLogoPNG.png`;
    }
    let d = byId.get(ch.id);
    if (!d) {
      const cands = byName.get(norm(ch.name)) ?? [];
      d = cands.find((c) => c.country === ch.country) ?? (cands.length === 1 ? cands[0] : cands.find((c) => /pluto|samsung|roku|plex|xumo|tubi/i.test(c.network ?? '')));
    }
    if (!d || d.is_nsfw === 'TRUE') {
      ch.tagline ??= tagline(ch.categories, ch.network, ch.country);
      if (ch.tagline) nTag++;
      continue;
    }
    const logo = bestLogo(logosBy.get(d.id.toLowerCase()) ?? []);
    if (logo && !ch.logo) {
      ch.logo = logo;
      nLogos++;
    } else if (logo) nLogos++;
    if (d.network) ch.network = d.network;
    const alts = (d.alt_names ?? '').split(';').map((x) => x.trim()).filter((x) => x && x !== ch.name);
    if (alts.length) ch.altNames = [...new Set(alts)].slice(0, 5);
    const cats = (d.categories ?? '').split(';').filter(Boolean);
    for (const c of cats) if (!ch.categories.includes(c)) ch.categories.push(c);
    ch.tagline = tagline(cats.length ? cats : ch.categories, d.network, ch.country ?? d.country);
    if (ch.tagline) nTag++;
  }
  return { logos: nLogos, taglines: nTag };
}
