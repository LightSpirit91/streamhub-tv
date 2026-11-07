/**
 * Credential sanity check, printing yes/no flags only (never values or
 * lengths): stray spaces / line breaks, email instead of username, and
 * whether the API key is accepted (a request that needs no login). Logs in
 * once only if trimming spaces changes a value.
 */
async function main() {
  const raw = {
    key: process.env.OPENSUBTITLES_API_KEY ?? '',
    user: process.env.OPENSUBTITLES_USERNAME ?? '',
    pass: process.env.OPENSUBTITLES_PASSWORD ?? '',
  };
  const ws = (s: string) => s !== s.trim();
  console.log(`spaces/line breaks around: key ${ws(raw.key)} · username ${ws(raw.user)} · password ${ws(raw.pass)}`);
  console.log(`username looks like an email: ${raw.user.includes('@')}`);
  const key = raw.key.trim();
  const H = { 'Api-Key': key, 'User-Agent': 'StreamHub v1.0', 'Content-Type': 'application/json', Accept: 'application/json' };
  const k = await fetch('https://api.opensubtitles.com/api/v1/infos/formats', { headers: H });
  console.log(`API key accepted (no login): HTTP ${k.status}`);
  if (ws(raw.user) || ws(raw.pass) || ws(raw.key)) {
    const r = await fetch('https://api.opensubtitles.com/api/v1/login', { method: 'POST', headers: H, body: JSON.stringify({ username: raw.user.trim(), password: raw.pass.trim() }) });
    const j = (await r.json().catch(() => ({}))) as { token?: string; message?: string };
    console.log(`login with spaces trimmed: HTTP ${r.status} · token ${!!j.token}`);
    if (j.token) await fetch('https://api.opensubtitles.com/api/v1/logout', { method: 'DELETE', headers: { ...H, Authorization: `Bearer ${j.token}` } });
  } else {
    console.log('no stray spaces: login not retried');
  }
}
main();
