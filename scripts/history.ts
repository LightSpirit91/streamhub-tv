/**
 * After a publishing job: append to the audit log, take tonight's snapshot,
 * prune old snapshots, and write status.json for the app.
 *
 * Usage: npx tsx scripts/history.ts --dist dist --job "Channel Doctor"
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Catalog } from '../src/core/types';
import { dayKey, diffIds, parseAudit, SNAPSHOT_FILES, snapshotsToDrop, type AuditEntry, type RefreshStatus } from '../src/core/refresh/history';
import { parseSettings } from '../src/core/refresh/settings';
import { SOURCES } from '../src/core/catalog/sources';
import type { HealthState } from '../src/core/playback/health';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DIST = arg('--dist', 'dist');
const JOB = arg('--job', 'update');
const PREV = arg('--previous', 'prev');
const readJson = <T,>(p: string): T | undefined => {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined;
  } catch {
    return undefined;
  }
};

const settings = parseSettings(readJson('config/refresh.json'));
const now = Date.now();
const hist = join(DIST, 'history');
mkdirSync(hist, { recursive: true });

// Audit entry.
const cat = readJson<Catalog>(join(DIST, 'catalog.json'));
const prevCat = readJson<Catalog>(join(PREV, 'catalog.json'));
const diff = cat && prevCat && cat.builtAt !== prevCat.builtAt ? diffIds(prevCat.channels.map((c) => c.id), cat.channels.map((c) => c.id)) : undefined;
const movies = readJson<{ movies: unknown[] }>(join(DIST, 'movies.json'));
const shows = readJson<{ shows: unknown[] }>(join(DIST, 'shows.json'));
const epg = readJson<{ programs: Record<string, unknown> }>(join(DIST, 'epg.json'));
const disc = readJson<RefreshStatus['discovery']>(join(DIST, 'discovery', 'summary.json'));
const report = existsSync(join(DIST, 'report.md')) ? readFileSync(join(DIST, 'report.md'), 'utf8') : '';
const entry: AuditEntry = {
  at: now,
  job: JOB,
  channels: cat?.channels.length,
  streams: cat?.channels.reduce((n, c) => n + c.streams.length, 0),
  movies: movies?.movies.length,
  shows: shows?.shows.length,
  guideChannels: epg ? Object.keys(epg.programs).length : undefined,
  added: diff?.added.length,
  removed: diff?.removed.length,
  discovered: JOB === 'Discovery' ? disc?.accepted : undefined,
  note: /Publish guard/.test(report) ? 'publish guard kept the previous channel list' : undefined,
};
const auditPath = join(hist, 'audit.jsonl');
const audit = [...parseAudit(existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : ''), entry].slice(-1000);
writeFileSync(auditPath, audit.map((e) => JSON.stringify(e)).join('\n') + '\n');

// Snapshot (one per day; a later run the same day replaces it).
const day = join(hist, dayKey(now));
mkdirSync(day, { recursive: true });
for (const f of SNAPSHOT_FILES) {
  const p = join(DIST, f);
  if (existsSync(p)) writeFileSync(join(day, `${f}.gz`), gzipSync(readFileSync(p)));
}
for (const old of snapshotsToDrop(readdirSync(hist), settings.snapshotsToKeep)) rmSync(join(hist, old), { recursive: true, force: true });
const snapshots = readdirSync(hist).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();

// status.json for the app.
const health = readJson<HealthState>(join(DIST, 'health.json'));
const status: RefreshStatus = {
  builtAt: now,
  settings: {
    channelsEveryHours: settings.refresh.channelsEveryHours,
    guideEveryHours: settings.refresh.guideEveryHours,
    deepCheck: settings.playbackCheck.deep,
    failuresBeforeRemoval: settings.playbackCheck.failuresBeforeRemoval,
    recheckRemovedEveryDays: settings.playbackCheck.recheckRemovedEveryDays,
    maxRequestsPerRun: settings.limits.maxRequestsPerRun,
    maxRunMinutes: settings.limits.maxRunMinutes,
    discovery: settings.discovery.enabled,
    discoverySchedule: existsSync('.github/workflows/discovery.yml') && /^\s+schedule:/m.test(readFileSync('.github/workflows/discovery.yml', 'utf8')) ? 'daily' : 'manual',
  },
  sources: SOURCES.filter((s) => !s.lazy && !s.deny).map((s) => {
    const h = health?.sources[s.id];
    return { id: s.id, links: h?.links ?? 0, working: h?.working ?? 0, badNights: h?.badNights ?? 0, off: !!h?.disabledAt || settings.excludedSources.includes(s.id) };
  }),
  discovery: disc,
  audit: audit.slice(-30).reverse(),
  snapshots,
};
writeFileSync(join(DIST, 'status.json'), JSON.stringify(status));
console.log(`history: ${JOB} logged; snapshots ${snapshots.join(', ')}`);
