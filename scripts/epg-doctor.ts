/**
 * Builds the TV guide for every channel we can match:
 * - dist/epg.json: now and the next hours (small, loaded when the app opens)
 * - dist/epg-week/<n>.json: everything published for the coming days, up to
 *   a week, split in small files (the app loads one when you open a channel's schedule)
 * Usage: npx tsx scripts/epg-doctor.ts [--catalog dist/catalog.json] [--out dist] [--hours 18] [--days 8]
 *
 * Guide sources (public XMLTV):
 * - epgshare01.online: per-country guides (US, Canada, Israel, Mexico, Latin America, sports...)
 * - i.mjh.nz: Pluto TV and Roku free-channel guides
 * - epg.pw: large per-country guides (US, Canada, Russia, UK) and a week-long guide for major channels
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import type { Catalog } from '../src/core/types';
import { collectProgrammes, matchChannels, parseChannels, weekBucket, WEEK_BUCKETS, type Guide, type MatchTarget, type Programme } from '../src/core/epg/xmltv';
// Guide files named per country by epgshare01. Unknown names simply report "unavailable".

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const CATALOG = arg('--catalog', 'dist/catalog.json');
const OUT = arg('--out', 'dist');
const HOURS = Number(arg('--hours', '18'));
const DAYS = Number(arg('--days', '8'));

const EPGSHARE = 'https://epgshare01.online/epgshare01';
/** Guide files we want, by prefix. Read from the folder listing each night, so renames (US1 -> US2) never break the guide. */
const WANT = /^epg_ripper_(US\d|US_LOCALS\d|US_SPORTS\d|CA\d|IL\d|RU\d|KZ\d|UA\d|viva-russia\.ru|MX\d|AR\d|CO\d|CL\d|PE\d|CR\d|DO\d|EC\d|PA\d|UY\d|SV\d|UK\d|DISTROTV\d|RAKUTEN\d|PEACOCK\d|AMCCHANNELS\d|WHALETVPLUS\d|TBNPLUS\d|DIRECTVSPORTS\d|BEIN\d|RALLY_TV\d)\.xml\.gz$/;
const FALLBACK = ['US2', 'US_LOCALS1', 'US_SPORTS1', 'CA2', 'IL1', 'viva-russia.ru', 'MX1', 'CO1', 'UK1'].map((f) => `epg_ripper_${f}.xml.gz`);
const MJH = [
  'https://i.mjh.nz/PlutoTV/us.xml.gz',
  'https://i.mjh.nz/PlutoTV/ca.xml.gz',
  'https://i.mjh.nz/PlutoTV/mx.xml.gz',
  'https://i.mjh.nz/Roku/all.xml.gz',
];
/** epg.pw: large per-country guides (US 5,500 channels, Russia 4,100), 2-7 days ahead; 'lite' = major channels, up to a week. */
const EPGPW = [...['US', 'CA', 'RU', 'GB'].map((c) => `https://epg.pw/xmltv/epg_${c}.xml.gz`), 'https://epg.pw/xmltv/epg_lite.xml.gz'];

async function guideSources(): Promise<string[]> {
  let files = FALLBACK;
  try {
    const html = await (await fetch(`${EPGSHARE}/`, { headers: { 'User-Agent': 'StreamHub-EPG/1.2' } })).text();
    const listed = [...html.matchAll(/href="(epg_ripper_[^"]+\.xml\.gz)"/g)].map((m) => m[1]).filter((f) => WANT.test(f));
    if (listed.length) files = [...new Set(listed)];
  } catch {
    // keep the fallback list
  }
  // Israel and the big US/Canada guides first; the free-channel guides last.
  const rank = (f: string) => (/_(IL|US|CA)/.test(f) ? 0 : /_(RU|KZ|UA|viva)/.test(f) ? 1 : 2);
  return [...files.sort((a, b) => rank(a) - rank(b)).map((f) => `${EPGSHARE}/${f}`), ...MJH, ...EPGPW];
}

/**
 * Streams a (gzipped) XMLTV file and keeps only what we need, so guides of
 * any size (the US file is several hundred MB unpacked) never sit in memory.
 * Channels come first in XMLTV; we match them, then filter programmes as
 * they stream past.
 */
export async function processSource(
  url: string,
  targets: MatchTarget[],
  from: number,
  to: number,
): Promise<{ map: Map<string, string>; byXml: Map<string, Programme[]>; xmlChannels?: number } | { error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 900_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'StreamHub-EPG/1.1' } });
    if (!res.ok || !res.body) return { error: `HTTP ${res.status}` };
    let stream: NodeJS.ReadableStream = Readable.fromWeb(res.body as never);
    if (url.endsWith('.gz')) stream = stream.pipe(createGunzip());
    stream.setEncoding?.('utf8');

    // i.mjh.nz guides interleave channels and programmes; they are small, so read them whole.
    if (url.includes('i.mjh.nz')) {
      let all = '';
      for await (const chunk of stream as AsyncIterable<string | Buffer>) all += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const xmlCh = parseChannels(all);
      const map = matchChannels(targets, xmlCh);
      const byXml = new Map<string, Programme[]>();
      if (map.size) collectProgrammes(all, new Set(map.values()), from, to, byXml);
      return { map, byXml, xmlChannels: xmlCh.length };
    }
    let buf = '';
    let channelsXml = '';
    let map: Map<string, string> | null = null;
    let wanted = new Set<string>();
    let xmlChannels = 0;
    const byXml = new Map<string, Programme[]>();

    for await (const chunk of stream as AsyncIterable<string | Buffer>) {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!map) {
        const p = buf.indexOf('<programme');
        if (p === -1) {
          const cut = buf.lastIndexOf('</channel>');
          if (cut !== -1) {
            channelsXml += buf.slice(0, cut + 10);
            buf = buf.slice(cut + 10);
          }
          continue;
        }
        channelsXml += buf.slice(0, p);
        buf = buf.slice(p);
        const xmlCh = parseChannels(channelsXml);
        xmlChannels = xmlCh.length;
        map = matchChannels(targets, xmlCh);
        channelsXml = '';
        if (!map.size) return { map, byXml, xmlChannels };
        wanted = new Set(map.values());
      }
      const cut = buf.lastIndexOf('</programme>');
      if (cut === -1) continue;
      collectProgrammes(buf.slice(0, cut + 12), wanted, from, to, byXml);
      buf = buf.slice(cut + 12);
    }
    if (!map) {
      const xmlCh = parseChannels(channelsXml + buf);
      xmlChannels = xmlCh.length;
      map = matchChannels(targets, xmlCh);
    }
    return { map, byXml, xmlChannels };
  } catch (e) {
    return { error: (e as Error).name === 'AbortError' ? 'timeout' : 'download failed' };
  } finally {
    clearTimeout(t);
  }
}

/** Some guides list the same slot twice; keep the first. */
function dedupe(list: Programme[]): Programme[] {
  const out: Programme[] = [];
  for (const p of list) if (!out.length || p[0] >= out[out.length - 1][1] || p[0] !== out[out.length - 1][0]) out.push(p);
  return out;
}

async function main() {
  const catalog: Catalog = existsSync(CATALOG)
    ? JSON.parse(readFileSync(CATALOG, 'utf8'))
    : await (await fetch('https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/catalog.json')).json();

  const targets: MatchTarget[] = catalog.channels.map((c) => ({
    id: c.id,
    name: c.name,
    country: c.country,
    plutoId: c.streams.map((s) => /plu-([0-9a-f]{24})/.exec(s.url)?.[1]).find(Boolean),
  }));
  const unmatched = new Map(targets.map((t) => [t.id, t]));
  const programs: Record<string, Programme[]> = {};
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3 * 3600;
  const to = now + DAYS * 86400;
  const soon = now + HOURS * 3600;
  const week: Record<string, Programme[]> = {};
  const log: string[] = [];

  // Every guide is read for every channel. A channel listed by several guides
  // keeps the one that reaches furthest ahead (only if it adds a day or more,
  // so the better-matched first guide wins ties).
  const reachOf = (l: Programme[]) => l[l.length - 1][1];
  for (const url of await guideSources()) {
    const name = url.split('/').slice(-2).join('/');
    const got0 = await processSource(url, targets, from, to);
    if ('error' in got0) {
      log.push(`- ${name}: unavailable (${got0.error})`);
      console.log(log[log.length - 1]);
      continue;
    }
    let added = 0;
    let longer = 0;
    let furthest = 0;
    for (const [appId, xmlId] of got0.map) {
      const all = dedupe((got0.byXml.get(xmlId) ?? []).sort((a, b) => a[0] - b[0]));
      if (!all.length) continue;
      furthest = Math.max(furthest, reachOf(all));
      const cur = week[appId];
      if (cur && reachOf(all) < reachOf(cur) + 86400) continue;
      if (cur) longer++;
      else added++;
      week[appId] = all;
      unmatched.delete(appId);
    }
    const ahead = furthest ? ` (reaches ${((furthest - now) / 86400).toFixed(1)} days ahead)` : '';
    log.push(`- ${name}: ${got0.xmlChannels ?? '?'} in guide, ${got0.map.size} matched, ${added} new + ${longer} longer schedules${ahead}`);
    console.log(log[log.length - 1]);
  }
  for (const [appId, all] of Object.entries(week)) {
    const list = all.filter((p) => p[0] < soon && p[1] > from).slice(0, 14);
    if (list.length) programs[appId] = list;
  }

  const builtAt = Date.now();
  const guide: Guide = { version: 1, builtAt, programs };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'epg.json'), JSON.stringify(guide));
  // Week-long schedule in WEEK_BUCKETS files.
  const weekDir = join(OUT, 'epg-week');
  rmSync(weekDir, { recursive: true, force: true });
  mkdirSync(weekDir, { recursive: true });
  const buckets: Record<string, Programme[]>[] = Array.from({ length: WEEK_BUCKETS }, () => ({}));
  for (const [id, list] of Object.entries(week)) buckets[weekBucket(id)][id] = list;
  buckets.forEach((b, i) => writeFileSync(join(weekDir, `${i}.json`), JSON.stringify({ version: 1, builtAt, programs: b } satisfies Guide)));
  const covered = Object.keys(week).length;
  const reach = Object.values(week).map((l) => (l[l.length - 1][1] - now) / 86400);
  const days = (min: number) => reach.filter((d) => d >= min).length;
  const report = [
    `# TV guide`, ``,
    `${covered} of ${catalog.channels.length} channels have a schedule.`,
    `Schedule reaches: 1+ day ahead ${days(1)} · 3+ days ${days(3)} · 6+ days ${days(6)} channels.`,
    ``, ...log,
  ].join('\n');
  writeFileSync(join(OUT, 'epg-report.md'), report);
  console.log(report);
}

if (process.argv[1]?.endsWith('epg-doctor.ts')) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
