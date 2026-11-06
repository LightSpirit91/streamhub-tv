import { create } from 'zustand';
import type { Channel } from '../core/types';

/** App-wide overlays any screen can open. */
interface UiState {
  /** Channel whose full week schedule is open. */
  schedule: Channel | null;
  openSchedule(c: Channel): void;
  closeSchedule(): void;
}

export const useUi = create<UiState>((set) => ({
  schedule: null,
  openSchedule: (c) => set({ schedule: c }),
  closeSchedule: () => set({ schedule: null }),
}));

/** True while an overlay owns the keyboard / remote (screens underneath ignore keys). */
export const overlayOpen = () => !!useUi.getState().schedule;
