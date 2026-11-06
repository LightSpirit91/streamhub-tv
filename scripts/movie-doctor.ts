/**
 * Builds dist/movies.json from the Internet Archive feature film collections.
 * Runs nightly next to the Channel Doctor.
 * Usage: npx tsx scripts/movie-doctor.ts [--limit 600] [--out dist]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metadataUrl, searchUrl, toMovie, type ArchiveFile, type SearchDoc } from '../src/core/movies/archive';
import type { Movie, MovieCatalog } from '../src/core/movies/types';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LIMIT = Number(arg('--limit', '600'));
const OUT = arg('--out', 'dist');
const UA = { 'User-Agent': 'StreamHub-MovieDoctor/1.0 (+https://github.com/LightSpirit91/streamhub-tv)' };

async function json<T>(url: string): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(url, { headers: UA, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return (await res.json()) as T;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`Failed: ${url}`);
}

async function main() {
  const docs: SearchDoc[] = [];
  for (let page = 1; docs.length < LIMIT; page++) {
    const r = await json<{ response: { docs: SearchDoc[] } }>(searchUrl(Math.min(500, LIMIT), page));
    if (!r.response.docs.length) break;
    docs.push(...r.response.docs);
  }
  console.log(`search: ${docs.length} candidates`);

  const movies: Movie[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (i < Math.min(docs.length, LIMIT)) {
        const d = docs[i++];
        try {
          const meta = await json<{ files?: ArchiveFile[]; metadata?: { runtime?: string } }>(metadataUrl(d.identifier));
          const m = toMovie({ ...d, runtime: d.runtime ?? meta.metadata?.runtime }, meta.files ?? []);
          if (m) movies.push(m);
        } catch {
          // skip this title
        }
      }
    }),
  );

  // Dedupe by normalized title + year, keep the most popular copy.
  const seen = new Map<string, Movie>();
  for (const m of movies.sort((a, b) => b.popularity - a.popularity)) {
    const key = `${m.title.toLowerCase().replace(/[^a-z0-9]/g, '')}:${m.year ?? ''}`;
    if (!seen.has(key)) seen.set(key, m);
  }
  const catalog: MovieCatalog = { version: 1, builtAt: Date.now(), movies: [...seen.values()] };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'movies.json'), JSON.stringify(catalog));
  const byGenre: Record<string, number> = {};
  for (const m of catalog.movies) for (const g of m.genres) byGenre[g] = (byGenre[g] ?? 0) + 1;
  console.log(`movies: ${catalog.movies.length}`, byGenre);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
