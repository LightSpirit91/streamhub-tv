import { File, Paths } from 'expo-file-system';
import { createMMKV } from 'react-native-mmkv';
import type { BlobStore } from '../core/catalog/cache';

/**
 * Two stores, each matched to its job:
 * - Catalog (2-6 MB JSON) -> a file in the cache directory. Too big for
 *   AsyncStorage's Android limits, and MMKV keeps everything in memory.
 * - Small, hot state (favorites, recents, last channel, health, settings)
 *   -> MMKV: synchronous, ~30x faster than AsyncStorage.
 */
export const fileBlobStore: BlobStore = {
  async read(key) {
    const f = new File(Paths.cache, key);
    return f.exists ? f.text() : null;
  },
  async write(key, value) {
    const f = new File(Paths.cache, key);
    if (!f.exists) f.create({ overwrite: true });
    await f.write(value);
  },
  async remove(key) {
    const f = new File(Paths.cache, key);
    if (f.exists) f.delete();
  },
};

export const kv = createMMKV({ id: 'streamhub' });

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = kv.getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  kv.set(key, JSON.stringify(value));
}
