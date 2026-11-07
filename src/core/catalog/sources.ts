/**
 * Playlist sources, verified on 2026-11-06.
 *
 * Every source has mirrors. The loader tries them in order, so a GitHub
 * Pages outage falls back to raw.githubusercontent.com automatically.
 *
 * Tier 1  StreamHub catalog: built nightly by scripts/channel-doctor.ts,
 *         already merged, deduped and health-checked. Smallest download.
 * Tier 2  iptv-org playlists (community index of publicly available streams,
 *         refreshed by iptv-org daily). Parsed on device.
 * Tier 3  Free-TV/IPTV (curated, free-to-air only, maintained by hand).
 */

const IPTV_ORG = 'https://iptv-org.github.io/iptv';
const IPTV_ORG_RAW = 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams';

export const STREAMHUB_CATALOG_URL =
  'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/catalog.json';
export const STREAMHUB_MOVIES_URL =
  'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/movies.json';
export const STREAMHUB_SHOWS_URL =
  'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/shows.json';
export const STREAMHUB_UPCOMING_URL =
  'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/upcoming.json';
export const STREAMHUB_EPG_URL =
  'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/epg.json';
/** This week's sports and fights from every channel's guide (built nightly). */
export const STREAMHUB_SPORTS_URL =
  'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/sports-week.json';
/** Refresh settings, source health and audit history (built nightly). */
export const STREAMHUB_STATUS_URL =
  'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/status.json';
/** Week-long schedule, split in small files (see weekBucket). */
export const streamhubEpgWeekUrl = (bucket: number) =>
  `https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/epg-week/${bucket}.json`;

export interface PlaylistSource {
  id: string;
  label: string;
  urls: string[];
  /** If set, entries whose country is not in this set are dropped. */
  countryFilter?: Set<string>;
  /** Extra category stamped on every entry, e.g. 'lang:heb' -> Israel hub. */
  tag?: string;
  /** Country for entries that don't carry one (whole lineups for one country). */
  country?: string;
  /** Ignore the playlist's own channel ids and merge by name (FAST lineups). */
  byName?: boolean;
  /** Playlist format. Default m3u. */
  format?: 'm3u' | 'famelack';
  /** Only entries whose name matches are kept (e.g. sports channels from another country's lineup). */
  nameFilter?: RegExp;
  /** Block list: every stream URL in this playlist is removed from all other sources. */
  deny?: boolean;
  /** Loaded only when the user opens "Explore All". */
  lazy?: boolean;
}

export const LATAM = [
  'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'UY', 'PY', 'BO',
  'CR', 'PA', 'GT', 'HN', 'SV', 'NI', 'DO', 'PR', 'CU',
] as const;

/** Countries the profile cares about. Category feeds are filtered to these. */
export const PROFILE_COUNTRIES = new Set<string>([
  'US', 'CA', 'UK', 'GB', 'RU', 'IL', ...LATAM, 'INT',
]);

/** iptv-org splits big countries into provider files on the raw mirror. */
const RAW_PROVIDER_FILES: Record<string, string[]> = {
  us: [
    'us', 'us_pluto', 'us_roku', 'us_tubi', 'us_xumo', 'us_stirr', 'us_local', 'us_firetv', 'us_pbs', 'us_cbsn', 'us_abcnews',
    'us_canelatv', 'us_distro', 'us_vizio', 'us_tcl', 'us_sofast', 'us_30a', 'us_3abn', 'us_afrolandtv', 'us_amagi',
    'us_cineversetv', 'us_frequency', 'us_glewedtv', 'us_klowdtv', 'us_malimartv', 'us_uplynk', 'us_vegasplus', 'us_wcetv',
    'us_wfmz', 'us_wowza',
  ],
  ca: ['ca', 'ca_pluto', 'ca_stingray'],
  uk: ['uk', 'uk_bbc', 'uk_pluto', 'uk_rakuten', 'uk_distro', 'uk_sportstribal'],
  ru: ['ru', 'ru_smotrim', 'ru_ntv', 'ru_rt', 'ru_tvteleport', 'ru_televizor24', 'ru_zabava', 'ru_15plusmg', 'ru_bonustv', 'ru_catcast', 'ru_tvbricks'],
  il: ['il'],
  mx: ['mx', 'mx_pluto', 'mx_multimedios', 'mx_amagi'],
  gt: ['gt', 'gt_streamhispanatv'],
};

function country(cc: string, label: string): PlaylistSource[] {
  const raw = RAW_PROVIDER_FILES[cc] ?? [cc];
  // Primary: one curated file with logos + categories. Mirror: raw provider
  // files (no logos, but same streams), each its own source so one 404 does
  // not sink the rest.
  return [
    {
      id: `iptv-org:country:${cc}`,
      label,
      urls: [`${IPTV_ORG}/countries/${cc}.m3u`, `${IPTV_ORG_RAW}/${raw[0]}.m3u`],
    },
    ...raw.slice(1).map((file) => ({
      id: `iptv-org:raw:${file}`,
      label: `${label} (${file.split('_')[1]})`,
      urls: [`${IPTV_ORG_RAW}/${file}.m3u`],
    })),
  ];
}

function category(cat: string, label: string): PlaylistSource {
  return {
    id: `iptv-org:category:${cat}`,
    label,
    urls: [`${IPTV_ORG}/categories/${cat}.m3u`],
    countryFilter: PROFILE_COUNTRIES,
  };
}

/** Sports and fight channels by name (free ad-supported lineups from other countries). */
export const SPORTS_NAMES =
  /\b(UFC|PFL|BKFC|Bellator|ONE Championship|Top ?Rank|Golden ?Boy|DAZN|Fight|Boxing|Boxeo|MMA|Kickbox(ing)?|GLORY|Wrestling|Combat|Lucha|Bare ?Knuckle|Sports?|Deportes?|NFL|NBA|NHL|MLB|MLS|Golf|Tennis|Racing|Motor ?sports?|Speed|Rugby|Cricket|F[uú]tbol|Football|Soccer|Olympic|Billiards?|Poker|Darts|Snooker|Cycling|Fishing|Xtreme?|Xtrem|E-?Sports?)\b/i;

/** Licensed free ad-supported lineups in other countries; only their sports channels are taken. */
const FAST_SPORTS_ABROAD = [
  'at_pluto', 'br_pluto', 'ch_pluto', 'de_pluto', 'dk_pluto', 'es_pluto', 'fr_pluto', 'it_pluto', 'no_pluto', 'se_pluto',
  'de_rakuten', 'es_rakuten', 'fi_rakuten', 'fr_rakuten', 'it_rakuten', 'pl_rakuten', 'in_distro',
];

export const SOURCES: PlaylistSource[] = [
  ...country('us', 'United States'),
  ...country('ca', 'Canada'),
  ...country('uk', 'United Kingdom'),
  ...country('ru', 'Russia'),
  ...country('il', 'Israel'),
  ...country('mx', 'Mexico'),
  ...LATAM.filter((c) => c !== 'MX').flatMap((c) => (RAW_PROVIDER_FILES[c.toLowerCase()] ? country(c.toLowerCase(), c) : [country(c.toLowerCase(), c)[0]])),
  category('sports', 'Sports (worldwide)'),
  category('movies', 'Movies (worldwide)'),
  category('documentary', 'Documentary (worldwide)'),
  category('outdoor', 'Outdoor (worldwide)'),
  category('science', 'Science (worldwide)'),
  // Language feeds catch Hebrew and Russian channels broadcast from other
  // countries (Russian-language TV from Israel, Ukraine, Kazakhstan, Baltics...).
  {
    id: 'iptv-org:language:heb',
    label: 'Hebrew-language (worldwide)',
    urls: [`${IPTV_ORG}/languages/heb.m3u`],
    tag: 'lang:heb',
  },
  {
    id: 'iptv-org:language:rus',
    label: 'Russian-language (worldwide)',
    urls: [`${IPTV_ORG}/languages/rus.m3u`],
    tag: 'lang:rus',
  },
  {
    // Links found by the daily GitHub discovery that passed its rules and the
    // real playback check (scripts/discovery.ts). Re-checked every night.
    id: 'discovered',
    label: 'Daily discovery',
    urls: ['https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/discovered.m3u'],
  },
  {
    id: 'free-tv',
    label: 'Free-TV curated',
    urls: [
      'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
      'https://cdn.jsdelivr.net/gh/Free-TV/IPTV@master/playlist.m3u8',
    ],
    countryFilter: PROFILE_COUNTRIES,
  },
  // Famelack: curated + uptime-checked, includes official YouTube 24/7 lives.
  ...['us', 'ca', 'ru', 'il', 'mx', 'ar', 'co', 'cl', 'pe', 've', 'gb'].map((cc) => ({
    id: `famelack:${cc}`,
    label: `Famelack ${cc.toUpperCase()}`,
    urls: [
      `https://raw.githubusercontent.com/famelack/famelack-channels/main/tv/raw/countries/${cc}.json`,
      `https://cdn.jsdelivr.net/gh/famelack/famelack-channels@main/tv/raw/countries/${cc}.json`,
    ],
    format: 'famelack' as const,
  })),
  // Sports and fight channels from Pluto TV, Rakuten TV and Distro lineups abroad (licensed, free with ads).
  ...FAST_SPORTS_ABROAD.map((file) => ({
    id: `iptv-org:raw:${file}`,
    label: `Sports from ${file}`,
    urls: [`${IPTV_ORG_RAW}/${file}.m3u`],
    nameFilter: SPORTS_NAMES,
  })),
  // Samsung TV Plus and Plex are not shown. Their lineups are loaded only as
  // block lists: the same filler streams also appear inside the big country
  // playlists under other hosts, and this removes them there too.
  ...['us_samsung', 'ca_samsung', 'mx_samsung', 'uk_samsung', 'us_plex'].map((file) => ({
    id: `deny:${file}`,
    label: `Blocked: ${file}`,
    urls: [`${IPTV_ORG_RAW}/${file}.m3u`],
    deny: true,
  })),
  {
    id: 'iptv-org:index',
    label: 'Everything (iptv-org full index)',
    urls: [`${IPTV_ORG}/index.m3u`],
    lazy: true,
  },
];

/** Categories never shown, whatever the source says. */
export const BLOCKED_CATEGORIES = new Set(['xxx', 'adult']);
