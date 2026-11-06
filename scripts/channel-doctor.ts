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
import { assignSpotlight, byRank, finalizeChannel } from '../src/core/catalog/buildCatalog';
import { HUBS } from '../src/core/catalog/hubs';
import type { Catalog, Channel, Stream } from '../src/core/types';
import { channelsCsv, channelsMarkdown } from './channel-list';
import { parseCsv } from '../src/core/csv';
import { enrichChannels, type DbChannel, type DbLogo } from '../src/core/catalog/enrich';
import { updateGraveyard, type Graveyard } from '../src/core/catalog/graveyard';
import { existsSync, readFileSync } from 'node:fs';
import { isBannedStream, youtubeId } from '../src/core/catalog/normalize';

const DB = 'https://raw.githubusercontent.com/iptv-org/database/master/data';

async function enrich(channels: Channel[]) {
  try {
    const [c, l] = await Promise.all([
      fetch(`${DB}/channels.csv`).then((r) => r.text()),
      fetch(`${DB}/logos.csv`).then((r) => r.text()),
    ]);
    return enrichChannels(channels, parseCsv(c) as unknown as DbChannel[], parseCsv(l) as unknown as DbLogo[]);
  } catch (e) {
    console.warn('enrich failed', e);
    return { logos: 0, taglines: 0 };
  }
}

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const OUT = args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist';
const PREV = args.includes('--previous') ? args[args.indexOf('--previous') + 1] : 'prev';
const readJson = <T,>(path: string): T | undefined => {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;
  } catch {
    return undefined;
  }
};

type Verdict = 'ok' | 'dead' | 'locked' | 'timeout';

async function probe(s: Stream): Promise<Verdict> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    if (s.format === 'youtube') {
      // oEmbed answers 200 for embeddable videos, 401/404 when embedding is off or the video is gone.
      const id = youtubeId(s.url);
      const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`, { signal: ctrl.signal });
      return res.ok ? 'ok' : res.status === 429 ? 'timeout' : 'dead';
    }
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
  for (const s of SOURCES) if (!s.lazy && !s.deny && !catalog.sources.includes(s.id)) failed.push(s.id);

  const enriched = await enrich(catalog.channels);
  // "Just Added": channels we have never listed before get today's date;
  // known channels keep the date they first appeared.
  const prevCat = readJson<Catalog>(`${PREV}/catalog.json`);
  if (prevCat?.channels.length) {
    const firstSeen = new Map(prevCat.channels.map((c) => [c.id, c.addedAt ?? 0]));
    const grave = readJson<Graveyard>(`${PREV}/graveyard.json`)?.entries ?? {};
    for (const c of catalog.channels) {
      if (firstSeen.has(c.id)) {
        const t = firstSeen.get(c.id);
        if (t) c.addedAt = t;
      } else if (!grave[c.id]) c.addedAt = Date.now(); // revived channels are not "new"
    }
  }
  for (const c of catalog.channels) finalizeChannel(c);
  assignSpotlight(catalog.channels);
  catalog.channels.sort(byRank);

  let tally: Awaited<ReturnType<typeof checkAll>> | null = null;
  let grave = { died: [] as string[], revived: [] as string[], size: 0 };
  if (CHECK) {
    const listed = new Set(catalog.channels.map((c) => c.id));
    tally = await checkAll(catalog.channels);
    catalog.channels = catalog.channels.filter((c) => c.streams.length);
    // Remember what went offline; revive what came back.
    // Live cams are refreshed nightly by youtube-doctor; they never count as 'died'.
    // Channels removed on purpose (YouTube, Samsung TV Plus, Plex) are not 'offline'; they are not remembered.
    const before = (readJson<Catalog>(`${PREV}/catalog.json`)?.channels ?? []).filter((c) => !c.id.startsWith('ytlive:') && !c.streams.every((s) => isBannedStream(s)));
    const g = updateGraveyard(readJson<Graveyard>(`${PREV}/graveyard.json`), before, listed, catalog.channels);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'graveyard.json'), JSON.stringify(g.graveyard));
    grave = { died: g.died, revived: g.revived, size: Object.keys(g.graveyard.entries).length };
    // finalizeChannel re-classifies, which clears Spotlight: pick it again
    // from the verified streams, then restore row order.
    assignSpotlight(catalog.channels);
    catalog.channels.sort(byRank);
  }

  const counts = HUBS.map((h) => [h.title, catalog.channels.filter((c) => c.hubs.includes(h.id)).length] as const);
  const q = (min: number) => catalog.channels.filter((c) => c.bestHeight >= min).length;

  const report = [
    `# Channel Doctor report`,
    ``,
    `Built ${new Date(catalog.builtAt).toISOString()} in ${((Date.now() - started) / 1000).toFixed(0)}s`,
    ``,
    `- Channels: **${catalog.channels.length}**`,
    `- With logo: ${catalog.channels.filter((c) => c.logo).length} · with description: ${catalog.channels.filter((c) => c.tagline).length} (database matched ${enriched.logos} logos)`,
    `- Streams: ${catalog.channels.reduce((n, c) => n + c.streams.length, 0)}`,
    `- 4K: ${q(2160)} · 1080p+: ${q(1080)} · 720p+: ${q(720)}`,
    `- Sources loaded: ${catalog.sources.length}/${SOURCES.filter((s) => !s.lazy && !s.deny).length}`,
    failed.length ? `- Sources unreachable: ${failed.join(', ')}` : '',
    tally ? `- Probe: ${tally.ok} ok, ${tally.locked} geo-locked (kept), ${tally.timeout} timeout (kept), ${tally.dead} dead (removed)` : '- Probe: skipped',
    tally ? `- Graveyard: ${grave.died.length} went offline tonight, ${grave.revived.length} came back to life, ${grave.size} remembered` : '',
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
  writeFileSync(join(OUT, 'channels.md'), channelsMarkdown(catalog));
  writeFileSync(join(OUT, 'channels.csv'), channelsCsv(catalog));
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
