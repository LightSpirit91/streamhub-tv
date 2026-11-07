/**
 * One-off check of the StreamHub subtitle backend from GitHub's servers.
 * Calls /search like the app does (GitHub Pages origin). Uses no download
 * allowance. Prints only status codes, result counts and error labels.
 */
async function main() {
  const base = (process.env.SUBTITLES_API_URL ?? '').replace(/\/$/, '');
  console.log(`backend address set: ${!!base}`);
  if (!base) return;
  const origin = { Origin: 'https://lightspirit91.github.io' };
  for (const [label, path] of [
    ['film, Spanish', '/search?imdb=tt0051744&lang=es'],
    ['film, English', '/search?imdb=tt0051744&lang=en'],
    ['episode, English', '/search?imdb=tt0052520&lang=en&season=1&episode=1'],
    ['bad input', '/search?imdb=abc&lang=fr'],
  ]) {
    try {
      const r = await fetch(`${base}${path}`, { headers: origin });
      const j = (await r.json().catch(() => ({}))) as { results?: unknown[]; error?: string; code?: string; quota?: { remaining?: number } };
      console.log(`${label}: HTTP ${r.status} · cors ${r.headers.get('access-control-allow-origin') === origin.Origin} · results ${j.results?.length ?? '-'} · error ${j.error ?? '-'} · code ${j.code ?? '-'} · downloads left ${j.quota?.remaining ?? '-'}`);
    } catch (e) {
      console.log(`${label}: request failed (${(e as Error).name})`);
    }
  }
  const other = await fetch(`${base}/search?imdb=tt0051744&lang=es`, { headers: { Origin: 'https://example.com' } });
  console.log(`other website: HTTP ${other.status} (403 expected)`);
}
main();
