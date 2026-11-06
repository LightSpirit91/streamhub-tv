import { describe, expect, it } from 'vitest';
import { canPlay, channelsForDevice } from '../platform/compat';
import type { Channel, Stream } from '../types';

const s = (url: string, extra: Partial<Stream> = {}): Stream => ({
  url, height: 720, geoBlocked: false, notAlwaysOn: false, trust: 'public',
  format: 'hls', source: 't', score: 50, ...extra,
});

const ch = (id: string, streams: Stream[]): Channel => ({
  id, name: id, categories: [], hubs: [], streams, popularity: 0, bestHeight: 720, search: id,
});

describe('canPlay', () => {
  const dash = s('https://a/manifest.mpd', { format: 'dash' });
  const http = s('http://1.2.3.4/live.m3u8');
  const headers = s('https://a/live.m3u8', { headers: { Referer: 'https://x' } });
  const ok = s('https://a/live.m3u8');

  it('Android and Fire TV play everything', () => {
    for (const x of [dash, http, headers, ok]) expect(canPlay(x, { kind: 'android-tv' })).toBe(true);
  });

  it('iPhone and Mac app skip DASH only', () => {
    expect(canPlay(dash, { kind: 'ios' })).toBe(false);
    expect(canPlay(http, { kind: 'ios' })).toBe(true);
    expect(canPlay(headers, { kind: 'ios' })).toBe(true);
  });

  it('browsers skip DASH, header-locked and (on https pages) http streams', () => {
    const safari = { kind: 'web' as const, secureContext: true, nativeHls: true, mse: true };
    expect(canPlay(ok, safari)).toBe(true);
    expect(canPlay(dash, safari)).toBe(false);
    expect(canPlay(headers, safari)).toBe(false);
    expect(canPlay(http, safari)).toBe(false);
    expect(canPlay(http, { ...safari, secureContext: false })).toBe(true);
    expect(canPlay(ok, { kind: 'web', secureContext: true, nativeHls: false, mse: false })).toBe(false);
  });
});

describe('channelsForDevice', () => {
  it('trims failover chains and drops channels with nothing playable', () => {
    const channels = [
      ch('mixed', [s('https://a/m.mpd', { format: 'dash' }), s('https://a/m.m3u8')]),
      ch('dashOnly', [s('https://b/m.mpd', { format: 'dash' })]),
    ];
    const ios = channelsForDevice(channels, { kind: 'ios' });
    expect(ios.map((c) => c.id)).toEqual(['mixed']);
    expect(ios[0].streams).toHaveLength(1);
    expect(channelsForDevice(channels, { kind: 'android' })).toBe(channels);
  });
});
