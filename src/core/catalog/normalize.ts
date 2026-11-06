import type { PlaylistEntry, Stream, TrustTier } from '../types';

/** Hosts run by the channel owner or a licensed free (FAST) platform. */
const OFFICIAL_HOST_PATTERNS: RegExp[] = [
  /(^|\.)jmp2\.uk$/, // Pluto TV redirector used by iptv-org
  /(^|\.)pluto\.tv$/,
  /(^|\.)samsung\.wurl\.(com|tv)$/,
  /(^|\.)wurl\.(com|tv)$/,
  /mediatailor\.[a-z0-9-]+\.amazonaws\.com$/,
  /(^|\.)amagi\.tv$/,
  /(^|\.)roku\.com$/,
  /(^|\.)plex\.tv$/,
  /(^|\.)xumo\.com$/,
  /(^|\.)tubi(tv)?\.(com|io)$/,
  /(^|\.)stirr\.com$/,
  /(^|\.)stingray\.com$/,
  /(^|\.)cbsn?(news)?\.com$/,
  /(^|\.)abcnews\.(go\.)?com$/,
  /(^|\.)nbcnews\.com$/,
  /(^|\.)foxweather\.com$/,
  /(^|\.)bloomberg\.com$/,
  /(^|\.)redbull\.(tv|com)$/,
  /(^|\.)pbs\.org$/,
  /(^|\.)smotrim\.ru$/,
  /(^|\.)1tv\.(ru|com)$/,
  /(^|\.)ntv\.ru$/,
  /(^|\.)medonecdn\.net$/, // Kan (Israel public broadcaster)
  /(^|\.)mako\.co\.il$/, // Keshet 12
  /(^|\.)reshet\.tv$/,
  /(^|\.)i24news\.tv$/,
  /(^|\.)cbc\.ca$/,
  /(^|\.)globalnews\.ca$/,
];

const OFFICIAL_SOURCE_FILES = /_(pluto|samsung|roku|plex|tubi|xumo|stirr|stingray|firetv|vizio|tcl|distro|amagi|pbs|cbsn|abcnews|smotrim|ntv|rt)$/;

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;

export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

export function trustOf(url: string, sourceId: string): TrustTier {
  if (youtubeId(url)) return 'official'; // posted by the channel owner on YouTube
  const host = hostOf(url);
  if (OFFICIAL_HOST_PATTERNS.some((re) => re.test(host))) return 'official';
  if (OFFICIAL_SOURCE_FILES.test(sourceId)) return 'official';
  if (IPV4_HOST.test(host) || url.startsWith('http://')) return 'unverified';
  return 'public';
}

/** Video id from youtube embed / watch / youtu.be links. Channel or live pages return undefined. */
export function youtubeId(url: string): string | undefined {
  const m =
    /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/.exec(url) ??
    /youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/.exec(url) ??
    /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url);
  return m?.[1];
}

export function formatOf(url: string): Stream['format'] | null {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (youtubeId(url)) return 'youtube';
  if (/(twitch\.tv|youtube\.com|youtu\.be|dailymotion\.com)\//i.test(url)) return null;
  if (path.endsWith('.mpd')) return 'dash';
  if (path.endsWith('.mp4') || path.endsWith('.ts')) return 'progressive';
  // .m3u8, extensionless redirectors (jmp2.uk/plu-...m3u8), /playlist, /index
  return 'hls';
}

export interface NameInfo {
  clean: string;
  height: number;
  geoBlocked: boolean;
  notAlwaysOn: boolean;
}

/**
 * "Kan 11 (1080p) [Geo-blocked]" -> { clean: "Kan 11", height: 1080, geoBlocked: true }
 * Free-TV uses circled letters: Ⓖ geo-blocked, Ⓨ YouTube, Ⓣ Twitch, Ⓢ etc.
 */
export function parseName(raw: string): NameInfo {
  let name = raw;
  let height = 0;
  const q = /\((\d{3,4})[pi]\)/i.exec(name);
  if (q) height = parseInt(q[1], 10);
  if (!height && /\b(4k|uhd)\b/i.test(name)) height = 2160;
  const geoBlocked = /\[geo-blocked\]|Ⓖ/i.test(name);
  const notAlwaysOn = /\[not 24\/7\]/i.test(name);
  name = name
    .replace(/\((\d{3,4})[pi]\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[Ⓐ-ⓩ]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { clean: name || raw.trim(), height, geoBlocked, notAlwaysOn };
}

/** iptv-org ids look like "Kan11.il@SD". Country is the suffix after the dot. */
export function countryFromTvgId(tvgId?: string): string | undefined {
  if (!tvgId) return undefined;
  const m = /\.([a-z]{2})(@|$)/i.exec(tvgId);
  if (!m) return undefined;
  const cc = m[1].toUpperCase();
  return cc === 'GB' ? 'UK' : cc;
}

export function channelKey(entry: PlaylistEntry, cleanName: string, country?: string): string {
  if (entry.tvgId) return entry.tvgId.split('@')[0].toLowerCase();
  const slug = cleanName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(hd|sd|fhd|uhd|4k|tv)\b/g, '')
    .replace(/[^a-z0-9Ѐ-ӿ֐-׿]+/g, '');
  return `${slug}.${(country ?? 'int').toLowerCase()}`;
}

export function qualityPoints(height: number): number {
  if (height >= 2160) return 100;
  if (height >= 1440) return 90;
  if (height >= 1080) return 80;
  if (height >= 720) return 62;
  if (height >= 540) return 42;
  if (height >= 400) return 35;
  if (height > 0) return 18;
  return 50; // unknown: often adaptive HLS with several renditions
}

export function scoreStream(s: Omit<Stream, 'score'>): number {
  let score = qualityPoints(s.height);
  if (s.url.startsWith('https://')) score += 12;
  if (s.trust === 'official') score += 25;
  if (s.trust === 'unverified') score -= 30;
  if (s.geoBlocked) score -= 35;
  if (s.notAlwaysOn) score -= 15;
  if (s.format === 'dash') score -= 5; // HLS is the most reliable path on all players
  if (s.format === 'youtube') score -= 20; // official, but prefer a direct stream when there is one
  return score;
}

export function toStream(entry: PlaylistEntry, info: NameInfo, sourceId: string): Stream | null {
  const format = formatOf(entry.url);
  if (!format) return null;
  if (format === 'youtube') entry = { ...entry, url: `https://www.youtube-nocookie.com/embed/${youtubeId(entry.url)}` };
  const headers: Record<string, string> = {};
  if (entry.userAgent) headers['User-Agent'] = entry.userAgent;
  if (entry.referrer) headers['Referer'] = entry.referrer;
  const base = {
    url: entry.url,
    height: info.height,
    geoBlocked: info.geoBlocked,
    notAlwaysOn: info.notAlwaysOn,
    trust: trustOf(entry.url, sourceId),
    headers: Object.keys(headers).length ? headers : undefined,
    format,
    source: sourceId,
  };
  return { ...base, score: scoreStream(base) };
}
