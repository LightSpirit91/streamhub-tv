import { create } from 'zustand';
import type { Channel, StreamHealth } from '../core/types';
import type { Movie, MovieCatalog } from '../core/movies/types';
import { getCatalog, readCachedCatalog } from '../core/catalog/cache';
import { loadCatalog, fetchText } from '../core/catalog/loader';
import { applyHealth, withoutBanned } from '../core/catalog/buildCatalog';
import { channelsForDevice } from '../core/platform/compat';
import { pushRecent, recordResult } from '../core/health/failover';
import { STREAMHUB_EPG_URL, STREAMHUB_MOVIES_URL, STREAMHUB_SHOWS_URL, STREAMHUB_UPCOMING_URL } from '../core/catalog/sources';
import type { UpcomingMovie } from '../core/movies/upcoming';
import type { Show, ShowCatalog } from '../core/shows/types';
import type { Guide, Programme } from '../core/epg/xmltv';
import { isWatchable, stripEmoji } from '../core/movies/archive';
import { genresFromTmdb } from '../core/movies/youtube';
import { currentFreeLinks } from '../core/meta/tmdb';
import { detectDevice } from '../services/device';
import { fileBlobStore, readJSON, writeJSON } from '../services/storage';

const device = detectDevice();

export type ProfileId = string;
export type { Profile } from './profiles';

/** Everything saved per profile lives under p:<profile>:<key>. */
const pk = (p: ProfileId, k: string) => `p:${p}:${k}`;

interface ProfileData {
  favorites: string[];
  recents: string[];
  lastChannelId?: string;
  movieList: string[];
  movieProgress: Record<string, number>;
  reminders: Reminder[];
}

/** A programme in the TV guide this profile asked to be reminded about. */
export interface Reminder {
  channelId: string;
  start: number;
  end: number;
  title: string;
}

function loadProfile(p: ProfileId): ProfileData {
  return {
    favorites: readJSON<string[]>(pk(p, 'favorites'), []),
    recents: readJSON<string[]>(pk(p, 'recents'), []),
    lastChannelId: readJSON<string | undefined>(pk(p, 'lastChannel'), undefined),
    movieList: readJSON<string[]>(pk(p, 'movieList'), []),
    movieProgress: readJSON<Record<string, number>>(pk(p, 'movieProgress'), {}),
    reminders: readJSON<Reminder[]>(pk(p, 'reminders'), []).filter((r) => r.end * 1000 > Date.now()),
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
  shows: Show[];
  showById: Map<string, Show>;
  upcoming: UpcomingMovie[];
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
  toggleReminder(r: Reminder): void;
  /** Wipes a deleted profile's saved data. */
  forgetProfile(id: string): void;
}

function prepare(channels: Channel[], health: Record<string, StreamHealth>) {
  const list = applyHealth(channelsForDevice(withoutBanned(channels), device), health);
  return { channels: list, byId: new Map(list.map((c) => [c.id, c])) };
}

const MOVIES_KEY = 'movies.v1.json';
const DAY = 86_400_000;

/** Second line of defense: the same content filter the nightly job uses. */
const clean = (list: Movie[]) =>
  list
    // Nothing from YouTube is offered.
    .filter((m) => m.source !== 'youtube' && isWatchable({ title: m.title, description: m.description }))
    // Free-elsewhere titles: links rebuilt with today's rules (paid / blocked services dropped).
    .map((m) => (m.source === 'free' ? { ...m, freeOn: currentFreeLinks(m) } : m))
    .filter((m) => m.source !== 'free' || m.freeOn?.length)
    .map((m) => ({
      ...m,
      title: stripEmoji(m.title),
      genres: genresFromTmdb(m.tmdbGenres) ?? m.genres,
    }));

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

/** Nothing from YouTube is offered. */
const cleanShows = (list: Show[]) =>
  list
    .filter((x) => x.source !== 'youtube' && isWatchable({ title: x.title, description: x.description }))
    .map((x) => (x.source === 'free' ? { ...x, freeOn: currentFreeLinks(x) } : x))
    .filter((x) => x.source !== 'free' || x.freeOn?.length)
    .map((x) => ({ ...x, title: stripEmoji(x.title), episodes: x.episodes.map((e) => ({ ...e, title: stripEmoji(e.title) })) }));

async function loadShows(force: boolean): Promise<Show[]> {
  const KEY = 'shows.v1.json';
  try {
    if (!force) {
      const raw = await fileBlobStore.read(KEY);
      if (raw) {
        const c = JSON.parse(raw) as ShowCatalog & { savedAt: number };
        if (Date.now() - c.savedAt < DAY) return cleanShows(c.shows);
      }
    }
    const c = JSON.parse(await fetchText(STREAMHUB_SHOWS_URL, globalThis.fetch as never, 30_000)) as ShowCatalog;
    await fileBlobStore.write(KEY, JSON.stringify({ ...c, savedAt: Date.now() }));
    return cleanShows(c.shows);
  } catch {
    const raw = await fileBlobStore.read(KEY).catch(() => null);
    return raw ? cleanShows((JSON.parse(raw) as ShowCatalog).shows) : [];
  }
}

let healthTimer: ReturnType<typeof setTimeout> | undefined;
const empty: ProfileData = { favorites: [], recents: [], movieList: [], movieProgress: {}, reminders: [] };

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
  shows: [],
  showById: new Map(),
  upcoming: [],
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
    loadShows(force).then((shows) => set({ shows, showById: new Map(shows.map((x) => [x.id, x])) }));
    fetchText(STREAMHUB_UPCOMING_URL, globalThis.fetch as never, 30_000)
      .then((t) => {
        const today = new Date().toISOString().slice(0, 10);
        set({ upcoming: (JSON.parse(t) as { movies: UpcomingMovie[] }).movies.filter((m) => m.releaseDate >= today) });
      })
      .catch(() => {});
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

  toggleReminder(r) {
    const { profile, reminders } = get();
    if (!profile) return;
    const key = (x: Reminder) => `${x.channelId}:${x.start}`;
    const next = reminders.some((x) => key(x) === key(r)) ? reminders.filter((x) => key(x) !== key(r)) : [...reminders, r].sort((a, b) => a.start - b.start);
    set({ reminders: next });
    writeJSON(pk(profile, 'reminders'), next);
  },

  forgetProfile(id) {
    for (const k of ['favorites', 'recents', 'lastChannel', 'movieList', 'movieProgress', 'reminders']) writeJSON(pk(id, k), null);
    if (get().profile === id) set({ profile: null, ...empty });
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
