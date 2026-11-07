/**
 * Check of the StreamHub subtitle backend from GitHub's servers, the way
 * the app calls it (GitHub Pages origin). Searches only: no downloads.
 * Prints status codes, result counts, the first result's release name and
 * error labels. Never any credentials or tokens.
 */
async function main() {
  const base = (process.env.SUBTITLES_API_URL ?? '').replace(/\/$/, '');
  console.log(`backend address set: ${!!base}`);
  if (!base) return;
  const origin = { Origin: 'https://lightspirit91.github.io' };
  for (const [label, path] of [
    ['film (House on Haunted Hill 1959), Spanish', '/search?imdb=tt0051744&lang=es'],
    ['film (House on Haunted Hill 1959), English', '/search?imdb=tt0051744&lang=en'],
    ['episode (Twilight Zone S1E1), English', '/search?imdb=tt0052520&lang=en&season=1&episode=1'],
  ]) {
    try {
      const r = await fetch(`${base}${path}`, { headers: origin });
      const j = (await r.json().catch(() => ({}))) as { results?: { release?: string; downloads?: number }[]; error?: string; code?: string; quota?: { remaining?: number } };
      const first = j.results?.[0];
      console.log(`${label}: HTTP ${r.status} · results ${j.results?.length ?? '-'}${first ? ` · top "${String(first.release).slice(0, 60)}" (${first.downloads} downloads)` : ''} · error ${j.error ?? '-'} · code ${j.code ?? '-'} · downloads left today ${j.quota?.remaining ?? '-'}`);
    } catch (e) {
      console.log(`${label}: request failed (${(e as Error).name})`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
main();
