/**
 * One login check against OpenSubtitles from GitHub with the corrected
 * GitHub secrets. Prints only the HTTP status, whether a token came back,
 * the allowance numbers, and OpenSubtitles' failed/remaining login counters.
 * Never prints the key, username, password, token or the full reply.
 */
async function main() {
  const KEY = process.env.OPENSUBTITLES_API_KEY;
  const USER = process.env.OPENSUBTITLES_USERNAME;
  const PASS = process.env.OPENSUBTITLES_PASSWORD;
  console.log(`secrets present: key ${!!KEY}, username ${!!USER}, password ${!!PASS}`);
  if (!KEY || !USER || !PASS) return;
  const H = { 'Api-Key': KEY, 'User-Agent': 'StreamHub v1.0', 'Content-Type': 'application/json', Accept: 'application/json' };
  const r = await fetch('https://api.opensubtitles.com/api/v1/login', { method: 'POST', headers: H, body: JSON.stringify({ username: USER, password: PASS }) });
  const type = r.headers.get('content-type') ?? '';
  const j = (await r.json().catch(() => ({}))) as { token?: string; message?: string; user?: { allowed_downloads?: number; remaining_downloads?: number } };
  const counters = /failed:\s*\d+\s*remaining:\s*\d+/i.exec(j.message ?? '')?.[0] ?? '-';
  const kind = /invalid username\/password/i.test(j.message ?? '') ? 'wrong username or password' : /api.?key/i.test(j.message ?? '') ? 'API key problem' : /lock|block/i.test(j.message ?? '') ? 'account locked' : '-';
  console.log(`login: HTTP ${r.status} · json ${type.includes('json')} · token ${!!j.token} · reason ${kind} · counters ${counters} · downloads ${j.user?.remaining_downloads ?? '-'}/${j.user?.allowed_downloads ?? '-'}`);
  if (j.token) {
    const out = await fetch('https://api.opensubtitles.com/api/v1/logout', { method: 'DELETE', headers: { ...H, Authorization: `Bearer ${j.token}` } });
    console.log(`logout: HTTP ${out.status}`);
  }
}
main();
