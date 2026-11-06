import { Platform } from 'react-native';
import type { DeviceEnv } from '../core/platform/compat';

/** Detects what this device can play. Called once at startup. */
export function detectDevice(): DeviceEnv {
  if (Platform.OS === 'ios') return { kind: 'ios' };
  if (Platform.OS === 'android') return { kind: Platform.isTV ? 'android-tv' : 'android' };

  const w = globalThis as unknown as {
    isSecureContext?: boolean;
    MediaSource?: unknown;
    ManagedMediaSource?: unknown;
    document?: { createElement(tag: 'video'): { canPlayType(t: string): string } };
  };
  const video = w.document?.createElement('video');
  return {
    kind: 'web',
    secureContext: w.isSecureContext ?? true,
    nativeHls: !!video?.canPlayType('application/vnd.apple.mpegurl'),
    mse: !!(w.MediaSource || w.ManagedMediaSource),
  };
}

/** How the screen is used, which drives layout density and input. */
export type FormFactor = 'tv' | 'desktop' | 'tablet' | 'phone';

export function formFactor(width: number): FormFactor {
  if (Platform.isTV) return 'tv';
  if (Platform.OS === 'web') return width >= 1024 ? 'desktop' : width >= 600 ? 'tablet' : 'phone';
  return width >= 600 ? 'tablet' : 'phone';
}
