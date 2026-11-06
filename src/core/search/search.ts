import type { Channel } from '../types';

/**
 * Search across name, country, genre and hub. Built for 10k+ channels on a
 * Fire TV CPU: one pass over a precomputed lowercase string, no regex per item.
 *
 * Aliases let people type the way they think: "первый" finds Channel One,
 * "ערוץ 12" finds Keshet 12, "futbol" finds sports.
 */
const ALIASES: Record<string, string[]> = {
  'первый': ['channel one'],
  'россия': ['russia'],
  'нтв': ['ntv'],
  'звезда': ['zvezda'],
  'тнт': ['tnt'],
  'стс': ['sts'],
  'рен': ['ren tv'],
  'матч': ['match!'],
  'кан': ['kan'],
  'כאן': ['kan'],
  'קשת': ['keshet'],
  'רשת': ['reshet'],
  'ערוץ': ['channel'],
  'futbol': ['sports', 'deportes'],
  'fútbol': ['sports', 'deportes'],
  'soccer': ['sports', 'golazo'],
  'boxing': ['boxing', 'fight', 'top rank'],
  'mma': ['ufc', 'pfl', 'bellator', 'fight'],
  'animals': ['wildlife', 'nature', 'animal'],
  'movies': ['cinema', 'movies'],
  'peliculas': ['cinema', 'movies'],
  'кино': ['kino', 'cinema'],
};

const COUNTRY_WORDS: Record<string, string> = {
  usa: 'us', america: 'us', american: 'us', canada: 'ca', russia: 'ru', russian: 'ru',
  israel: 'il', israeli: 'il', mexico: 'mx', argentina: 'ar', colombia: 'co', chile: 'cl',
  peru: 'pe', venezuela: 've', cuba: 'cu',
};

function expand(term: string): string[] {
  const out = [term];
  for (const [k, v] of Object.entries(ALIASES)) if (term.startsWith(k) || k.startsWith(term)) out.push(...v);
  const cc = COUNTRY_WORDS[term];
  if (cc) out.push(` ${cc} `);
  return out;
}

export function searchChannels(channels: Channel[], query: string, limit = 120): Channel[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).map(expand);
  const scored: { c: Channel; s: number }[] = [];
  for (const c of channels) {
    const hay = ` ${c.search} `;
    let s = 0;
    let all = true;
    for (const alts of terms) {
      let hit = 0;
      for (const t of alts) {
        const i = hay.indexOf(t);
        if (i !== -1) {
          hit = Math.max(hit, i === 1 ? 3 : hay[i - 1] === ' ' ? 2 : 1);
        }
      }
      if (!hit) {
        all = false;
        break;
      }
      s += hit;
    }
    if (all) scored.push({ c, s: s * 100 + (c.streams[0]?.score ?? 0) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.c);
}
