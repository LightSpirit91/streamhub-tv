import type { Catalog } from '../types';
import { CATALOG_VERSION } from './buildCatalog';

export const CATALOG_TTL_MS = 24 * 3_600_000;

/** Minimal async storage contract. The app plugs in expo-file-system. */
export interface BlobStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const KEY = `catalog.v${CATALOG_VERSION}.json`;

export interface CachedCatalog {
  catalog: Catalog;
  savedAt: number;
  stale: boolean;
}

export async function readCachedCatalog(store: BlobStore, now = Date.now()): Promise<CachedCatalog | null> {
  try {
    const raw = await store.read(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; catalog: Catalog };
    if (parsed.catalog?.version !== CATALOG_VERSION) return null;
    return { ...parsed, stale: now - parsed.savedAt > CATALOG_TTL_MS };
  } catch {
    return null; // corrupt cache: treat as empty
  }
}

export async function writeCachedCatalog(store: BlobStore, catalog: Catalog, now = Date.now()) {
  await store.write(KEY, JSON.stringify({ savedAt: now, catalog }));
}

/**
 * Stale-while-revalidate:
 * - Cache fresh  -> return it, no network.
 * - Cache stale  -> return it instantly, refresh in the background.
 * - No cache     -> wait for the network.
 * - `force`      -> pull-to-refresh: always hit the network.
 */
export async function getCatalog(opts: {
  store: BlobStore;
  load: () => Promise<Catalog>;
  force?: boolean;
  onBackgroundUpdate?: (c: Catalog) => void;
  now?: number;
}): Promise<{ catalog: Catalog; from: 'cache' | 'network' }> {
  const cached = opts.force ? null : await readCachedCatalog(opts.store, opts.now);

  if (cached && !cached.stale) return { catalog: cached.catalog, from: 'cache' };

  if (cached?.stale) {
    opts
      .load()
      .then(async (c) => {
        await writeCachedCatalog(opts.store, c);
        opts.onBackgroundUpdate?.(c);
      })
      .catch(() => {
        // keep serving the stale copy
      });
    return { catalog: cached.catalog, from: 'cache' };
  }

  try {
    const catalog = await opts.load();
    await writeCachedCatalog(opts.store, catalog);
    return { catalog, from: 'network' };
  } catch (err) {
    // Forced refresh failed (offline): fall back to whatever is on disk.
    const fallback = await readCachedCatalog(opts.store, opts.now);
    if (fallback) return { catalog: fallback.catalog, from: 'cache' };
    throw err;
  }
}
