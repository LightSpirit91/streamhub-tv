/**
 * App side of OpenSubtitles: talks to the StreamHub subtitle backend, which
 * holds the OpenSubtitles credentials. The app only knows the backend's
 * public address (EXPO_PUBLIC_SUBTITLES_API, a URL, not a secret). When it is
 * not set, OpenSubtitles search stays hidden.
 */
import type { SubLang } from './subtitles';

export const SUBTITLE_API = (process.env.EXPO_PUBLIC_SUBTITLES_API ?? '').replace(/\/$/, '');
export const subtitleSearchEnabled = () => !!SUBTITLE_API;

export interface OsResult {
  fileId: number;
  lang: SubLang;
  release: string;
  downloads: number;
  hearingImpaired: boolean;
}

/** What the player shows when something goes wrong. */
export class SubtitleServiceError extends Error {
  constructor(public reason: 'quota' | 'notfound' | 'busy' | 'unavailable', public resetTime?: string) {
    super(reason);
  }
}

export function subtitleErrorText(e: unknown, langLabel: string): string {
  if (!(e instanceof SubtitleServiceError)) return 'Subtitle service unavailable right now. Try again later.';
  if (e.reason === 'quota') {
    const at = e.resetTime ? new Date(e.resetTime) : undefined;
    return `Today's free subtitle downloads are used up${at && !Number.isNaN(at.getTime()) ? `. They reset at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}. Subtitles you already opened still work.`;
  }
  if (e.reason === 'notfound') return `No ${langLabel} subtitles found on OpenSubtitles for this title.`;
  if (e.reason === 'busy') return 'OpenSubtitles is busy. Try again in a minute.';
  return 'Subtitle service unavailable right now. Try again later.';
}

async function call<T>(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(`${SUBTITLE_API}${path}`, init);
  } catch {
    throw new SubtitleServiceError('unavailable');
  }
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; resetTime?: string };
  if (!res.ok) {
    const r = j.error === 'quota' || j.error === 'notfound' || j.error === 'busy' ? j.error : 'unavailable';
    throw new SubtitleServiceError(r, j.resetTime);
  }
  return j;
}

export interface SubtitleTarget {
  imdbId: string;
  season?: number;
  episode?: number;
}

export async function searchSubtitles(t: SubtitleTarget, lang: SubLang, fetcher?: typeof fetch): Promise<OsResult[]> {
  const q = new URLSearchParams({ imdb: t.imdbId, lang });
  if (t.season != null && t.episode != null) {
    q.set('season', String(t.season));
    q.set('episode', String(t.episode));
  }
  const r = await call<{ results: OsResult[] }>(`/search?${q}`, undefined, fetcher);
  if (!r.results.length) throw new SubtitleServiceError('notfound');
  return r.results;
}

export async function downloadSubtitle(fileId: number, fetcher?: typeof fetch): Promise<{ text: string; remaining?: number }> {
  return call(`/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId }) }, fetcher);
}
