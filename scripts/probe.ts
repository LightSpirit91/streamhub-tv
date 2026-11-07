/**
 * One-off diagnostics on GitHub (reaches sites this workspace can't).
 * OpenSubtitles check: reads the official docs/terms pages for the rules we
 * must follow, then logs in once and runs one search. Prints only status
 * codes, counts and field names: never the API key, username, password or
 * token. Uses no download allowance.
 */
const DOCS = [
  'https://opensubtitles.stoplight.io/docs/opensubtitles-api/e3750fd63a100-getting-started',
  'https://opensubtitles.stoplight.io/docs/opensubtitles-api/a172317bd5ccc-search-for-subtitles',
  'https://opensubtitles.stoplight.io/docs/opensubtitles-api/6be7ecf8c8d9b-download',
  'https://opensubtitles.stoplight.io/docs/opensubtitles-api/73acf79accc0a-login',
  'https://www.opensubtitles.com/en/consumers',
  'https://www.opensubtitles.com/en/support/api-terms',
  'https://www.opensubtitles.com/en/tos',
];
const WORDS = /user-agent|attribut|logo|link back|credit|alphabetic|lowercase|redirect|remaining|reset_time|406|429|per second|cache|caching|store|redistribut|commercial|token|24 hours|expire|base_url|ai_translated|machine_translated|parent_imdb_id|episode_number|season_number/i;

async function docs() {
  for (const url of DOCS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 StreamHub-Probe/1.0' } });
      const html = await res.text();
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
      const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => WORDS.test(x) && x.length < 400);
      console.log(`\n===== ${url}\nstatus ${res.status} · ${html.length} bytes · ${sentences.length} matching sentences`);
      for (const x of [...new Set(sentences)].slice(0, 40)) console.log(`  - ${x.trim()}`);
      // Stoplight pages embed their markdown/OpenAPI as JSON; print matching lines from it too.
      const json = [...html.matchAll(/"(?:md|description|content)":"((?:[^"\\]|\\.){40,4000})"/g)].map((m) => m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"'));
      for (const j of json.filter((x) => WORDS.test(x)).slice(0, 15)) console.log(`  * ${j.slice(0, 600)}`);
    } catch (e) {
      console.log(`\n===== ${url}\nFAILED ${(e as Error).message}`);
    }
  }
}

async function live() {
  const KEY = process.env.OPENSUBTITLES_API_KEY;
  const USER = process.env.OPENSUBTITLES_USERNAME;
  const PASS = process.env.OPENSUBTITLES_PASSWORD;
  console.log(`\n===== live API check\nsecrets present: key ${!!KEY}, username ${!!USER}, password ${!!PASS}`);
  if (!KEY || !USER || !PASS) return;
  const H = { 'Api-Key': KEY, 'User-Agent': 'StreamHub v1.0', 'Content-Type': 'application/json', Accept: 'application/json' };
  const login = await fetch('https://api.opensubtitles.com/api/v1/login', { method: 'POST', headers: H, body: JSON.stringify({ username: USER, password: PASS }) });
  const lj = (await login.json().catch(() => ({}))) as { token?: string; base_url?: string; user?: Record<string, unknown>; status?: number; message?: string };
  console.log(`login: HTTP ${login.status} · token received ${!!lj.token} · base_url ${lj.base_url ?? '-'} · message ${lj.message ?? '-'}`);
  if (lj.user) {
    const u = lj.user;
    console.log(`user fields: ${Object.keys(u).join(', ')}`);
    console.log(`allowed_downloads ${u.allowed_downloads} · remaining_downloads ${u.remaining_downloads} · level ${u.level} · vip ${u.vip}`);
  }
  if (!lj.token) return;
  const base = `https://${(lj.base_url ?? 'api.opensubtitles.com').replace(/^https?:\/\//, '')}/api/v1`;
  const A = { ...H, Authorization: `Bearer ${lj.token}` };
  // House on Haunted Hill (1959), IMDb tt0051744. Parameters lowercase and in alphabetical order.
  const q = 'imdb_id=51744&languages=en,es,he,ru&order_by=download_count';
  const s = await fetch(`${base}/subtitles?${q}`, { headers: A, redirect: 'manual' });
  console.log(`search: HTTP ${s.status} · redirect ${s.headers.get('location') ? 'yes' : 'no'} · ratelimit-remaining ${s.headers.get('ratelimit-remaining') ?? s.headers.get('x-ratelimit-remaining-second') ?? '-'}`);
  if (s.ok) {
    const sj = (await s.json()) as { total_count?: number; data?: { attributes: Record<string, unknown> }[] };
    const by: Record<string, number> = {};
    for (const d of sj.data ?? []) by[String(d.attributes.language)] = (by[String(d.attributes.language)] ?? 0) + 1;
    console.log(`results ${sj.total_count} · by language ${JSON.stringify(by)}`);
    if (sj.data?.[0]) console.log(`attribute fields: ${Object.keys(sj.data[0].attributes).join(', ')}`);
  }
  // Episode search shape (The Twilight Zone 1959, tt0052520, S1E1).
  const e = await fetch(`${base}/subtitles?episode_number=1&languages=en,es&parent_imdb_id=52520&season_number=1`, { headers: A, redirect: 'manual' });
  console.log(`episode search: HTTP ${e.status}${e.ok ? ` · results ${((await e.json()) as { total_count?: number }).total_count}` : ''}`);
  const out = await fetch(`${base}/logout`, { method: 'DELETE', headers: A });
  console.log(`logout: HTTP ${out.status}`);
}

docs().catch((e) => console.log(`probe error ${(e as Error).message}`));
