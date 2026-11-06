import { create } from 'zustand';
import { readJSON, writeJSON } from '../services/storage';

/** Avatar artwork: a lucide icon on a warm gradient. */
export const AVATAR_ICONS = ['heart', 'star', 'sparkles', 'sun', 'moon', 'flower', 'crown', 'leaf', 'music', 'coffee', 'rocket', 'cat', 'dog', 'gamepad', 'film', 'mountain'] as const;
export type AvatarIcon = (typeof AVATAR_ICONS)[number];

export const AVATAR_PALETTES: [string, string][] = [
  ['#F6C26B', '#D9773A'], // honey
  ['#FF8FA3', '#B5487F'], // rose
  ['#F4A27B', '#C2504B'], // terracotta
  ['#9AD0A5', '#3E8E7E'], // sage
  ['#8EC5E8', '#4C6FBF'], // sky
  ['#C9A7F2', '#7A55C4'], // lavender
  ['#F7D58B', '#9C7C38'], // sand
  ['#E8A0BF', '#8E5A9C'], // orchid
];

export interface Profile {
  id: string;
  name: string;
  icon: AvatarIcon;
  palette: number;
  /** Shown as a letter when no icon is chosen. */
  letter?: boolean;
}

const DEFAULTS: Profile[] = [
  { id: 'arkadi', name: 'Arkadi', icon: 'crown', palette: 0 },
  { id: 'mylove', name: 'My Love', icon: 'heart', palette: 1 },
];

interface ProfilesState {
  profiles: Profile[];
  add(p: Omit<Profile, 'id'>): Profile;
  update(id: string, patch: Partial<Omit<Profile, 'id'>>): void;
  remove(id: string): void;
}

const save = (profiles: Profile[]) => writeJSON('profiles.v2', profiles);

export const useProfiles = create<ProfilesState>((set, get) => ({
  profiles: readJSON<Profile[]>('profiles.v2', DEFAULTS),
  add(p) {
    const base = p.name.trim().toLowerCase().replace(/[^a-z0-9֐-׿Ѐ-ӿ]+/g, '-').replace(/^-|-$/g, '') || 'profile';
    let id = base;
    for (let i = 2; get().profiles.some((x) => x.id === id); i++) id = `${base}-${i}`;
    const profile = { ...p, name: p.name.trim() || 'Guest', id };
    const profiles = [...get().profiles, profile];
    set({ profiles });
    save(profiles);
    return profile;
  },
  update(id, patch) {
    const profiles = get().profiles.map((x) => (x.id === id ? { ...x, ...patch, name: (patch.name ?? x.name).trim() || x.name } : x));
    set({ profiles });
    save(profiles);
  },
  remove(id) {
    if (get().profiles.length <= 1) return;
    const profiles = get().profiles.filter((x) => x.id !== id);
    set({ profiles });
    save(profiles);
  },
}));

export const MAX_PROFILES = 8;
