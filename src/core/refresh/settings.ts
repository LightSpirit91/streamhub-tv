/**
 * Refresh settings (config/refresh.json). The file is edited by hand, so
 * every value is checked and clamped here; anything missing falls back to
 * the defaults. There is no setting that enables a paid service: the cost
 * cap is fixed at $0 and the jobs only use free GitHub Actions minutes.
 */
export interface RefreshSettings {
  refresh: { channelsEveryHours: number; guideEveryHours: number; moviesEveryHours: number };
  playbackCheck: { deep: boolean; timeoutSeconds: number; concurrency: number; failuresBeforeRemoval: number; recheckRemovedEveryDays: number };
  limits: { maxRequestsPerRun: number; maxRunMinutes: number; costCapUsd: 0 };
  discovery: {
    enabled: boolean;
    maxReposPerRun: number;
    maxPlaylistsPerRepo: number;
    maxPlaylistBytes: number;
    maxNewLinksPerRun: number;
    searches: string[];
    excludedRepos: string[];
    excludedHosts: string[];
    trustedHosts: string[];
  };
  excludedSources: string[];
  snapshotsToKeep: number;
  publishGuard: { maxChannelDropPercent: number };
}

export const DEFAULT_SETTINGS: RefreshSettings = {
  refresh: { channelsEveryHours: 24, guideEveryHours: 6, moviesEveryHours: 24 },
  playbackCheck: { deep: true, timeoutSeconds: 10, concurrency: 48, failuresBeforeRemoval: 3, recheckRemovedEveryDays: 7 },
  limits: { maxRequestsPerRun: 60000, maxRunMinutes: 70, costCapUsd: 0 },
  discovery: {
    enabled: true,
    maxReposPerRun: 25,
    maxPlaylistsPerRepo: 6,
    maxPlaylistBytes: 5_000_000,
    maxNewLinksPerRun: 400,
    searches: ['topic:iptv m3u', 'topic:m3u8 playlist', 'iptv playlist in:name,description'],
    excludedRepos: [],
    excludedHosts: [],
    trustedHosts: [],
  },
  excludedSources: [],
  snapshotsToKeep: 7,
  publishGuard: { maxChannelDropPercent: 30 },
};

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
/** Plain short strings only (no control characters), at most `max` of them. */
const strs = (v: unknown, def: string[], max = 50, len = 200) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= len && !/[\u0000-\u001f]/.test(x)).slice(0, max) : def;
const host = (h: string) => h.trim().toLowerCase().replace(/^\*\./, '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseSettings(raw: unknown): RefreshSettings {
  const r = obj(raw);
  const d = DEFAULT_SETTINGS;
  const rf = obj(r.refresh);
  const pc = obj(r.playbackCheck);
  const li = obj(r.limits);
  const di = obj(r.discovery);
  const pg = obj(r.publishGuard);
  return {
    refresh: {
      channelsEveryHours: num(rf.channelsEveryHours, d.refresh.channelsEveryHours, 24, 168),
      guideEveryHours: num(rf.guideEveryHours, d.refresh.guideEveryHours, 6, 168),
      moviesEveryHours: num(rf.moviesEveryHours, d.refresh.moviesEveryHours, 24, 168),
    },
    playbackCheck: {
      deep: bool(pc.deep, d.playbackCheck.deep),
      timeoutSeconds: num(pc.timeoutSeconds, d.playbackCheck.timeoutSeconds, 3, 30),
      concurrency: num(pc.concurrency, d.playbackCheck.concurrency, 1, 96),
      failuresBeforeRemoval: num(pc.failuresBeforeRemoval, d.playbackCheck.failuresBeforeRemoval, 1, 14),
      recheckRemovedEveryDays: num(pc.recheckRemovedEveryDays, d.playbackCheck.recheckRemovedEveryDays, 1, 60),
    },
    limits: {
      maxRequestsPerRun: num(li.maxRequestsPerRun, d.limits.maxRequestsPerRun, 1000, 200_000),
      maxRunMinutes: num(li.maxRunMinutes, d.limits.maxRunMinutes, 10, 80),
      costCapUsd: 0,
    },
    discovery: {
      enabled: bool(di.enabled, d.discovery.enabled),
      maxReposPerRun: num(di.maxReposPerRun, d.discovery.maxReposPerRun, 0, 100),
      maxPlaylistsPerRepo: num(di.maxPlaylistsPerRepo, d.discovery.maxPlaylistsPerRepo, 1, 20),
      maxPlaylistBytes: num(di.maxPlaylistBytes, d.discovery.maxPlaylistBytes, 10_000, 20_000_000),
      maxNewLinksPerRun: num(di.maxNewLinksPerRun, d.discovery.maxNewLinksPerRun, 0, 5000),
      searches: strs(di.searches, d.discovery.searches, 10, 120),
      excludedRepos: strs(di.excludedRepos, []).map((x) => x.toLowerCase()),
      excludedHosts: strs(di.excludedHosts, [], 500).map(host),
      trustedHosts: strs(di.trustedHosts, [], 500).map(host),
    },
    excludedSources: strs(r.excludedSources, [], 200),
    snapshotsToKeep: num(r.snapshotsToKeep, d.snapshotsToKeep, 1, 14),
    publishGuard: { maxChannelDropPercent: num(pg.maxChannelDropPercent, d.publishGuard.maxChannelDropPercent, 5, 90) },
  };
}

/** Is a job due, given when it last finished? (10 minutes of slack for schedule drift.) */
export const isDue = (lastAt: number | undefined, everyHours: number, now = Date.now()) =>
  lastAt === undefined || now - lastAt >= everyHours * 3_600_000 - 10 * 60_000;
