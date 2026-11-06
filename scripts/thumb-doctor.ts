/**
 * Grabs one live frame per top channel with ffmpeg, so cards show what the
 * channel actually looks like. YouTube lives use YouTube's own thumbnail.
 * Usage: npx tsx scripts/thumb-doctor.ts [--catalog dist/catalog.json] [--out dist] [--max 500]
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog, Channel } from '../src/core/types';
import { youtubeId } from '../src/core/catalog/normalize';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const CATALOG = arg('--catalog', 'dist/catalog.json');
const OUT = arg('--out', 'dist');
const MAX = Number(arg('--max', '500'));
const BASE = 'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/thumbs';

const safe = (id: string) => id.replace(/[^a-z0-9._-]/gi, '_');

function grab(c: Channel, file: string): Promise<boolean> {
  const s = c.streams.find((x) => x.format === 'hls' || x.format === 'progressive');
  if (!s) return Promise.resolve(false);
  const headerArgs: string[] = [];
  if (s.headers?.['User-Agent']) headerArgs.push('-user_agent', s.headers['User-Agent']);
  if (s.headers?.Referer) headerArgs.push('-headers', `Referer: ${s.headers.Referer}\r\n`);
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-rw_timeout', '15000000', ...headerArgs, '-i', s.url, '-ss', '3', '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '7', file],
      { timeout: 30_000 },
      (err) => {
        try {
          resolve(!err && statSync(file).size > 3000); // skip black/empty frames
        } catch {
          resolve(false);
        }
      },
    );
  });
}

async function main() {
  const cat: Catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const dir = join(OUT, 'thumbs');
  mkdirSync(dir, { recursive: true });
  // Spotlight first, then the most popular, then the top of every hub.
  const pick: Channel[] = [];
  const add = (c: Channel) => pick.length < MAX && !pick.includes(c) && pick.push(c);
  cat.channels.filter((c) => c.hubs.includes('spotlight')).forEach(add);
  cat.channels.filter((c) => c.popularity > 0).forEach(add);
  for (const hub of new Set(cat.channels.flatMap((c) => c.hubs))) cat.channels.filter((c) => c.hubs.includes(hub)).slice(0, 40).forEach(add);

  const version = Date.now();
  let ok = 0;
  let i = 0;
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      while (i < pick.length) {
        const c = pick[i++];
        const yt = c.streams.map((s) => (s.format === 'youtube' ? youtubeId(s.url) : undefined)).find(Boolean);
        if (yt && c.streams[0].format === 'youtube') {
          c.thumb = `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
          ok++;
          continue;
        }
        const name = `${safe(c.id)}.jpg`;
        if (await grab(c, join(dir, name))) {
          c.thumb = `${BASE}/${name}?v=${version}`;
          ok++;
        }
      }
    }),
  );
  writeFileSync(CATALOG, JSON.stringify(cat));
  const report = `# Channel previews\n\n${ok} of ${pick.length} top channels have a fresh preview image.`;
  writeFileSync(join(OUT, 'thumbs-report.md'), report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
