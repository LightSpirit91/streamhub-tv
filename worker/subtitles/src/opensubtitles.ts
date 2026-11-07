/**
 * OpenSubtitles REST API client for the StreamHub subtitle backend.
 * Runs only on the server (Cloudflare Worker). Credentials come from the
 * Worker's encrypted secrets and never leave it: no logging of keys, user
 * names, passwords or tokens, and none of them in any response.
 *
 * API rules followed (OpenSubtitles REST API v1):
 * - Every request sends Api-Key and a named User-Agent ("StreamHub v1.0").
 * - Log in once, reuse the token (~24 h), use the base_url the login returns;
 *   log in again only when a call answers 401.
 * - Query parameters lowercase, in alphabetical order, language codes sorted,
 *   imdb ids without "tt" or leading zeros (other forms are redirected).
 * - Respect the 429 rate limit and the daily download allowance (406 / remaining).
 */

export type Lang = 'en' | 'es' | 'ru' | 'he';
export const LANGS: Lang[] = ['en', 'es', 'he', 'ru']; // alphabetical

export interface Creds {
  apiKey: string;
  username: string;
  password: string;
}

export interface SearchQuery {
  imdbId: string; // tt0051744 or 51744
  lang: Lang;
  /** Series: the show's IMDb id is imdbId; season and episode pick the episode. */
  season?: number;
  episode?: number;
}

export interface SubResult {
  fileId: number;
  lang: Lang;
  release: string;
  downloads: number;
  hearingImpaired: boolean;
  fps?: number;
  uploader?: string;
}

export type ApiError =
  | { kind: 'auth'; status?: number; blocked?: boolean } // login refused (401 wrong credentials; 403 + HTML page = blocked by a firewall)
  | { kind: 'quota'; resetTime?: string } // today's free downloads used up
  | { kind: 'busy' } // rate limited
  | { kind: 'notfound' }
  | { kind: 'upstream'; status: number; stage?: Stage; html?: boolean };

/** Where a failure happened. Safe to log: it never contains secrets or response data. */
export type Stage = 'login-network' | 'login-json' | 'search-network' | 'search-json' | 'search-shape' | 'download-network' | 'download-json' | 'file-network';

export class OsError extends Error {
  constructor(public info: ApiError) {
    super(info.kind);
  }
}

/** Network call that never throws a raw error: failures become labelled OsErrors. */
async function net(f: Fetch, url: string, init: RequestInit, stage: Stage): Promise<Response> {
  try {
    return await f(url, init);
  } catch {
    throw new OsError({ kind: 'upstream', status: 0, stage });
  }
}

/** JSON body, or a labelled OsError when the reply isn't JSON. */
async function body<T>(res: Response, stage: Stage): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new OsError({ kind: 'upstream', status: res.status, stage });
  }
}

export const UA = 'StreamHub v1.0';
const DEFAULT_BASE = 'https://api.opensubtitles.com/api/v1';
const TOKEN_TTL_MS = 23 * 3_600_000;

/** "tt0051744" -> "51744" */
export const imdbNum = (id: string) => String(Number(String(id).replace(/^tt/i, '')) || '');

/** Search URL with parameters lowercase and in alphabetical order. */
export function searchPath(q: SearchQuery): string {
  const p: Record<string, string> = {
    ai_translated: 'exclude',
    languages: q.lang,
    machine_translated: 'exclude',
    order_by: 'download_count',
  };
  if (q.season != null && q.episode != null) {
    p.episode_number = String(q.episode);
    p.parent_imdb_id = imdbNum(q.imdbId);
    p.season_number = String(q.season);
  } else {
    p.imdb_id = imdbNum(q.imdbId);
  }
  const qs = Object.keys(p)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(p[k]).toLowerCase()}`)
    .join('&');
  return `/subtitles?${qs}`;
}

interface RawHit {
  attributes: {
    language?: string;
    release?: string;
    download_count?: number;
    hearing_impaired?: boolean;
    fps?: number;
    ai_translated?: boolean;
    machine_translated?: boolean;
    uploader?: { name?: string };
    files?: { file_id: number; file_name?: string }[];
  };
}

/** Best results first: human-made, not hearing-impaired first, most downloaded. */
export function toResults(data: RawHit[], lang: Lang, max = 8): SubResult[] {
  return data
    .filter((d) => Array.isArray(d.attributes.files) && d.attributes.files.length && Number.isInteger(d.attributes.files[0]?.file_id) && !d.attributes.ai_translated && !d.attributes.machine_translated)
    .filter((d) => (d.attributes.language ?? '').toLowerCase().startsWith(lang))
    .map((d) => ({
      fileId: d.attributes.files![0].file_id,
      lang,
      release: (d.attributes.release || d.attributes.files![0].file_name || 'Subtitle').slice(0, 120),
      downloads: d.attributes.download_count ?? 0,
      hearingImpaired: !!d.attributes.hearing_impaired,
      fps: d.attributes.fps || undefined,
      uploader: d.attributes.uploader?.name,
    }))
    .sort((a, b) => Number(a.hearingImpaired) - Number(b.hearingImpaired) || b.downloads - a.downloads)
    .slice(0, max);
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** One client per Worker instance: holds the token in memory. */
export class OpenSubtitles {
  private token = '';
  private tokenAt = 0;
  private base = DEFAULT_BASE;
  /** Last known download allowance (from login or the last download). */
  quota: { remaining?: number; resetTime?: string } = {};

  // Cloudflare's fetch must not be called as a method of another object ("Illegal invocation"):
  // the default wraps it in a plain function.
  constructor(private creds: Creds, private fetcher: Fetch = (url, init) => fetch(url, init), private now = () => Date.now()) {}

  private headers(auth: boolean): Record<string, string> {
    return {
      'Api-Key': this.creds.apiKey,
      'User-Agent': UA,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  /** After a refused login, wait before trying again: OpenSubtitles locks accounts after ~10 failures. */
  private authFailedAt = -Infinity;
  static AUTH_COOLDOWN_MS = 30 * 60_000;

  private async login(): Promise<void> {
    if (this.now() - this.authFailedAt < OpenSubtitles.AUTH_COOLDOWN_MS) throw new OsError({ kind: 'auth' });
    const res = await net(this.fetcher, `${DEFAULT_BASE}/login`, {
      method: 'POST',
      headers: this.headers(false),
      body: JSON.stringify({ username: this.creds.username, password: this.creds.password }),
    }, 'login-network');
    if (res.status === 401 || res.status === 403) {
      this.authFailedAt = this.now();
      // An HTML page instead of the API's JSON means a firewall stopped the request, not the account.
      const blocked = !(res.headers.get('content-type') ?? '').includes('json');
      throw new OsError({ kind: 'auth', status: res.status, blocked });
    }
    if (res.status === 429) throw new OsError({ kind: 'busy' });
    if (!res.ok) throw new OsError({ kind: 'upstream', status: res.status, stage: 'login-network' });
    const j = await body<{ token?: string; base_url?: string; user?: { remaining_downloads?: number } }>(res, 'login-json');
    if (!j.token) {
      this.authFailedAt = this.now();
      throw new OsError({ kind: 'auth' });
    }
    this.authFailedAt = -Infinity;
    this.token = j.token;
    this.tokenAt = this.now();
    if (j.base_url) this.base = `https://${j.base_url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/api/v1`;
    if (j.user?.remaining_downloads != null) this.quota.remaining = j.user.remaining_downloads;
  }

  private async ensureToken() {
    if (!this.token || this.now() - this.tokenAt > TOKEN_TTL_MS) await this.login();
  }

  /** Search needs only the API key: no login, so a login problem never blocks it. */
  private async anonymous(path: string, init: RequestInit = {}, stage: Stage = 'search-network'): Promise<Response> {
    const res = await net(this.fetcher, `${DEFAULT_BASE}${path}`, { ...init, headers: this.headers(false) }, stage);
    if (res.status === 429) throw new OsError({ kind: 'busy' });
    return res;
  }

  /** Authenticated call; on 401 the token is renewed once and the call repeated. */
  private async call(path: string, init: RequestInit = {}, stage: Stage = 'search-network', retried = false): Promise<Response> {
    await this.ensureToken();
    const res = await net(this.fetcher, `${this.base}${path}`, { ...init, headers: this.headers(true) }, stage);
    if (res.status === 401 && !retried) {
      this.token = '';
      return this.call(path, init, stage, true);
    }
    if (res.status === 429) throw new OsError({ kind: 'busy' });
    return res;
  }

  async search(q: SearchQuery): Promise<SubResult[]> {
    if (!imdbNum(q.imdbId) || !LANGS.includes(q.lang)) throw new OsError({ kind: 'notfound' });
    const res = await this.anonymous(searchPath(q));
    // html = a firewall page answered (blocked), not the API (JSON: e.g. API key refused).
    if (!res.ok) throw new OsError({ kind: 'upstream', status: res.status, stage: 'search-network', html: !(res.headers.get('content-type') ?? '').includes('json') });
    const j = await body<{ data?: unknown }>(res, 'search-json');
    if (j.data != null && !Array.isArray(j.data)) throw new OsError({ kind: 'upstream', status: res.status, stage: 'search-shape' });
    // Skip any entry missing the fields we rely on instead of failing the whole search.
    const data = ((j.data as RawHit[] | undefined) ?? []).filter((d) => d && typeof d === 'object' && d.attributes && typeof d.attributes === 'object');
    return toResults(data, q.lang);
  }

  /** Downloads one subtitle file (uses one of today's downloads) and returns its text. */
  async download(fileId: number): Promise<{ text: string; remaining?: number; resetTime?: string }> {
    if (this.quota.remaining != null && this.quota.remaining <= 0) throw new OsError({ kind: 'quota', resetTime: this.quota.resetTime });
    const req = { method: 'POST', body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }) };
    let res: Response;
    try {
      res = await this.call('/download', req, 'download-network');
    } catch (e) {
      // Login refused: try once without logging in (OpenSubtitles may allow a few anonymous downloads).
      if (!(e instanceof OsError) || e.info.kind !== 'auth') throw e;
      res = await this.anonymous('/download', req, 'download-network');
      if (res.status === 401 || res.status === 403) throw e;
    }
    const j = (await res.json().catch(() => ({}))) as { link?: string; remaining?: number; reset_time_utc?: string; reset_time?: string; message?: string };
    const resetTime = j.reset_time_utc ?? j.reset_time;
    if (res.status === 406 || (res.ok && !j.link && (j.remaining ?? 1) <= 0)) {
      this.quota = { remaining: 0, resetTime };
      throw new OsError({ kind: 'quota', resetTime });
    }
    if (res.status === 404) throw new OsError({ kind: 'notfound' });
    if (!res.ok || !j.link) throw new OsError({ kind: 'upstream', status: res.status, stage: 'download-json' });
    this.quota = { remaining: j.remaining, resetTime };
    const file = await net(this.fetcher, j.link, { headers: { 'User-Agent': UA } }, 'file-network');
    if (!file.ok) throw new OsError({ kind: 'upstream', status: file.status, stage: 'file-network' });
    const text = await file.text();
    if (!/-->/.test(text)) throw new OsError({ kind: 'notfound' });
    return { text, remaining: j.remaining, resetTime };
  }
}
