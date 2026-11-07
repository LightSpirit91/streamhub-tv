/**
 * Link and source health across nights (stored as health.json on the
 * catalog branch).
 *
 * - A clear "gone" answer (404 / 410, unsafe address) removes a link at once.
 * - Anything else that fails the real playback check (error page, no video,
 *   ended stream, connection refused) is a strike. A link is removed after
 *   `failuresBeforeRemoval` failed nights in a row, then re-tested only every
 *   `recheckRemovedEveryDays` (backoff). One good night clears the strikes.
 * - Geo-locks (401/403/451), timeouts and checks skipped by the request
 *   budget are "unknown": no strike, the link stays.
 * - A source (playlist) with no working link for `failuresBeforeRemoval`
 *   nights in a row is switched off and retried after the same backoff.
 */
import type { Verdict } from './validate';

export type Outcome = 'pass' | 'fail' | 'gone' | 'unknown';

export interface LinkHealth {
  fails: number;
  firstFail: number;
  lastCheck: number;
  reason: string;
}
export interface SourceHealth {
  badNights: number;
  lastGood?: number;
  lastTry: number;
  disabledAt?: number;
  links?: number;
  working?: number;
}
export interface HealthState {
  version: 1;
  updatedAt: number;
  links: Record<string, LinkHealth>;
  sources: Record<string, SourceHealth>;
}

export interface HealthRules {
  failuresBeforeRemoval: number;
  recheckRemovedEveryDays: number;
}

export const emptyHealth = (): HealthState => ({ version: 1, updatedAt: 0, links: {}, sources: {} });

export function outcomeOf(v: Verdict): Outcome {
  if (v.ok) return 'pass';
  if (v.reason === 'unsafe') return 'gone';
  if (v.reason === 'http' && /HTTP (404|410)\b/.test(v.detail)) return 'gone';
  if (v.reason === 'locked' || v.reason === 'timeout' || v.reason === 'skipped') return 'unknown';
  return 'fail';
}

const DAY = 86_400_000;

/** Removed earlier and not due for a re-test yet: skip the request, stay removed. */
export function restingLink(h: HealthState, url: string, rules: HealthRules, now: number): boolean {
  const e = h.links[url];
  return !!e && e.fails >= rules.failuresBeforeRemoval && now - e.lastCheck < rules.recheckRemovedEveryDays * DAY;
}

/** Records tonight's result; returns whether the link stays listed. */
export function recordLink(h: HealthState, url: string, v: Verdict, rules: HealthRules, now: number): { keep: boolean; outcome: Outcome } {
  const o = outcomeOf(v);
  if (o === 'pass') {
    delete h.links[url];
    return { keep: true, outcome: o };
  }
  if (o === 'unknown') return { keep: !(h.links[url]?.fails >= rules.failuresBeforeRemoval), outcome: o };
  const prev = h.links[url];
  const reason = v.ok ? '' : `${v.reason}: ${v.detail}`;
  const e: LinkHealth = { fails: o === 'gone' ? Math.max(rules.failuresBeforeRemoval, (prev?.fails ?? 0) + 1) : (prev?.fails ?? 0) + 1, firstFail: prev?.firstFail ?? now, lastCheck: now, reason };
  h.links[url] = e;
  return { keep: e.fails < rules.failuresBeforeRemoval, outcome: o };
}

/** Sources switched off by their health (not due for a retry yet). */
export function restingSources(h: HealthState, rules: HealthRules, now: number): Set<string> {
  const out = new Set<string>();
  for (const [id, s] of Object.entries(h.sources)) {
    if (s.disabledAt && now - s.disabledAt < rules.recheckRemovedEveryDays * DAY) out.add(id);
  }
  return out;
}

/** Records a source's night: how many of its links were checked and how many work. */
export function recordSource(h: HealthState, id: string, links: number, working: number, loaded: boolean, rules: HealthRules, now: number): SourceHealth {
  const prev = h.sources[id] ?? { badNights: 0, lastTry: now };
  const good = loaded && working > 0;
  const s: SourceHealth = good
    ? { badNights: 0, lastGood: now, lastTry: now, links, working }
    : { ...prev, badNights: prev.badNights + 1, lastTry: now, links, working };
  if (!good && s.badNights >= rules.failuresBeforeRemoval) s.disabledAt = now;
  if (good) delete s.disabledAt;
  h.sources[id] = s;
  return s;
}

/** Forget links that have not been seen for 90 days (keeps the file small). */
export function pruneHealth(h: HealthState, seen: Set<string>, now: number): void {
  for (const [url, e] of Object.entries(h.links)) if (!seen.has(url) && now - e.lastCheck > 90 * DAY) delete h.links[url];
}
