/**
 * StreamHub subtitle backend (Cloudflare Worker, free plan).
 * The app asks it to search and fetch OpenSubtitles subtitles on demand; the
 * OpenSubtitles credentials live only here, as encrypted Worker secrets.
 *
 * GET  /search?imdb=tt0051744&lang=es[&season=1&episode=2]
 * POST /download   {"fileId": 123}
 * GET  /quota
 */
import { LANGS, OpenSubtitles, OsError, type Lang } from './opensubtitles';

export interface Env {
  OS_API_KEY: string;
  OS_USERNAME: string;
  OS_PASSWORD: string;
  /** Comma-separated origins allowed to call this backend. */
  ALLOWED_ORIGINS: string;
}

let client: OpenSubtitles | null = null;

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });

/**
 * Error answers carry only a reason the app can show plus a short diagnostic
 * label (stage / upstream status / exception name). Never secrets, headers,
 * response bodies or tokens.
 */
export function errorBody(e: unknown): [Record<string, unknown>, number, string] {
  if (e instanceof OsError) {
    const i = e.info;
    if (i.kind === 'quota') return [{ error: 'quota', resetTime: i.resetTime }, 429, 'quota'];
    if (i.kind === 'busy') return [{ error: 'busy' }, 503, 'busy'];
    if (i.kind === 'notfound') return [{ error: 'notfound' }, 404, 'notfound'];
    if (i.kind === 'auth') {
      const code = i.blocked ? `login-blocked-${i.status}` : i.status ? `auth-${i.status}` : 'auth-cooldown';
      return [{ error: 'unavailable', code }, 503, code];
    }
    const code = `${i.stage ?? 'upstream'}-${i.status}${i.html === undefined ? '' : i.html ? '-firewall' : '-api'}`;
    return [{ error: 'unavailable', code }, 502, code];
  }
  const name = e instanceof Error ? e.name.replace(/[^A-Za-z]/g, '').slice(0, 40) || 'Error' : 'unknown';
  return [{ error: 'unavailable', code: `exception-${name}` }, 500, `exception-${name}`];
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    const cors: Record<string, string> = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
      : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
    // Browsers from other sites are refused. (Native apps send no Origin.)
    if (origin && !cors['Access-Control-Allow-Origin']) return json({ error: 'forbidden' }, 403, {});

    client ??= new OpenSubtitles({ apiKey: env.OS_API_KEY, username: env.OS_USERNAME, password: env.OS_PASSWORD });
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/search') {
        const lang = url.searchParams.get('lang') as Lang;
        const imdb = url.searchParams.get('imdb') ?? '';
        const season = url.searchParams.get('season');
        const episode = url.searchParams.get('episode');
        if (!LANGS.includes(lang) || !/^(tt)?\d{1,9}$/i.test(imdb)) return json({ error: 'bad-request' }, 400, cors);
        const results = await client.search({ imdbId: imdb, lang, season: season ? Number(season) : undefined, episode: episode ? Number(episode) : undefined });
        return json({ results, quota: client.quota }, 200, cors);
      }
      if (req.method === 'POST' && url.pathname === '/download') {
        const body = (await req.json().catch(() => ({}))) as { fileId?: number };
        if (!Number.isInteger(body.fileId)) return json({ error: 'bad-request' }, 400, cors);
        const r = await client.download(body.fileId!);
        return json(r, 200, cors);
      }
      if (req.method === 'GET' && url.pathname === '/quota') return json({ quota: client.quota }, 200, cors);
      return json({ error: 'not-found' }, 404, cors);
    } catch (e) {
      const [b, s, label] = errorBody(e);
      console.log(`subtitle backend: ${url.pathname} -> ${s} ${label}`); // labels only, never secrets, bodies or tokens
      return json(b, s, cors);
    }
  },
};
