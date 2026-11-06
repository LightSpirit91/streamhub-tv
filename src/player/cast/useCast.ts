import { Platform } from 'react-native';
import type { CastMedia, CastState } from './useCast.web';

/**
 * Native apps: the Fire TV app is already on the TV; the iPhone/iPad/Mac app
 * uses the AirPlay button (expo-video). Chromecast from the Android phone
 * app uses Android's own Cast screen for now.
 */
export type { CastMedia, CastState };
export function useCast(): CastState {
  return { available: false };
}
export async function castMedia(_m: CastMedia): Promise<void> {}
export function stopCasting() {}
export const airPlaySupported = () => Platform.OS === 'ios';
