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
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import type { Catalog } from '../src/core/types';
import { collectProgrammes, matchChannels, parseChannels, type Guide, type MatchTarget, type Programme } from '../src/core/epg/xmltv';
// Guide files named per country by epgshare01. Unknown names simply report "unavailable".

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
): Promise<{ map: Map<string, string>; byXml: Map<string, Programme[]> } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 900_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'StreamHub-EPG/1.1' } });
    if (!res.ok || !res.body) return null;
    let stream: NodeJS.ReadableStream = Readable.fromWeb(res.body as never);
    if (url.endsWith('.gz')) stream = stream.pipe(createGunzip());
    stream.setEncoding?.('utf8');

    let buf = '';
    let channelsXml = '';
    let map: Map<string, string> | null = null;
    let wanted = new Set<string>();
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
        map = matchChannels(targets, parseChannels(channelsXml));
        channelsXml = '';
        if (!map.size) return { map, byXml };
        wanted = new Set(map.values());
      }
      const cut = buf.lastIndexOf('</programme>');
      if (cut === -1) continue;
      collectProgrammes(buf.slice(0, cut + 12), wanted, from, to, byXml);
      buf = buf.slice(cut + 12);
    }
    if (!map) map = matchChannels(targets, parseChannels(channelsXml + buf));
    return { map, byXml };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
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
    const name = url.split('/').slice(-2).join('/');
    const got0 = await processSource(url, [...unmatched.values()], from, to);
    if (!got0) {
      log.push(`- ${name}: unavailable`);
      console.log(log[log.length - 1]);
      continue;
    }
    let got = 0;
    for (const [appId, xmlId] of got0.map) {
      const list = (got0.byXml.get(xmlId) ?? []).sort((a, b) => a[0] - b[0]).slice(0, 14);
      if (!list.length) continue;
      programs[appId] = list;
      unmatched.delete(appId);
      got++;
    }
    log.push(`- ${name}: ${got0.map.size} matched, ${got} with schedule`);
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

if (process.argv[1]?.endsWith('epg-doctor.ts')) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
