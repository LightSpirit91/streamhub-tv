import { create } from 'zustand';
import type { Channel, StreamHealth } from '../core/types';
import type { Movie, MovieCatalog } from '../core/movies/types';
import { getCatalog, readCachedCatalog } from '../core/catalog/cache';
import { loadCatalog, fetchText } from '../core/catalog/loader';
import { applyHealth } from '../core/catalog/buildCatalog';
import { channelsForDevice } from '../core/platform/compat';
import { pushRecent, recordResult } from '../core/health/failover';
import { STREAMHUB_EPG_URL, STREAMHUB_MOVIES_URL } from '../core/catalog/sources';
import type { Guide, Programme } from '../core/epg/xmltv';
import { isWatchable } from '../core/movies/archive';
import { detectDevice } from '../services/device';
import { fileBlobStore, readJSON, writeJSON } from '../services/storage';

const device = detectDevice();

export type ProfileId = 'arkadi' | 'mylove';

export interface Profile {
  id: ProfileId;
  name: string;
  /** Avatar gradient. */
  colors: [string, string];
}

export const PROFILES: Profile[] = [
  { id: 'arkadi', name: 'Arkadi', colors: ['#F2C14E', '#B9641A'] },
  { id: 'mylove', name: 'My Love', colors: ['#FF6B9A', '#7B3FE4'] },
];

/** Everything saved per profile lives under p:<profile>:<key>. */
const pk = (p: ProfileId, k: string) => `p:${p}:${k}`;

interface ProfileData {
  favorites: string[];
  recents: string[];
  lastChannelId?: string;
  movieList: string[];
  movieProgress: Record<string, number>;
}

function loadProfile(p: ProfileId): ProfileData {
  return {
    favorites: readJSON<string[]>(pk(p, 'favorites'), []),
    recents: readJSON<string[]>(pk(p, 'recents'), []),
    lastChannelId: readJSON<string | undefined>(pk(p, 'lastChannel'), undefined),
    movieList: readJSON<string[]>(pk(p, 'movieList'), []),
    movieProgress: readJSON<Record<string, number>>(pk(p, 'movieProgress'), {}),
  };
}

interface StreamHubState extends ProfileData {
  profile: ProfileId | null;
  status: 'loading' | 'ready' | 'error';
  progress: string;
  error?: string;
  channels: Channel[];
  byId: Map<string, Channel>;
  movies: Movie[];
  movieById: Map<string, Movie>;
  /** TV guide: channel id -> programmes [start, end, title, desc?, category?] */
  epg: Record<string, Programme[]>;
  loadEpg(): Promise<void>;
  health: Record<string, StreamHealth>;
  selectProfile(p: ProfileId): void;
  signOut(): void;
  load(force?: boolean): Promise<void>;
  toggleFavorite(id: string): void;
  markWatched(id: string): void;
  reportStream(url: string, ok: boolean): void;
  toggleMovie(id: string): void;
  saveMovieProgress(id: string, seconds: number): void;
}

function prepare(channels: Channel[], health: Record<string, StreamHealth>) {
  const list = applyHealth(channelsForDevice(channels, device), health);
  return { channels: list, byId: new Map(list.map((c) => [c.id, c])) };
}

const MOVIES_KEY = 'movies.v1.json';
const DAY = 86_400_000;

/** Second line of defense: the same content filter the nightly job uses. */
const clean = (list: Movie[]) => list.filter((m) => isWatchable({ title: m.title, description: m.description }));

async function loadMovies(force: boolean): Promise<Movie[]> {
  return clean(await loadMoviesRaw(force));
}

async function loadMoviesRaw(force: boolean): Promise<Movie[]> {
  try {
    if (!force) {
      const raw = await fileBlobStore.read(MOVIES_KEY);
      if (raw) {
        const c = JSON.parse(raw) as MovieCatalog & { savedAt: number };
        if (Date.now() - c.savedAt < DAY) return c.movies;
      }
    }
    const text = await fetchText(STREAMHUB_MOVIES_URL, globalThis.fetch as never, 30_000);
    const c = JSON.parse(text) as MovieCatalog;
    await fileBlobStore.write(MOVIES_KEY, JSON.stringify({ ...c, savedAt: Date.now() }));
    return c.movies;
  } catch {
    const raw = await fileBlobStore.read(MOVIES_KEY).catch(() => null);
    return raw ? (JSON.parse(raw) as MovieCatalog).movies : [];
  }
}

let healthTimer: ReturnType<typeof setTimeout> | undefined;
const empty: ProfileData = { favorites: [], recents: [], movieList: [], movieProgress: {} };

export const useStreamHub = create<StreamHubState>((set, get) => ({
  profile: null,
  ...empty,
  status: 'loading',
  progress: 'Starting',
  channels: [],
  byId: new Map(),
  movies: [],
  movieById: new Map(),
  epg: {},
  health: readJSON<Record<string, StreamHealth>>('health', {}),

  selectProfile(p) {
    writeJSON('lastProfile', p);
    set({ profile: p, ...loadProfile(p) });
  },

  signOut() {
    set({ profile: null, ...empty });
  },

  async loadEpg() {
    const KEY = 'epg.v1.json';
    try {
      const raw = await fileBlobStore.read(KEY);
      if (raw) {
        const g = JSON.parse(raw) as Guide & { savedAt: number };
        set({ epg: g.programs });
        if (Date.now() - g.savedAt < 3 * 3_600_000) return;
      }
      const text = await fetchText(STREAMHUB_EPG_URL, globalThis.fetch as never, 30_000);
      const g = JSON.parse(text) as Guide;
      set({ epg: g.programs });
      await fileBlobStore.write(KEY, JSON.stringify({ ...g, savedAt: Date.now() }));
    } catch {
      // no guide yet: the app works without it
    }
  },

  async load(force = false) {
    if (!get().channels.length) set({ status: 'loading', error: undefined });
    get().loadEpg();
    loadMovies(force).then((movies) => set({ movies, movieById: new Map(movies.map((m) => [m.id, m])) }));
    try {
      const { catalog } = await getCatalog({
        store: fileBlobStore,
        force,
        load: () => loadCatalog({ onProgress: (d, t) => set({ progress: `Tuning in ${d}/${t}` }) }),
        onBackgroundUpdate: (c) => set(prepare(c.channels, get().health)),
      });
      set({ status: 'ready', ...prepare(catalog.channels, get().health) });
    } catch (e) {
      const cached = await readCachedCatalog(fileBlobStore);
      if (cached) set({ status: 'ready', ...prepare(cached.catalog.channels, get().health) });
      else if (!get().channels.length) set({ status: 'error', error: (e as Error).message });
    }
  },

  toggleFavorite(id) {
    const { profile, favorites } = get();
    if (!profile) return;
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [id, ...favorites];
    set({ favorites: next });
    writeJSON(pk(profile, 'favorites'), next);
  },

  markWatched(id) {
    const { profile } = get();
    if (!profile) return;
    const recents = pushRecent(get().recents, id);
    set({ recents, lastChannelId: id });
    writeJSON(pk(profile, 'recents'), recents);
    writeJSON(pk(profile, 'lastChannel'), id);
  },

  reportStream(url, ok) {
    const health = recordResult(get().health, url, ok);
    set({ health });
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => writeJSON('health', get().health), 2000);
  },

  toggleMovie(id) {
    const { profile, movieList } = get();
    if (!profile) return;
    const next = movieList.includes(id) ? movieList.filter((m) => m !== id) : [id, ...movieList];
    set({ movieList: next });
    writeJSON(pk(profile, 'movieList'), next);
  },

  saveMovieProgress(id, seconds) {
    const { profile } = get();
    if (!profile) return;
    const movieProgress = { ...get().movieProgress, [id]: Math.floor(seconds) };
    set({ movieProgress });
    writeJSON(pk(profile, 'movieProgress'), movieProgress);
  },
}));

export const deviceKind = device.kind;
