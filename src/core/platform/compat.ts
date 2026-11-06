import type { Channel, Stream } from '../types';

/**
 * Every device plays a different subset of streams. This filters each
 * channel's failover chain to what the current device can actually play,
 * so nobody sees a channel that is guaranteed to fail on their screen.
 *
 * | Device                     | HLS | DASH | http:// | custom headers |
 * |----------------------------|-----|------|---------|----------------|
 * | Fire TV / Android TV / phone | yes | yes | yes   | yes            |
 * | iPhone / iPad / Apple Silicon Mac app | yes | no | yes | yes  |
 * | Browser (any Mac or PC)    | yes*| no   | only on http pages | no |
 *
 * * Safari plays HLS natively. Chrome/Firefox/Edge play it through hls.js,
 *   which needs Media Source Extensions.
 */
export type DeviceKind = 'android' | 'android-tv' | 'ios' | 'web';

export interface DeviceEnv {
  kind: DeviceKind;
  /** web only: page served over https (blocks http:// media). */
  secureContext?: boolean;
  /** web only: <video> plays HLS by itself (Safari). */
  nativeHls?: boolean;
  /** web only: MediaSource or ManagedMediaSource exists (hls.js works). */
  mse?: boolean;
}

export function canPlay(s: Stream, env: DeviceEnv): boolean {
  switch (env.kind) {
    case 'android':
    case 'android-tv':
      return true;
    case 'ios':
      return s.format !== 'dash';
    case 'web':
      if (s.format === 'dash') return false;
      if (s.headers) return false; // browsers forbid setting User-Agent/Referer
      if (env.secureContext && s.url.startsWith('http://')) return false;
      if (s.format === 'hls') return !!(env.nativeHls || env.mse);
      return true;
  }
}

/** Returns channels with only playable streams; drops channels left empty. */
export function channelsForDevice(channels: Channel[], env: DeviceEnv): Channel[] {
  if (env.kind === 'android' || env.kind === 'android-tv') return channels;
  const out: Channel[] = [];
  for (const ch of channels) {
    const streams = ch.streams.filter((s) => canPlay(s, env));
    if (!streams.length) continue;
    out.push(streams.length === ch.streams.length ? ch : { ...ch, streams });
  }
  return out;
}
