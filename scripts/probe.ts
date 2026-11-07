/**
 * Same search the subtitle backend makes, from GitHub with the GitHub copy of
 * the API key. No login, no downloads. Prints status codes and a short
 * reason category from OpenSubtitles' reply; never the key or the reply.
 */
import { searchPath } from '../worker/subtitles/src/opensubtitles';

async function main() {
  const key = process.env.OPENSUBTITLES_API_KEY ?? '';
  console.log(`key present: ${!!key}`);
  if (!key) return;
  const H = { 'Api-Key': key, 'User-Agent': 'StreamHub v1.0', Accept: 'application/json' };
  const cat = (m: string) =>
    /consume|api.?key|invalid key|not allowed/i.test(m) ? 'API key refused' : /user.?agent/i.test(m) ? 'User-Agent refused' : /quota|limit/i.test(m) ? 'limit' : m ? 'other' : '-';
  const tries: [string, string][] = [
    ['backend search (film, es)', searchPath({ imdbId: 'tt0051744', lang: 'es' })],
    ['backend search (episode, en)', searchPath({ imdbId: 'tt0052520', lang: 'en', season: 1, episode: 1 })],
  ];
  for (const [label, path] of tries) {
    const r = await fetch(`https://api.opensubtitles.com/api/v1${path}`, { headers: H, redirect: 'manual' });
    const j = (await r.json().catch(() => ({}))) as { total_count?: number; message?: string; errors?: string[] };
    console.log(`${label}: HTTP ${r.status} · json ${(r.headers.get('content-type') ?? '').includes('json')} · results ${j.total_count ?? '-'} · reason ${cat(String(j.message ?? j.errors?.join(' ') ?? ''))}${r.status >= 300 && r.status < 400 ? ' · redirected' : ''}`);
  }
}
main();
