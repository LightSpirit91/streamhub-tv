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
export const STREAMHUB_EPG_URL =
  'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/epg.json';

export interface PlaylistSource {
  id: string;
  label: string;
  urls: string[];
  /** If set, entries whose country is not in this set are dropped. */
  countryFilter?: Set<string>;
  /** Extra category stamped on every entry, e.g. 'lang:heb' -> Israel hub. */
  tag?: string;
  /** Playlist format. Default m3u. */
  format?: 'm3u' | 'famelack';
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
  us: ['us', 'us_pluto', 'us_samsung', 'us_roku', 'us_plex', 'us_tubi', 'us_xumo', 'us_stirr', 'us_local', 'us_firetv', 'us_pbs', 'us_cbsn', 'us_abcnews', 'us_canelatv', 'us_distro', 'us_vizio', 'us_tcl', 'us_sofast'],
  ca: ['ca', 'ca_pluto', 'ca_samsung', 'ca_stingray'],
  ru: ['ru', 'ru_smotrim', 'ru_ntv', 'ru_rt', 'ru_tvteleport', 'ru_televizor24', 'ru_zabava'],
  il: ['il'],
  mx: ['mx', 'mx_pluto', 'mx_samsung', 'mx_multimedios'],
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

export const SOURCES: PlaylistSource[] = [
  ...country('us', 'United States'),
  ...country('ca', 'Canada'),
  ...country('ru', 'Russia'),
  ...country('il', 'Israel'),
  ...country('mx', 'Mexico'),
  ...LATAM.filter((c) => c !== 'MX').map((c) => country(c.toLowerCase(), c)[0]),
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
  {
    id: 'iptv-org:index',
    label: 'Everything (iptv-org full index)',
    urls: [`${IPTV_ORG}/index.m3u`],
    lazy: true,
  },
];

/** Categories never shown, whatever the source says. */
export const BLOCKED_CATEGORIES = new Set(['xxx', 'adult']);
