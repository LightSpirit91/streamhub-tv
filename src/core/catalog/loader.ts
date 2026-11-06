import type { Catalog } from '../types';
import { parseM3U } from '../m3u/parseM3U';
import { parseFamelack } from '../m3u/famelack';
import { buildCatalog, CATALOG_VERSION, type SourceBatch } from './buildCatalog';
import { SOURCES, STREAMHUB_CATALOG_URL, type PlaylistSource } from './sources';

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface LoadOptions {
  fetcher?: Fetcher;
  sources?: PlaylistSource[];
  includeLazy?: boolean;
  timeoutMs?: number;
  concurrency?: number;
  onProgress?: (done: number, total: number, sourceId: string) => void;
}

export async function fetchText(url: string, fetcher: Fetcher, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Tries each mirror in order. Returns null if all fail (never throws). */
export async function fetchSource(
  source: PlaylistSource,
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<SourceBatch | null> {
  for (const url of source.urls) {
    try {
      const text = await fetchText(url, fetcher, timeoutMs);
      const entries = source.format === 'famelack' ? parseFamelack(text) : parseM3U(text);
      if (entries.length) return { source, entries };
    } catch {
      // next mirror
    }
  }
  return null;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Loads the catalog:
 * 1. StreamHub nightly catalog (pre-built + health-checked). One small JSON.
 * 2. If that is missing or stale (>36h), parse the playlists on device.
 */
export async function loadCatalog(opts: LoadOptions = {}): Promise<Catalog> {
  const fetcher = opts.fetcher ?? (globalThis.fetch as unknown as Fetcher);
  const timeoutMs = opts.timeoutMs ?? 20_000;

  if (!opts.sources) {
    try {
      const json = JSON.parse(await fetchText(STREAMHUB_CATALOG_URL, fetcher, timeoutMs)) as Catalog;
      const fresh = Date.now() - json.builtAt < 36 * 3_600_000;
      if (json.version === CATALOG_VERSION && fresh && json.channels.length > 500) return json;
    } catch {
      // fall through to on-device build
    }
  }

  const sources = (opts.sources ?? SOURCES).filter((s) => opts.includeLazy || !s.lazy);
  let done = 0;
  const batches = await pool(sources, opts.concurrency ?? 6, async (s) => {
    const b = await fetchSource(s, fetcher, timeoutMs);
    opts.onProgress?.(++done, sources.length, s.id);
    return b;
  });
  const ok = batches.filter((b): b is SourceBatch => b !== null);
  if (!ok.length) throw new Error('No playlist source could be reached');
  return buildCatalog(ok);
}
