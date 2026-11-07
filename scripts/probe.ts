/**
 * One-off diagnostics on GitHub (reaches sites this workspace can't):
 * does each stream answer from outside Russia, and does its first video
 * segment download? Prints status codes only.
 */
const URLS = [
  'https://cdn.ntv.ru/vitrina/index.m3u8',
  'https://cdn.ntv.ru/ntv0/playlist.m3u8',
  'https://cdn.ntv.ru/ntv1/playlist.m3u8',
  'https://cdn.ntv.ru/th_serial/playlist.m3u8',
  'https://zabava-htlive.cdn.ngenix.net/hls/CH_NTV/variant.m3u8',
  'https://streaming.televizor-24-tochka.ru/live/7.m3u8',
  'https://stream8.cinerama.uz/1023/tracks-v1a1/mono.m3u8',
];
const UA = { Origin: 'https://lightspirit91.github.io', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' };

let acao: string[] = [];
async function get(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: UA, signal: ctrl.signal });
    acao.push(r.headers.get('access-control-allow-origin') ?? 'none');
    return { status: r.status, text: r.headers.get('content-type')?.includes('mpegurl') || url.endsWith('.m3u8') ? await r.text() : '', type: r.headers.get('content-type') ?? '' };
  } catch (e) {
    return { status: 0, text: '', type: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  for (const url of URLS) {
    let u = url;
    acao = [];
    const steps: string[] = [];
    for (let depth = 0; depth < 3; depth++) {
      const r = await get(u);
      steps.push(`${r.status}`);
      if (r.status !== 200 || !r.text) break;
      const line = r.text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (!line) break;
      u = new URL(line, u).toString();
      if (!/\.m3u8(\?|$)/.test(u)) {
        const seg = await get(u);
        steps.push(`segment ${seg.status} ${seg.type}`);
        break;
      }
    }
    console.log(`${url}\n   -> ${steps.join(' -> ')}\n   CORS allow-origin: ${acao.join(' / ')}`);
  }
}
main();
