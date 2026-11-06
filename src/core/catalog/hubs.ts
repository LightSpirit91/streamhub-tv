import type { Channel, HubId } from '../types';
import { LATAM } from './sources';

export interface HubDef {
  id: HubId;
  /** i18n key; English fallback in `title`. */
  titleKey: string;
  title: string;
  /** Accent used for the hub's ambient glow and focus ring. */
  accent: string;
  /** Secondary color for the hub gradient. */
  accent2: string;
}

/** Display order on the home screen. */
export const HUBS: HubDef[] = [
  { id: 'spotlight', titleKey: 'hub.spotlight', title: 'Spotlight', accent: '#F5C451', accent2: '#8A5A00' },
  { id: 'sports', titleKey: 'hub.sports', title: 'Sports Arena', accent: '#22E07A', accent2: '#0B5D3B' },
  { id: 'fight', titleKey: 'hub.fight', title: 'Fight Night', accent: '#FF3B3B', accent2: '#5C0A0A' },
  { id: 'usa', titleKey: 'hub.usa', title: 'American Networks', accent: '#4D8DFF', accent2: '#13306B' },
  { id: 'cinema', titleKey: 'hub.cinema', title: 'Cinema & Indie', accent: '#E8B04A', accent2: '#5A1420' },
  { id: 'latin', titleKey: 'hub.latin', title: 'Latin Hub', accent: '#FF7A45', accent2: '#6B1F3A' },
  { id: 'russian', titleKey: 'hub.russian', title: 'Russian TV', accent: '#7FD4FF', accent2: '#1B2A5E' },
  { id: 'israel', titleKey: 'hub.israel', title: 'Israel', accent: '#5BA8FF', accent2: '#0E2C5A' },
  { id: 'wildlife', titleKey: 'hub.wildlife', title: 'Wild Planet', accent: '#3FD08F', accent2: '#123D2A' },
  { id: 'extreme', titleKey: 'hub.extreme', title: 'Extreme', accent: '#FFD400', accent2: '#4A3A00' },
  { id: 'docs', titleKey: 'hub.docs', title: 'Documentary', accent: '#B48CFF', accent2: '#2A1A55' },
  { id: 'news', titleKey: 'hub.news', title: 'News 24/7', accent: '#FF5A6E', accent2: '#3A0F18' },
  { id: 'canada', titleKey: 'hub.canada', title: 'Canada', accent: '#FF4D4D', accent2: '#4A0E0E' },
  { id: 'kids', titleKey: 'hub.kids', title: 'Kids & Family', accent: '#FF9FD6', accent2: '#4A1D3A' },
];

export const HUB_BY_ID = Object.fromEntries(HUBS.map((h) => [h.id, h])) as Record<HubId, HubDef>;

const LATAM_SET = new Set<string>(LATAM);

const RE = {
  fight: /\b(ufc|mma|bellator|pfl|boxing|boks|box tv|top rank|glory|fight|wwe|aew|kickboxing|wrestling|boets)\b/i,
  sports: /\b(sports?|deportes?|espn|bein|fox sports|nbc sports|cbs sports|golazo|nfl|nba|mlb|nhl|mls|golf|tennis|racing|f1|nascar|match!|futbol|f[uú]tbol|tudn|dazn|eurosport|sportsnet|tsn|fubo|olympic)\b/i,
  latinName: /\b(espa[nñ]ol|latino|latin america|deportes|noticias|telemundo|univision|unimas|canela|azteca|televisa|caracol|telefe|cine latino)\b/i,
  cinema: /\b(movies?|cinema|cin[eé]|film|films|kino|ifc|sundance|lionsgate|moviesphere|cinemax|starz|hallmark|filmrise|western|noir|blockbuster|blokbaster)\b/i,
  wildlife: /\b(nature|wildlife|wild (nature|tv|earth|life)|wildearth|inwild|animal|animals|animales|pets?|ocean|safari|nat ?geo|national geographic|zhivotnykh|love nature|naturescape|animal planet|big planet|bbc earth)\b/i,
  extreme: /\b(red ?bull|xtrem|extreme|surf|skate|moto|motor|motorvision|rally|adrenaline|outdoors?|speed|action sports|hunting|fishing|pbr|ridepass|offroad)\b/i,
  news: /\b(news|noticias|novosti|новости|cnn|bloomberg|cbsn|weather|i24|rt\b|russia-24|mir 24|livenow)\b/i,
  kids: /\b(kids|junior|cartoon|nick|toon|baby|disney jr|carousel|karusel|mult|ani\b)\b/i,
  radio: /\b\d{2,3}([.,]\d)?\s?fm\b|\bradio\b|\bfm$/i,
  cyrillic: /[Ѐ-ӿ]/,
  hebrew: /[֐-׿]/,
};

const has = (cats: string[], ...names: string[]) => cats.some((c) => names.includes(c));

/** Assigns hubs from country, iptv-org categories and channel name. */
export function classify(ch: Pick<Channel, 'name' | 'country' | 'categories'>): HubId[] {
  const hubs = new Set<HubId>();
  const cats = ch.categories.map((c) => c.toLowerCase());
  const n = ch.name;
  const cc = ch.country;

  if (cats.includes('xxx')) return [];
  // Radio stations sneak into TV feeds ("Planet 100.9 FM"). Region only.
  const radio = RE.radio.test(n);

  // Region hubs
  if (cc === 'US') hubs.add('usa');
  if (cc === 'CA') hubs.add('canada');
  if (cc === 'RU' || RE.cyrillic.test(n) || cats.includes('lang:rus')) hubs.add('russian');
  if (cc === 'IL' || RE.hebrew.test(n) || cats.includes('lang:heb')) hubs.add('israel');
  if ((cc && LATAM_SET.has(cc)) || RE.latinName.test(n)) hubs.add('latin');
  // Israel's Channel 9 broadcasts in Russian.
  if (cc === 'IL' && /^(channel 9|9 канал|kanal 9)$/i.test(n)) hubs.add('russian');

  if (radio) return [...hubs];

  // Genre hubs
  if (has(cats, 'sports') || RE.sports.test(n)) hubs.add('sports');
  if (RE.fight.test(n)) {
    hubs.add('fight');
    hubs.add('sports');
  }
  if (has(cats, 'movies', 'classic') || RE.cinema.test(n)) hubs.add('cinema');
  if (RE.wildlife.test(n)) hubs.add('wildlife');
  if (has(cats, 'outdoor', 'auto') || RE.extreme.test(n)) hubs.add('extreme');
  if (has(cats, 'documentary', 'science', 'education') && !hubs.has('wildlife')) hubs.add('docs');
  if (has(cats, 'news', 'weather', 'business') || RE.news.test(n)) hubs.add('news');
  if (has(cats, 'kids', 'animation', 'family') || RE.kids.test(n)) hubs.add('kids');

  // Spanish-language US channels live in Latin too, English ones stay in USA only.
  return [...hubs];
}

/**
 * The channels people actually watch, per region and genre, in order.
 * Rows sort by this first, then by stream quality. Sources: Nielsen top
 * cable/broadcast lists, Mediascope (Russia), Israeli TV ratings committee.
 */
type Pop = RegExp | [RegExp, string];
const POPULAR: Pop[] = [
  // Russia
  /^(channel one|perviy kanal|первый канал)( hd)?$/i, /^(russia-1|россия 1)( hd)?$/i, [/^ntv( hd)?$/i, 'RU'],
  /^(russia-24|россия 24)( hd)?$/i, [/^tnt( hd)?$/i, 'RU'], [/^sts( hd)?$/i, 'RU'], /^ren tv/i, /^zvezda( hd)?$/i,
  /^pyatnitsa/i, /^tv cent(er|re)/i, /^domashniy/i, /^match!/i, [/^mir( hd)?$/i, 'RU'], /^(russia-k|kultura)/i,
  /^muz-tv/i, /^(karusel|carousel)$/i,
  // Israel
  /^kan 11$/i, /^keshet 12$/i, /^(reshet 13|channel 13|ערוץ 13)$/i, /^now 14$/i, /^i24 ?news/i,
  [/^channel 9$/i, 'IL'], /^kan educational$/i, /^knesset channel$/i,
  // USA
  /^cbs news 24\/7$/i, /^nbc news now$/i, /^abc news live$/i, /^livenow from fox$/i, /^fox weather$/i,
  /^bloomberg tv/i, /^pbs( nature)?$/i, /^cnn/i, /^fox news/i, /^moviesphere/i, /^ifc$/i,
  // Sports & fight
  /^ufc$/i, /^nfl channel$/i, /^mlb$/i, /^(the )?nba/i, /^pfl/i, /^top rank/i, /^red bull tv/i,
  /^fubo sports/i, /^cbs sports/i, /^bein sports/i, /^fight network$/i, /^bellator/i, /^golazo|cbs sports golazo/i,
  // Wildlife
  /^love nature/i, /^bbc earth/i, /^wildearth$/i, /^national geographic/i, /^animal planet/i, /^discovery/i,
];

export function popularity(name: string, country?: string): number {
  const n = name.trim();
  const i = POPULAR.findIndex((p) =>
    Array.isArray(p) ? p[1] === country && p[0].test(n) : p.test(n),
  );
  let p = i === -1 ? 0 : 100 - i;
  if (/\(\+\d+\)|\+\d+$/.test(name)) p -= 30; // time-shifted copies ("Russia-1 +4")
  return p;
}

/**
 * Spotlight = the premium "HBO-style" hero hub: best quality, trusted
 * sources, and headliner names from the profile.
 */
const HEADLINERS = /\b(ufc|nfl|nba|mlb|red bull|love nature|cbs news|nbc news|abc news|bloomberg|kan 11|keshet 12|reshet 13|channel one|russia-1|ntv|ifc|moviesphere|national geographic|discovery|animal planet|wildearth|top rank|pfl)\b/i;

export function spotlightScore(ch: Channel): number {
  const best = ch.streams[0];
  if (!best) return -1;
  let s = best.score;
  if (HEADLINERS.test(ch.name)) s += 40;
  s += ch.popularity * 0.4;
  if (ch.logo) s += 10;
  if (ch.bestHeight >= 2160) s += 25;
  return s;
}
