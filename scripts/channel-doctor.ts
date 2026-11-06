/**
 * Channel Doctor: the self-healing link pipeline.
 *
 * Runs nightly on GitHub Actions (.github/workflows/channel-doctor.yml):
 * 1. Pulls every source in src/core/catalog/sources.ts (with mirrors).
 * 2. Merges + dedupes + ranks into one catalog.
 * 3. --check: probes every stream. Dead links (404/410, DNS failure, not a
 *    playlist) are removed. 403/451 is kept, because that is usually a geo
 *    lock that works from Canada even if it fails from a US runner.
 * 4. Writes dist/catalog.json (what the app downloads) + dist/report.md.
 *
 * Usage: npx tsx scripts/channel-doctor.ts [--check] [--out dist]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog } from '../src/core/catalog/loader';
import { SOURCES } from '../src/core/catalog/sources';
import { finalizeChannel } from '../src/core/catalog/buildCatalog';
import { HUBS } from '../src/core/catalog/hubs';
import type { Channel, Stream } from '../src/core/types';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const OUT = args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist';

type Verdict = 'ok' | 'dead' | 'locked' | 'timeout';

async function probe(s: Stream): Promise<Verdict> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(s.url, { signal: ctrl.signal, headers: s.headers, redirect: 'follow' });
    if (res.status === 403 || res.status === 451) return 'locked';
    if (!res.ok) return 'dead';
    if (s.format !== 'hls') return 'ok';
    const head = (await res.text()).slice(0, 2048);
    return head.includes('#EXTM3U') ? 'ok' : 'dead';
  } catch (e) {
    return (e as Error).name === 'AbortError' ? 'timeout' : 'dead';
  } finally {
    clearTimeout(t);
  }
}

async function checkAll(channels: Channel[]) {
  const streams = channels.flatMap((c) => c.streams);
  const verdicts = new Map<string, Verdict>();
  let i = 0;
  const workers = Array.from({ length: 48 }, async () => {
    while (i < streams.length) {
      const s = streams[i++];
      verdicts.set(s.url, await probe(s));
    }
  });
  await Promise.all(workers);
  for (const c of channels) {
    c.streams = c.streams.filter((s) => verdicts.get(s.url) !== 'dead');
    for (const s of c.streams) if (verdicts.get(s.url) === 'ok') s.score += 20;
    finalizeChannel(c);
  }
  const tally = { ok: 0, dead: 0, locked: 0, timeout: 0 };
  for (const v of verdicts.values()) tally[v]++;
  return tally;
}

async function main() {
  const started = Date.now();
  const failed: string[] = [];
  const catalog = await loadCatalog({
    sources: SOURCES.filter((s) => !s.lazy),
    onProgress: (d, t, id) => process.stdout.write(`\r  sources ${d}/${t} ${id.padEnd(40)}`),
  });
  process.stdout.write('\n');
  for (const s of SOURCES) if (!s.lazy && !catalog.sources.includes(s.id)) failed.push(s.id);

  let tally: Awaited<ReturnType<typeof checkAll>> | null = null;
  if (CHECK) {
    tally = await checkAll(catalog.channels);
    catalog.channels = catalog.channels.filter((c) => c.streams.length);
  }

  const counts = HUBS.map((h) => [h.title, catalog.channels.filter((c) => c.hubs.includes(h.id)).length] as const);
  const q = (min: number) => catalog.channels.filter((c) => c.bestHeight >= min).length;

  const report = [
    `# Channel Doctor report`,
    ``,
    `Built ${new Date(catalog.builtAt).toISOString()} in ${((Date.now() - started) / 1000).toFixed(0)}s`,
    ``,
    `- Channels: **${catalog.channels.length}**`,
    `- Streams: ${catalog.channels.reduce((n, c) => n + c.streams.length, 0)}`,
    `- 4K: ${q(2160)} · 1080p+: ${q(1080)} · 720p+: ${q(720)}`,
    `- Sources loaded: ${catalog.sources.length}/${SOURCES.filter((s) => !s.lazy).length}`,
    failed.length ? `- Sources unreachable: ${failed.join(', ')}` : '',
    tally ? `- Probe: ${tally.ok} ok, ${tally.locked} geo-locked (kept), ${tally.timeout} timeout (kept), ${tally.dead} dead (removed)` : '- Probe: skipped',
    ``,
    `| Hub | Channels |`,
    `|---|---|`,
    ...counts.map(([t, n]) => `| ${t} | ${n} |`),
    ``,
    `## Spotlight`,
    ...catalog.channels.filter((c) => c.hubs.includes('spotlight')).map((c) => `- ${c.name} (${c.country ?? 'INT'}, ${c.bestHeight || '?'}p)`),
  ].join('\n');

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'catalog.json'), JSON.stringify(catalog));
  writeFileSync(join(OUT, 'report.md'), report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
