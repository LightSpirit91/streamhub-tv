import { createMMKV } from 'react-native-mmkv';
import type { BlobStore } from '../core/catalog/cache';

/**
 * Browser version of storage.ts (Metro picks *.web.ts automatically).
 * - Catalog -> IndexedDB (localStorage caps at ~5 MB, the catalog can pass that).
 * - Small state -> MMKV's web build (localStorage under the hood).
 */
const DB = 'streamhub';
const STORE = 'blobs';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const fileBlobStore: BlobStore = {
  async read(key) {
    try {
      return (await run<string | undefined>('readonly', (s) => s.get(key))) ?? null;
    } catch {
      return null; // private browsing or blocked storage: run without cache
    }
  },
  async write(key, value) {
    try {
      await run('readwrite', (s) => s.put(value, key));
    } catch {
      // cache is a convenience, never fatal
    }
  },
  async remove(key) {
    try {
      await run('readwrite', (s) => s.delete(key));
    } catch {
      // ignore
    }
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
  try {
    kv.set(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
