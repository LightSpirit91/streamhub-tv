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
import { baseId, blockedIds } from '../src/core/catalog/blocklist';
import { existsSync, readFileSync } from 'node:fs';
import { isBannedStream } from '../src/core/catalog/normalize';
import { validateStream, type Verdict as Check } from '../src/core/playback/validate';
import { emptyHealth, pruneHealth, recordLink, recordSource, restingLink, restingSources, type HealthState } from '../src/core/playback/health';
import { parseSettings } from '../src/core/refresh/settings';
import { Budget, makeGetBytes } from './lib/net';

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
    return { logos: 0, taglines: 0, closed: new Set<string>() };
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

const SETTINGS = parseSettings(readJson('config/refresh.json'));
const RULES = SETTINGS.playbackCheck;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Real playback check (settings: playbackCheck). Deep: playlist -> variant ->
 * first segment must be actual video bytes. Shallow (deep: false): the
 * playlist must answer and be a playlist. Failures are retried with backoff
 * (2 s, then 6 s) inside the run before they count as a strike.
 */
async function probe(s: Stream, get: ReturnType<typeof makeGetBytes>): Promise<Check> {
  const headers = { Origin: 'https://lightspirit91.github.io', ...(s.headers ?? {}) };
  const once = async (): Promise<Check> => {
    if (RULES.deep) return validateStream(s.url, get, { format: s.format === 'youtube' ? undefined : s.format, headers, live: true });
    try {
      const r = await get(s.url, headers);
      if ([401, 403, 451].includes(r.status)) return { ok: false, reason: 'locked', detail: `HTTP ${r.status}`, cors: r.cors };
      if (r.status >= 400 || !r.status) return { ok: false, reason: r.type === 'unsafe' ? 'unsafe' : 'http', detail: `HTTP ${r.status}` };
      const head = new TextDecoder().decode(r.bytes.subarray(0, 2048));
      return s.format !== 'hls' || head.includes('#EXTM3U') ? { ok: true, kind: 'hls', detail: 'playlist', cors: r.cors } : { ok: false, reason: 'not-media', detail: 'not a playlist' };
    } catch (e) {
      const name = (e as Error).name;
      return { ok: false, reason: name === 'AbortError' ? 'timeout' : name === 'BudgetError' ? 'skipped' : 'network', detail: name };
    }
  };
  let v = await once();
  for (const wait of [2000, 6000]) {
    if (v.ok || ['locked', 'skipped', 'unsafe', 'http'].includes(v.reason)) break;
    await sleep(wait);
    v = await once();
  }
  return v;
}

async function checkAll(channels: Channel[], health: HealthState, deadline: number) {
  const now = Date.now();
  const budget = new Budget(SETTINGS.limits.maxRequestsPerRun, deadline);
  const get = makeGetBytes({ budget, timeoutMs: RULES.timeoutSeconds * 1000 });
  const streams = channels.flatMap((c) => c.streams);
  const keep = new Map<string, boolean>();
  const tally = { ok: 0, strike: 0, removed: 0, resting: 0, locked: 0, unknown: 0 };
  const bySource = new Map<string, { links: number; working: number }>();
  let i = 0;
  await Promise.all(
    Array.from({ length: RULES.concurrency }, async () => {
      while (i < streams.length) {
        const s = streams[i++];
        if (keep.has(s.url)) continue;
        const src = bySource.get(s.source) ?? { links: 0, working: 0 };
        bySource.set(s.source, src);
        src.links++;
        if (restingLink(health, s.url, RULES, now)) {
          keep.set(s.url, false);
          tally.resting++;
          continue;
        }
        const v = await probe(s, get);
        if (v.cors !== undefined) s.cors = v.cors;
        const r = recordLink(health, s.url, v, RULES, now);
        keep.set(s.url, r.keep);
        if (r.outcome === 'pass') {
          tally.ok++;
          src.working++;
          s.score += 20;
        } else if (!r.keep) tally.removed++;
        else if (r.outcome === 'fail') tally.strike++;
        else if (!v.ok && v.reason === 'locked') tally.locked++;
        else tally.unknown++;
      }
    }),
  );
  for (const c of channels) {
    c.streams = c.streams.filter((s) => keep.get(s.url) !== false);
    finalizeChannel(c);
  }
  pruneHealth(health, new Set(streams.map((s) => s.url)), now);
  return { ...tally, requests: budget.used, bySource, outOfBudget: budget.exhausted };
}

async function main() {
  const started = Date.now();
  const failed: string[] = [];
  const health = readJson<HealthState>(`${PREV}/health.json`) ?? emptyHealth();
  const resting = restingSources(health, RULES, started);
  const skipped = SOURCES.filter((s) => SETTINGS.excludedSources.includes(s.id) || resting.has(s.id)).map((s) => s.id);
  const catalog = await loadCatalog({
    sources: SOURCES.filter((s) => !s.lazy && !skipped.includes(s.id)),
    onProgress: (d, t, id) => process.stdout.write(`\r  sources ${d}/${t} ${id.padEnd(40)}`),
  });
  process.stdout.write('\n');
  for (const s of SOURCES) if (!s.lazy && !s.deny && !skipped.includes(s.id) && !catalog.sources.includes(s.id)) failed.push(s.id);

  const enriched = await enrich(catalog.channels);
  // iptv-org blocklist (copyright claims, adult) and channels the database marks as closed.
  let blocked = new Set<string>();
  for (const url of ['https://iptv-org.github.io/api/blocklist.json', 'https://raw.githubusercontent.com/iptv-org/api/gh-pages/blocklist.json']) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        blocked = blockedIds(await r.json());
        if (blocked.size) break;
      }
    } catch {
      // next mirror; if none answers, nothing is removed tonight
    }
  }
  const beforeCount = catalog.channels.length;
  catalog.channels = catalog.channels.filter((c) => !blocked.has(baseId(c.id)) && !enriched.closed.has(c.id));
  const removedBlock = beforeCount - catalog.channels.length;
  console.log(`blocklist ${blocked.size} entries, closed ${enriched.closed.size}: removed ${removedBlock} channels`);
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
    // About half the run's time limit goes to link checks; the rest to movies, shows and the guide.
    tally = await checkAll(catalog.channels, health, started + SETTINGS.limits.maxRunMinutes * 30_000);
    for (const s of SOURCES) {
      if (s.lazy || s.deny || skipped.includes(s.id)) continue;
      const n = tally.bySource.get(s.id) ?? { links: 0, working: 0 };
      recordSource(health, s.id, n.links, n.working, catalog.sources.includes(s.id), RULES, started);
    }
    health.updatedAt = Date.now();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'health.json'), JSON.stringify(health));
    catalog.channels = catalog.channels.filter((c) => c.streams.length);
    // Remember what went offline; revive what came back.
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
    `- Removed: ${removedBlock} (iptv-org blocklist ${blocked.size} entries, closed channels ${enriched.closed.size})`,
    `- Sources loaded: ${catalog.sources.length}/${SOURCES.filter((s) => !s.lazy && !s.deny).length}`,
    failed.length ? `- Sources unreachable: ${failed.join(', ')}` : '',
    tally
      ? `- Playback check (${RULES.deep ? 'real video bytes' : 'playlist only'}): ${tally.ok} play, ${tally.strike} failed tonight (kept, strike), ${tally.removed} removed, ${tally.resting} resting (removed, re-test in ${RULES.recheckRemovedEveryDays} days), ${tally.locked} geo-locked (kept), ${tally.unknown} no answer (kept) · ${tally.requests} requests${tally.outOfBudget ? ' · request/time limit reached' : ''}`
      : '- Playback check: skipped',
    skipped.length ? `- Sources switched off: ${skipped.join(', ')}` : '',
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
  // Publish guard: a sudden big drop means something broke upstream, not that
  // the channels died. Keep yesterday's list and say so.
  const prevCount = readJson<Catalog>(`${PREV}/catalog.json`)?.channels.length ?? 0;
  const floor = prevCount * (1 - SETTINGS.publishGuard.maxChannelDropPercent / 100);
  if (prevCount && catalog.channels.length < floor) {
    const warn = `\n\n**Publish guard: kept yesterday's ${prevCount} channels.** Tonight found ${catalog.channels.length} (more than ${SETTINGS.publishGuard.maxChannelDropPercent}% fewer).`;
    writeFileSync(join(OUT, 'report.md'), report.replace(/Built [^\n]*/, (m) => m) + warn);
    console.log(report + warn);
    return;
  }
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
