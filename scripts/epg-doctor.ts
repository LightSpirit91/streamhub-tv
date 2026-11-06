/**
 * Builds dist/epg.json: what's on now and next for every channel we can match.
 * Usage: npx tsx scripts/epg-doctor.ts [--catalog dist/catalog.json] [--out dist] [--hours 18]
 *
 * Guide sources (public XMLTV):
 * - epgshare01.online: per-country guides (US, Canada, Israel, Mexico, Latin America, sports...)
 * - i.mjh.nz: Pluto TV, Samsung TV Plus, Plex and Roku free-channel guides
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Catalog } from '../src/core/types';
import { collectProgrammes, matchChannels, parseChannels, type Guide, type MatchTarget, type Programme } from '../src/core/epg/xmltv';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const CATALOG = arg('--catalog', 'dist/catalog.json');
const OUT = arg('--out', 'dist');
const HOURS = Number(arg('--hours', '18'));

const EPGSHARE = 'https://epgshare01.online/epgshare01';
const SOURCES = [
  ...['US1', 'US_LOCALS2', 'US_SPORTS1', 'CA1', 'IL1', 'RU1', 'MX1', 'AR1', 'CO1', 'CL1', 'PE1', 'CR1', 'DO1', 'EC1', 'PA1', 'UY1', 'SV1', 'UK1', 'PLEX1', 'DISTROTV1', 'RAKUTEN_EN1', 'viva-russia.ru'].map(
    (f) => `${EPGSHARE}/epg_ripper_${f}.xml.gz`,
  ),
  'https://i.mjh.nz/PlutoTV/us.xml.gz',
  'https://i.mjh.nz/PlutoTV/ca.xml.gz',
  'https://i.mjh.nz/PlutoTV/mx.xml.gz',
  'https://i.mjh.nz/SamsungTVPlus/us.xml.gz',
  'https://i.mjh.nz/SamsungTVPlus/ca.xml.gz',
  'https://i.mjh.nz/Plex/us.xml.gz',
  'https://i.mjh.nz/Roku/all.xml.gz',
];

async function download(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 120_000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'StreamHub-EPG/1.0' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const gz = buf[0] === 0x1f && buf[1] === 0x8b;
    return (gz ? gunzipSync(buf) : buf).toString('utf8');
  } catch {
    return null;
  }
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
  const to = now + HOURS * 3600;
  const log: string[] = [];

  for (const url of SOURCES) {
    if (!unmatched.size) break;
    const xml = await download(url);
    const name = url.split('/').slice(-2).join('/');
    if (!xml) {
      log.push(`- ${name}: unavailable`);
      continue;
    }
    const map = matchChannels([...unmatched.values()], parseChannels(xml));
    if (!map.size) {
      log.push(`- ${name}: 0 channels matched`);
      continue;
    }
    const wanted = new Set(map.values());
    const byXml = new Map<string, Programme[]>();
    collectProgrammes(xml, wanted, from, to, byXml);
    let got = 0;
    for (const [appId, xmlId] of map) {
      const list = (byXml.get(xmlId) ?? []).sort((a, b) => a[0] - b[0]).slice(0, 14);
      if (!list.length) continue;
      programs[appId] = list;
      unmatched.delete(appId);
      got++;
    }
    log.push(`- ${name}: ${got} channels with schedule`);
    console.log(log[log.length - 1]);
  }

  const guide: Guide = { version: 1, builtAt: Date.now(), programs };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'epg.json'), JSON.stringify(guide));
  const covered = Object.keys(programs).length;
  const report = [`# TV guide`, ``, `${covered} of ${catalog.channels.length} channels have a schedule.`, ``, ...log].join('\n');
  writeFileSync(join(OUT, 'epg-report.md'), report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
