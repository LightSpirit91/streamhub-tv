/**
 * Audit history and snapshots (catalog branch: history/).
 * - history/audit.jsonl: one line per published run (what changed, counts).
 * - history/<YYYY-MM-DD>/: gzipped copies of the main lists, the last N kept,
 *   so any night can be restored with the Rollback workflow.
 */
export interface AuditEntry {
  at: number;
  job: string;
  channels?: number;
  streams?: number;
  movies?: number;
  shows?: number;
  guideChannels?: number;
  added?: number;
  removed?: number;
  discovered?: number;
  note?: string;
}

export const SNAPSHOT_FILES = ['catalog.json', 'movies.json', 'shows.json', 'graveyard.json', 'health.json', 'discovered.m3u'];

export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Snapshot folders to delete so only the newest `keep` remain. */
export function snapshotsToDrop(days: string[], keep: number): string[] {
  const valid = days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return valid.slice(0, Math.max(0, valid.length - keep));
}

export function parseAudit(text: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as AuditEntry;
      if (typeof e.at === 'number' && typeof e.job === 'string') out.push(e);
    } catch {
      // skip a damaged line
    }
  }
  return out;
}

/** Channel ids added and removed between two nights. */
export function diffIds(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: after.filter((x) => !b.has(x)), removed: before.filter((x) => !a.has(x)) };
}

/** What the app's "Refresh & health" panel shows (status.json). */
export interface RefreshStatus {
  builtAt: number;
  settings: {
    channelsEveryHours: number;
    guideEveryHours: number;
    deepCheck: boolean;
    failuresBeforeRemoval: number;
    recheckRemovedEveryDays: number;
    maxRequestsPerRun: number;
    maxRunMinutes: number;
    discovery: boolean;
    discoverySchedule: 'manual' | 'daily';
  };
  sources: { id: string; links: number; working: number; badNights: number; off: boolean }[];
  discovery?: { at: number; repos: number; candidates: number; accepted: number; rejected: Record<string, number> };
  audit: AuditEntry[];
  snapshots: string[];
}
