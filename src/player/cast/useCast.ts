import { Platform } from 'react-native';
import { create } from 'zustand';
import type { CastMedia, CastStore } from './useCast.web';

/**
 * Native apps: the Fire TV app already runs on the TV; the iPhone/iPad/Mac
 * app uses the AirPlay button (expo-video). Chromecast is a web feature for
 * now; Android phones can use Android's own "Cast screen".
 */
export type { CastMedia, CastStore };
export const useCastStore = create<CastStore>(() => ({ available: false, paused: false, currentTime: 0, duration: 0, volume: 1, muted: false }));
export const useCast = () => useCastStore();
export function initCast() {}
export async function connectCast(): Promise<boolean> {
  return false;
}
export async function castMedia(_m: CastMedia): Promise<void> {}
export function stopCasting() {}
export const remote = { playPause() {}, seek(_t: number) {}, volume(_v: number) {}, mute() {} };
export const airPlaySupported = () => Platform.OS === 'ios';
