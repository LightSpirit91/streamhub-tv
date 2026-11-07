/**
 * Real playback check: a link only counts as working when it leads to
 * actual media bytes, not when a page merely answers 200.
 *
 * HLS: master playlist -> first variant -> media playlist with segments ->
 * first segment, whose first bytes must be MPEG-TS (0x47 sync bytes),
 * fragmented MP4 (ftyp/styp/moof/sidx boxes), AAC/ADTS or ID3 audio.
 * Progressive: the first bytes must be MP4 / WebM / TS.
 * Rejected: HTML or JSON error pages, empty playlists, ended streams
 * (#EXT-X-ENDLIST on a live channel), placeholders, unsafe addresses.
 *
 * Pure: the network is passed in, so it is unit-tested without the internet.
 */
import { isSafeUrl } from './safeUrl';

export type Verdict =
  | { ok: true; kind: 'hls' | 'progressive' | 'dash'; detail: string; cors?: boolean }
  | { ok: false; cors?: boolean; reason: 'unsafe' | 'http' | 'locked' | 'timeout' | 'not-media' | 'empty' | 'ended' | 'html' | 'too-deep' | 'network' | 'skipped'; detail: string };

export type GetBytes = (url: string, headers?: Record<string, string>) => Promise<{ status: number; type: string; bytes: Uint8Array; finalUrl: string; cors?: boolean }>;

const td = new TextDecoder();
const startsWith = (b: Uint8Array, s: string) => s.split('').every((c, i) => b[i] === c.charCodeAt(0));

/** Does this look like the start of a media file? */
export function looksLikeMedia(b: Uint8Array): string | undefined {
  if (b.length >= 189 && b[0] === 0x47 && b[188] === 0x47) return 'mpeg-ts';
  if (b.length >= 1 && b[0] === 0x47 && b.length < 189) return 'mpeg-ts';
  if (b.length >= 8) {
    const box = td.decode(b.subarray(4, 8));
    if (['ftyp', 'styp', 'moof', 'sidx', 'moov', 'mdat', 'emsg', 'prft'].includes(box)) return `mp4 (${box})`;
  }
  if (startsWith(b, 'ID3')) return 'id3 audio';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return undefined;
}

const isHtml = (b: Uint8Array, type: string) => /html|json|xml/.test(type) && !/mpegurl|dash/.test(type) || /^\s*(<!doctype|<html|\{)/i.test(td.decode(b.subarray(0, 64)));

/** First variant (master) or first segment (media) of a playlist, absolute. */
export function nextUri(text: string, base: string): { kind: 'variant' | 'segment'; uri: string } | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l.startsWith('#')) {
      // fMP4 init segment counts as media too
      const map = /^#EXT-X-MAP:.*URI="([^"]+)"/.exec(l);
      if (map && !isMaster) return { kind: 'segment', uri: new URL(map[1], base).toString() };
      continue;
    }
    return { kind: isMaster ? 'variant' : 'segment', uri: new URL(l, base).toString() };
  }
  return undefined;
}

export async function validateStream(
  url: string,
  get: GetBytes,
  opts: { format?: 'hls' | 'dash' | 'progressive' | 'youtube'; headers?: Record<string, string>; live?: boolean } = {},
): Promise<Verdict> {
  if (!isSafeUrl(url)) return { ok: false, reason: 'unsafe', detail: 'address not allowed' };
  const format = opts.format ?? (/\.mpd(\?|$)/i.test(url) ? 'dash' : /\.(mp4|webm|ts)(\?|$)/i.test(url) ? 'progressive' : 'hls');
  let u = url;
  let cors: boolean | undefined;
  for (let depth = 0; depth < 4; depth++) {
    let r;
    try {
      r = await get(u, opts.headers);
    } catch (e) {
      const name = (e as Error).name;
      return { ok: false, reason: name === 'AbortError' ? 'timeout' : name === 'BudgetError' ? 'skipped' : 'network', detail: name };
    }
    if (depth === 0) cors = r.cors;
    if (!isSafeUrl(r.finalUrl)) return { ok: false, reason: 'unsafe', detail: 'redirected to an address not allowed' };
    if (r.status === 401 || r.status === 403 || r.status === 451) return { ok: false, reason: 'locked', detail: `HTTP ${r.status}` };
    if (r.status >= 400 || r.status === 0) return { ok: false, reason: 'http', detail: `HTTP ${r.status}` };
    const media = looksLikeMedia(r.bytes);
    if (media) return { ok: true, kind: format === 'progressive' || depth === 0 ? 'progressive' : 'hls', detail: media, cors };
    if (format === 'dash') {
      const t = td.decode(r.bytes);
      return /<MPD[\s>]/.test(t) ? { ok: true, kind: 'dash', detail: 'mpd manifest', cors } : { ok: false, reason: isHtml(r.bytes, r.type) ? 'html' : 'not-media', detail: 'no MPD manifest' };
    }
    if (format === 'progressive') return { ok: false, reason: isHtml(r.bytes, r.type) ? 'html' : 'not-media', detail: r.type || 'unknown' };
    const text = td.decode(r.bytes);
    if (!text.trimStart().startsWith('#EXTM3U')) return { ok: false, reason: isHtml(r.bytes, r.type) ? 'html' : 'not-media', detail: depth ? 'segment is not media' : 'not a playlist' };
    // A live channel whose media playlist has ended is a dead or expired stream.
    const isMediaPl = !text.includes('#EXT-X-STREAM-INF');
    if (opts.live && isMediaPl && text.includes('#EXT-X-ENDLIST') && !text.includes('#EXT-X-PLAYLIST-TYPE:VOD')) {
      return { ok: false, reason: 'ended', detail: 'playlist has ended' };
    }
    const next = nextUri(text, r.finalUrl);
    if (!next) return { ok: false, reason: 'empty', detail: 'playlist has no entries' };
    if (!isSafeUrl(next.uri)) return { ok: false, reason: 'unsafe', detail: 'entry points to an address not allowed' };
    u = next.uri;
  }
  return { ok: false, reason: 'too-deep', detail: 'too many nested playlists' };
}
