import { create } from 'zustand';
import type { Channel } from '../core/types';

/** App-wide overlays any screen can open. */
interface UiState {
  /** Channel whose full week schedule is open. */
  schedule: Channel | null;
  openSchedule(c: Channel): void;
  closeSchedule(): void;
  /** Channel sources panel. */
  sources: boolean;
  setSources(open: boolean): void;
  /** Text handed from the top search box to the Search page. */
  /** The top search box's suggestion list is showing (lifts the top bar above the page). */
  searchOpen: boolean;
  setSearchOpen(open: boolean): void;
  searchQuery: string;
  setSearchQuery(q: string): void;
}

export const useUi = create<UiState>((set) => ({
  schedule: null,
  openSchedule: (c) => set({ schedule: c }),
  closeSchedule: () => set({ schedule: null }),
  sources: false,
  setSources: (open) => set({ sources: open }),
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
}));

/** True while an overlay owns the keyboard / remote (screens underneath ignore keys). */
export const overlayOpen = () => !!useUi.getState().schedule || useUi.getState().sources;
