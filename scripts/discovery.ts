/**
 * Daily discovery (manual until you approve a schedule; see docs/DISCOVERY.md).
 *
 * 1. GitHub repository search (settings: discovery.searches), forks and
 *    archived repos left out, only repos pushed in the last 30 days.
 * 2. Repos whose last push hasn't changed since the previous run are skipped
 *    (cache: discovery/repos.json).
 * 3. Playlist files (.m3u / .m3u8) are downloaded as plain text, size-capped,
 *    through the safe fetcher, and parsed as data. Nothing from a repository is
 *    executed or followed as an instruction.
 * 4. Each link goes through src/core/discovery/screen.ts, then the real
 *    playback check. Accepted links go to discovered.m3u, which the nightly
 *    Channel Doctor loads as the "Daily discovery" source and re-checks every
 *    night like everything else.
 *
 * Usage: npx tsx scripts/discovery.ts --current current --out out
 * Env: GITHUB_TOKEN (the Actions token, read-only; used only for api.github.com)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog, PlaylistEntry } from '../src/core/types';
import { parseM3U } from '../src/core/m3u/parseM3U';
import { PROFILE_COUNTRIES } from '../src/core/catalog/sources';
import { hostOf, entryCountries, normName } from '../src/core/discovery/screen';
import { parseSettings } from '../src/core/refresh/settings';
import { screenEntry, screenRepo, toM3uLine, trustedHosts, type Rejection, type RepoInfo } from '../src/core/discovery/screen';
import { validateStream } from '../src/core/playback/validate';
import type { HealthState } from '../src/core/playback/health';
import { Budget, makeGetBytes, safeGet } from './lib/net';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const CUR = arg('--current', 'current');
const OUT = arg('--out', 'out');
const readJson = <T,>(p: string): T | undefined => {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined;
  } catch {
    return undefined;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = parseSettings(readJson('config/refresh.json'));
const D = S.discovery;
const started = Date.now();

interface RepoCache {
  pushed_at: string;
  checkedAt: number;
  playlists: number;
  candidates: number;
  accepted: number;
  skipped?: Rejection;
}

async function gh<T>(path: string): Promise<T | undefined> {
  const token = process.env.GITHUB_TOKEN;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StreamHub-Discovery', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (r.ok) return (await r.json()) as T;
    if (r.status === 403 || r.status === 429) {
      // Rate limited: wait (backoff) and retry.
      await sleep(10_000 * 2 ** attempt);
      continue;
    }
    console.warn(`GitHub ${r.status} for ${path}`);
    return undefined;
  }
  return undefined;
}

type SearchRepo = RepoInfo & { pushed_at: string; default_branch: string; stargazers_count: number };

const PRIORITY = /(^|[\/_.-])(us|usa|ca|canada|uk|gb|il|israel|ru|russia|mx|mexico|sports?|news|fast|pluto|roku|tubi|xumo|stirr|free)([\/_.-]|$)/i;

async function main() {
  mkdirSync(join(OUT, 'discovery'), { recursive: true });
  const prevM3u = existsSync(join(CUR, 'discovered.m3u')) ? readFileSync(join(CUR, 'discovered.m3u'), 'utf8') : '';
  const prevEntries = parseM3U(prevM3u);
  const cache: Record<string, RepoCache> = readJson(join(CUR, 'discovery', 'repos.json')) ?? {};
  const health = readJson<HealthState>(join(CUR, 'health.json'));
  const catalog = readJson<Catalog>(join(CUR, 'catalog.json'));
  const rejected: Record<string, number> = {};
  const reject = (r: Rejection) => (rejected[r] = (rejected[r] ?? 0) + 1);

  if (!D.enabled || !catalog) {
    writeFileSync(join(OUT, 'discovered.m3u'), prevM3u || '#EXTM3U\n');
    writeFileSync(join(OUT, 'discovery', 'repos.json'), JSON.stringify(cache));
    writeFileSync(join(OUT, 'discovery', 'summary.json'), JSON.stringify({ at: started, repos: 0, candidates: 0, accepted: 0, rejected: { [D.enabled ? 'no-catalog' : 'discovery-off']: 1 } }));
    console.log(D.enabled ? 'No catalog to compare against; nothing done.' : 'Discovery is off in config/refresh.json.');
    return;
  }

  // Trust only hosts that serve channels of the countries you watch.
  const vetted = catalog.channels
    .filter((c) => !c.country || PROFILE_COUNTRIES.has(c.country))
    .flatMap((c) => c.streams.filter((s) => s.source !== 'discovered').map((s) => s.url));
  const ctx = { countries: PROFILE_COUNTRIES, knownNames: new Set(catalog.channels.flatMap((c) => [c.name, ...(c.altNames ?? [])]).map(normName)), trusted: trustedHosts(vetted, D.trustedHosts), excludedHosts: D.excludedHosts, knownUrls: new Set([...catalog.channels.flatMap((c) => c.streams.map((s) => s.url)), ...prevEntries.map((e) => e.url)]) };

  // 1. Search.
  const since = new Date(started - 30 * 86_400_000).toISOString().slice(0, 10);
  const found = new Map<string, SearchRepo>();
  for (const q of D.searches) {
    const res = await gh<{ items: SearchRepo[] }>(`/search/repositories?q=${encodeURIComponent(`${q} fork:false archived:false pushed:>=${since}`)}&sort=updated&order=desc&per_page=30`);
    for (const r of res?.items ?? []) found.set(r.full_name.toLowerCase(), r);
    await sleep(2500); // search API: 30 requests a minute
  }

  // 2. Screen repos; skip unchanged ones.
  const queue: SearchRepo[] = [];
  for (const [key, r] of found) {
    const why = screenRepo(r, D.excludedRepos);
    if (why) {
      reject(why);
      cache[key] = { pushed_at: r.pushed_at, checkedAt: started, playlists: 0, candidates: 0, accepted: 0, skipped: why };
      continue;
    }
    if (cache[key]?.pushed_at === r.pushed_at) {
      reject('duplicate');
      continue;
    }
    queue.push(r);
  }
  queue.sort((a, b) => b.stargazers_count - a.stargazers_count);

  // 3. Playlists -> candidates.
  const candidates: { e: PlaylistEntry; repo: string }[] = [];
  const perRepo = new Map<string, { playlists: number; candidates: number; accepted: number }>();
  for (const r of queue.slice(0, D.maxReposPerRun)) {
    const stat = { playlists: 0, candidates: 0, accepted: 0 };
    perRepo.set(r.full_name.toLowerCase(), stat);
    const tree = await gh<{ sha: string; tree: { path: string; type: string; size?: number }[] }>(`/repos/${r.full_name}/git/trees/${encodeURIComponent(r.default_branch)}?recursive=1`);
    const files = (tree?.tree ?? [])
      .filter((t) => t.type === 'blob' && /\.m3u8?$/i.test(t.path) && (t.size ?? 0) > 0 && (t.size ?? 0) <= D.maxPlaylistBytes)
      .sort((a, b) => Number(PRIORITY.test(b.path)) - Number(PRIORITY.test(a.path)) || (a.size ?? 0) - (b.size ?? 0))
      .slice(0, D.maxPlaylistsPerRepo);
    for (const f of files) {
      try {
        const raw = await safeGet(`https://raw.githubusercontent.com/${r.full_name}/${tree!.sha}/${f.path.split('/').map(encodeURIComponent).join('/')}`, {}, { maxBytes: D.maxPlaylistBytes, timeoutMs: 20_000 });
        if (raw.status !== 200) continue;
        stat.playlists++;
        for (const e of parseM3U(new TextDecoder().decode(raw.bytes))) {
          const why = screenEntry(e, ctx);
          if (why) {
            reject(why);
            continue;
          }
          ctx.knownUrls.add(e.url);
          candidates.push({ e, repo: r.full_name });
          stat.candidates++;
        }
      } catch (err) {
        console.warn(`skip ${r.full_name}/${f.path}: ${(err as Error).name}`);
      }
    }
  }

  // 4. Real playback check, with its own share of the request budget.
  const budget = new Budget(Math.floor(S.limits.maxRequestsPerRun / 4), started + S.limits.maxRunMinutes * 60_000);
  const get = makeGetBytes({ budget, timeoutMs: S.playbackCheck.timeoutSeconds * 1000 });
  const accepted: { e: PlaylistEntry; repo: string }[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: 24 }, async () => {
      while (i < candidates.length && accepted.length < D.maxNewLinksPerRun && !budget.exhausted) {
        const c = candidates[i++];
        const v = await validateStream(c.e.url, get, { live: true });
        if (v.ok) {
          accepted.push(c);
          perRepo.get(c.repo.toLowerCase())!.accepted++;
        } else reject(`check-${v.reason}` as Rejection);
      }
    }),
  );

  // 5. Merge with earlier finds (minus links the nightly check removed), newest first, capped.
  const removed = (u: string) => (health?.links[u]?.fails ?? 0) >= S.playbackCheck.failuresBeforeRemoval;
  const prevBlocks = prevM3u.split(/\n(?=#EXTINF)/).filter((b) => b.startsWith('#EXTINF'));
  const keepPrev = prevBlocks.filter((b) => {
    const url = b.trim().split('\n').pop() ?? '';
    return !removed(url) && !screenEntry({ name: '', url, groups: [], attrs: {} }, { ...ctx, knownUrls: new Set() })?.match(/unsafe|banned|ppv|excluded/);
  });
  const lines = [...accepted.map((a) => toM3uLine(a.e, a.repo)), ...keepPrev.map((b) => b.trim())].slice(0, 3000);
  writeFileSync(join(OUT, 'discovered.m3u'), `#EXTM3U\n${lines.join('\n')}\n`);

  for (const [key, st] of perRepo) cache[key] = { pushed_at: found.get(key)!.pushed_at, checkedAt: started, ...st };
  writeFileSync(join(OUT, 'discovery', 'repos.json'), JSON.stringify(cache));
  const summary = { at: started, repos: perRepo.size, candidates: candidates.length, accepted: accepted.length, rejected };
  writeFileSync(join(OUT, 'discovery', 'summary.json'), JSON.stringify(summary));
  const report = [
    `# Discovery`,
    ``,
    `Searched ${D.searches.length} queries: ${found.size} repos found, ${perRepo.size} read (unchanged ones skipped).`,
    `Links: ${candidates.length} passed the rules, **${accepted.length} passed the real playback check** and were added. ${lines.length} discovered links in total.`,
    `Requests used: ${budget.used}.`,
    ``,
    `| Reason left out | Count |`,
    `|---|---|`,
    ...Object.entries(rejected).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
    ``,
    `## Sample of links added`,
    ...accepted.slice(0, 40).map((a) => `- ${a.e.name.slice(0, 60)} (${entryCountries(a.e).join('/') || '?'}) · ${hostOf(a.e.url)} · from ${a.repo}`),
    ``,
    `| Repo | Playlists | Passed rules | Added |`,
    `|---|---|---|---|`,
    ...[...perRepo].map(([k, st]) => `| ${k} | ${st.playlists} | ${st.candidates} | ${st.accepted} |`),
  ].join('\n');
  writeFileSync(join(OUT, 'discovery', 'report.md'), report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
