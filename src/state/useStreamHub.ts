import { create } from 'zustand';
import type { Channel, StreamHealth } from '../core/types';
import { getCatalog } from '../core/catalog/cache';
import { loadCatalog } from '../core/catalog/loader';
import { applyHealth } from '../core/catalog/buildCatalog';
import { channelsForDevice } from '../core/platform/compat';
import { pushRecent, recordResult } from '../core/health/failover';
import { detectDevice } from '../services/device';
import { fileBlobStore, readJSON, writeJSON } from '../services/storage';

const device = detectDevice();

interface StreamHubState {
  status: 'loading' | 'ready' | 'error';
  progress: string;
  error?: string;
  channels: Channel[];
  byId: Map<string, Channel>;
  favorites: string[];
  recents: string[];
  lastChannelId?: string;
  health: Record<string, StreamHealth>;
  load(force?: boolean): Promise<void>;
  toggleFavorite(id: string): void;
  markWatched(id: string): void;
  reportStream(url: string, ok: boolean): void;
}

function prepare(channels: Channel[], health: Record<string, StreamHealth>) {
  const list = applyHealth(channelsForDevice(channels, device), health);
  return { channels: list, byId: new Map(list.map((c) => [c.id, c])) };
}

let healthTimer: ReturnType<typeof setTimeout> | undefined;

export const useStreamHub = create<StreamHubState>((set, get) => ({
  status: 'loading',
  progress: 'Starting',
  channels: [],
  byId: new Map(),
  favorites: readJSON<string[]>('favorites', []),
  recents: readJSON<string[]>('recents', []),
  lastChannelId: readJSON<string | undefined>('lastChannel', undefined),
  health: readJSON<Record<string, StreamHealth>>('health', {}),

  async load(force = false) {
    if (!get().channels.length) set({ status: 'loading', error: undefined });
    try {
      const { catalog } = await getCatalog({
        store: fileBlobStore,
        force,
        load: () =>
          loadCatalog({ onProgress: (d, t) => set({ progress: `Tuning in ${d}/${t}` }) }),
        onBackgroundUpdate: (c) => set(prepare(c.channels, get().health)),
      });
      set({ status: 'ready', ...prepare(catalog.channels, get().health) });
    } catch (e) {
      if (!get().channels.length) set({ status: 'error', error: (e as Error).message });
    }
  },

  toggleFavorite(id) {
    const fav = get().favorites;
    const next = fav.includes(id) ? fav.filter((f) => f !== id) : [id, ...fav];
    set({ favorites: next });
    writeJSON('favorites', next);
  },

  markWatched(id) {
    const recents = pushRecent(get().recents, id);
    set({ recents, lastChannelId: id });
    writeJSON('recents', recents);
    writeJSON('lastChannel', id);
  },

  reportStream(url, ok) {
    const health = recordResult(get().health, url, ok);
    set({ health });
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => writeJSON('health', get().health), 2000);
  },
}));

export const deviceKind = device.kind;
