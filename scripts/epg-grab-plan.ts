/**
 * Plans tonight's schedule collection with iptv-org/epg: for every channel
 * that has no schedule or less than 3 days of it, pick one guide site from
 * iptv-org/epg that lists it (preferred sites first) and write one
 * custom channels file per site. The grab job then collects up to 7 days.
 *
 * Usage: npx tsx scripts/epg-grab-plan.ts --catalog dist/catalog.json
 *          --week dist/epg-week --sites epg/sites --out grab [--max 900]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog } from '../src/core/types';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const CATALOG = arg('--catalog', 'dist/catalog.json');
const WEEK = arg('--week', 'dist/epg-week');
const SITES = arg('--sites', 'epg/sites');
const OUT = arg('--out', 'grab');
const MAX = Number(arg('--max', '900'));

/** Sites that cover our countries well, best first. Others are used only when nothing better lists a channel. */
const PREFERRED = ['tv.mail.ru', 'epg.iptvx.one', 'tvtv.us', 'tvpassport.com', 'tvguide.com', 'mi.tv', 'gatotv.com', 'freetv.tv', 'sky.com', 'reportv.com.ar', 'siba.com.co', 'directv.com.uy'];
/** Never used: already covered by our guides, or services we don't offer. */
const SKIP = new Set(['i.mjh.nz', 'pluto.tv', 'plex.tv', 'samsung.com', 'xumo.tv']);
const MAX_SITES = 10;

const base = (id: string) => id.toLowerCase().split('@')[0];

function reachDays(): Map<string, number> {
  const out = new Map<string, number>();
  if (!existsSync(WEEK)) return out;
  const now = Date.now() / 1000;
  for (const f of readdirSync(WEEK)) {
    try {
      const g = JSON.parse(readFileSync(join(WEEK, f), 'utf8')) as { programs: Record<string, [number, number][]> };
      for (const [id, l] of Object.entries(g.programs)) out.set(id, (l[l.length - 1][1] - now) / 86400);
    } catch {
      // unreadable file: treat its channels as having no schedule
    }
  }
  return out;
}

function main() {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf8')) as Catalog;
  const reach = reachDays();
  const needed = new Map(cat.channels.filter((c) => !((reach.get(c.id) ?? 0) >= 3)).map((c) => [c.id, c]));

  // channel id -> site -> the exact <channel .../> line from that site's list
  const lines = new Map<string, Map<string, string>>();
  for (const site of readdirSync(SITES)) {
    if (SKIP.has(site)) continue;
    const dir = join(SITES, site);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.channels.xml'));
    } catch {
      continue;
    }
    for (const f of files) {
      const xml = readFileSync(join(dir, f), 'utf8');
      for (const m of xml.matchAll(/<channel\b[^>]*xmltv_id="([^"]+)"[^>]*>[^<]*<\/channel>/g)) {
        const id = base(m[1]);
        if (!needed.has(id)) continue;
        const bySite = lines.get(id) ?? new Map<string, string>();
        if (!bySite.has(site)) bySite.set(site, m[0]);
        lines.set(id, bySite);
      }
    }
  }

  // Most popular channels first; one site each.
  const ids = [...lines.keys()].sort((a, b) => (needed.get(b)!.popularity ?? 0) - (needed.get(a)!.popularity ?? 0)).slice(0, MAX);
  const plan = new Map<string, string[]>();
  const rank = (s: string) => (PREFERRED.includes(s) ? PREFERRED.indexOf(s) : 100);
  for (const id of ids) {
    const site = [...lines.get(id)!.keys()].sort((a, b) => rank(a) - rank(b))[0];
    plan.set(site, [...(plan.get(site) ?? []), lines.get(id)!.get(site)!]);
  }
  // Keep the sites that cover the most channels.
  const chosen = [...plan.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_SITES);
  mkdirSync(OUT, { recursive: true });
  for (const [site, ls] of chosen) {
    writeFileSync(join(OUT, `${site}.channels.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<channels>\n  ${ls.join('\n  ')}\n</channels>\n`);
  }
  writeFileSync(join(OUT, 'sites.txt'), chosen.map(([s]) => s).join('\n') + '\n');
  console.log(`channels without a 3-day schedule: ${needed.size}; listed by iptv-org/epg: ${lines.size}; planned: ${chosen.reduce((n, [, l]) => n + l.length, 0)}`);
  for (const [s, l] of chosen) console.log(`  ${s}: ${l.length}`);
}

main();
