/**
 * Restores the lists from a snapshot (history/<day>/) into dist/.
 * Usage: npx tsx scripts/rollback.ts --dist dist --day 2026-11-06
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { SNAPSHOT_FILES } from '../src/core/refresh/history';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DIST = arg('--dist', 'dist');
const DAY = arg('--day', '');
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) {
  console.error('Give --day as YYYY-MM-DD');
  process.exit(1);
}
const dir = join(DIST, 'history', DAY);
if (!existsSync(dir)) {
  const have = existsSync(join(DIST, 'history')) ? readdirSync(join(DIST, 'history')).filter((d) => /^\d{4}/.test(d)) : [];
  console.error(`No snapshot for ${DAY}. Available: ${have.join(', ') || 'none'}`);
  process.exit(1);
}
const restored: string[] = [];
for (const f of SNAPSHOT_FILES) {
  const p = join(dir, `${f}.gz`);
  if (!existsSync(p)) continue;
  const data = gunzipSync(readFileSync(p));
  if (f.endsWith('.json')) JSON.parse(data.toString('utf8')); // refuse a damaged snapshot
  writeFileSync(join(DIST, f), data);
  restored.push(f);
}
// Keep the app's 36-hour freshness check happy: a restored list counts as built now.
const catPath = join(DIST, 'catalog.json');
if (restored.includes('catalog.json')) {
  const c = JSON.parse(readFileSync(catPath, 'utf8'));
  c.builtAt = Date.now();
  writeFileSync(catPath, JSON.stringify(c));
}
console.log(`Restored from ${DAY}: ${restored.join(', ')}`);
