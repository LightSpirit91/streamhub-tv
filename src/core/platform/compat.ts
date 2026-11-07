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
      if (s.format === 'youtube') return true;
      if (s.format === 'dash') return false;
      if (s.headers) return false; // browsers forbid setting User-Agent/Referer
      if (env.secureContext && s.url.startsWith('http://')) return false;
      if (s.format === 'hls') return !!(env.nativeHls || env.mse);
      return true;
  }
}

/** Web without native HLS (Chrome, Edge, Firefox): the stream's server must allow other websites. */
export const corsBlocked = (s: Stream, env: DeviceEnv) => env.kind === 'web' && !env.nativeHls && s.format === 'hls' && s.cors === false;

/**
 * Returns channels with only playable streams; drops channels left empty.
 * On Chrome / Edge / Firefox, streams whose server refuses other websites go
 * to the end of the list (backups that allow it play first). A channel with
 * only such streams stays listed: the player explains to open it in Safari.
 */
export function channelsForDevice(channels: Channel[], env: DeviceEnv): Channel[] {
  if (env.kind === 'android' || env.kind === 'android-tv') return channels;
  const out: Channel[] = [];
  for (const ch of channels) {
    let streams = ch.streams.filter((s) => canPlay(s, env));
    if (!streams.length) continue;
    // Lower their rank (the health ranking re-sorts by score later), so allowed backups play first.
    if (streams.some((s) => corsBlocked(s, env))) streams = streams.map((s) => (corsBlocked(s, env) ? { ...s, score: s.score - 200 } : s));
    out.push(streams.length === ch.streams.length && streams.every((s, i) => s === ch.streams[i]) ? ch : { ...ch, streams });
  }
  return out;
}
