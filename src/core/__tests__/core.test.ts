import { describe, expect, it } from 'vitest';
import { parseM3U } from '../m3u/parseM3U';
import { buildCatalog, applyHealth } from '../catalog/buildCatalog';
import { parseName, trustOf, countryFromTvgId } from '../catalog/normalize';
import { classify } from '../catalog/hubs';
import { getCatalog, type BlobStore } from '../catalog/cache';
import { searchChannels } from '../search/search';
import { FailoverController, recordResult, zap, pushRecent } from '../health/failover';

// Lines copied from the real iptv-org and Free-TV feeds (2026-11-06).
const IPTV_ORG = `﻿#EXTM3U x-tvg-url="https://example.com/guide.xml"\r
#EXTINF:-1 tvg-id="Kan11.il@SD" tvg-logo="https://i.imgur.com/kan.png" group-title="General",Kan 11 (1080p)\r
https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8\r
#EXTINF:-1 tvg-id="Keshet12.il@SD",Keshet 12 (1080p)
#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)
#EXTVLCOPT:http-referrer=https://www.mako.co.il/
https://mako-streaming.akamaized.net/direct/hls/live/2033791/k12/index.m3u8
#EXTINF:-1 tvg-id="Russia1.ru@HD",Russia-1 HD (1080p)
http://176.118.197.101/RossiyaHD/index.m3u8
#EXTINF:-1 tvg-id="Russia1.ru@HD",Russia-1 HD (1080p)
https://live.smotrim.ru/vgtrk/0/russia1-hd/index.m3u8
#EXTINF:-1 tvg-id="",UFC (720p)
https://jmp2.uk/plu-69a20556814d27f4ae630a92.m3u8
#EXTINF:-1 tvg-id="LoveNature.ca@4K" group-title="Documentary;Outdoor",Love Nature 4K (2160p) [Geo-blocked]
https://love-nature.example.com/4k/master.m3u8
#EXTINF:-1 tvg-id="NFLChannel.us@SD" group-title="Sports",NFL Channel (720p)
https://jmp2.uk/plu-5ced7d5df64be98e07ed47b6.m3u8
#EXTINF:-1 tvg-id="Hidden.us" group-title="XXX",Hidden
https://adult.example.com/x.m3u8
#EXTINF:-1 tvg-id="Broken.us",No URL follows
#EXTINF:-1 tvg-id="CBSNews247.us@SD" group-title="News",CBS News 24/7 (720p)
https://jmp2.uk/plu-6350fdd266e9ea0007bedec5.m3u8
`;

const FREE_TV = `#EXTM3U
#EXTINF:-1 tvg-name="Kan 11" tvg-logo="https://i.imgur.com/k11.png" tvg-id="Kan11.il" tvg-country="IL" group-title="Israel",Kan 11 Ⓖ
https://kan11.media.kan.org.il/hls/live/2024514/2024514/master.m3u8
#EXTINF:-1 tvg-name="Twitch" tvg-id="X.al" tvg-country="AL" group-title="Albania",ABC News Albania Ⓣ
https://www.twitch.tv/abcnewsal
#EXTINF:-1 tvg-name="Canal, Uno" tvg-id="CanalUno.mx" tvg-country="MX" group-title="Mexico",Canal, Uno
https://canal-uno.example.mx/live.m3u8
`;

const FILTER = new Set(['US', 'CA', 'IL', 'RU', 'MX', 'INT']);

describe('parseM3U', () => {
  const entries = parseM3U(IPTV_ORG);

  it('parses entries, BOM, CRLF and skips entries without URLs', () => {
    expect(entries.map((e) => e.name)).toContain('Kan 11 (1080p)');
    expect(entries.find((e) => e.name === 'No URL follows')).toBeUndefined();
    expect(entries).toHaveLength(9);
  });

  it('reads attributes and EXTVLCOPT headers', () => {
    const kan = entries[0];
    expect(kan.tvgId).toBe('Kan11.il@SD');
    expect(kan.logo).toBe('https://i.imgur.com/kan.png');
    expect(kan.groups).toEqual(['General']);
    const keshet = entries[1];
    expect(keshet.userAgent).toMatch(/^Mozilla/);
    expect(keshet.referrer).toBe('https://www.mako.co.il/');
  });

  it('splits multi-category group-title and keeps commas inside quotes', () => {
    expect(entries.find((e) => e.tvgId === 'LoveNature.ca@4K')?.groups).toEqual(['Documentary', 'Outdoor']);
    const free = parseM3U(FREE_TV);
    expect(free.find((e) => e.tvgId === 'CanalUno.mx')?.name).toBe('Canal, Uno');
    expect(free[0].country).toBe('IL');
  });

  it('handles 20k entries quickly', () => {
    const block = '#EXTINF:-1 tvg-id="A.us" group-title="News",A (720p)\nhttps://a.example.com/a.m3u8\n';
    const big = '#EXTM3U\n' + block.repeat(20_000);
    const t = Date.now();
    expect(parseM3U(big)).toHaveLength(20_000);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe('normalize', () => {
  it('parses quality and flags', () => {
    expect(parseName('Love Nature 4K (2160p) [Geo-blocked]')).toEqual({
      clean: 'Love Nature 4K', height: 2160, geoBlocked: true, notAlwaysOn: false,
    });
    expect(parseName('Hala TV (1080p) [Not 24/7]').notAlwaysOn).toBe(true);
    expect(parseName('Kan 11 Ⓖ')).toMatchObject({ clean: 'Kan 11', geoBlocked: true });
  });

  it('rates trust', () => {
    expect(trustOf('https://jmp2.uk/plu-1.m3u8', 'x')).toBe('official');
    expect(trustOf('https://live.smotrim.ru/a.m3u8', 'x')).toBe('official');
    expect(trustOf('http://176.118.197.101/a.m3u8', 'x')).toBe('unverified');
    expect(trustOf('https://cdn.example.com/a.m3u8', 'x')).toBe('public');
  });

  it('reads country from tvg-id', () => {
    expect(countryFromTvgId('Kan11.il@SD')).toBe('IL');
    expect(countryFromTvgId('BBCOne.uk')).toBe('UK');
    expect(countryFromTvgId(undefined)).toBeUndefined();
  });
});

describe('buildCatalog', () => {
  const catalog = buildCatalog([
    { source: { id: 'iptv-org:country:mix' }, entries: parseM3U(IPTV_ORG) },
    { source: { id: 'free-tv', countryFilter: FILTER }, entries: parseM3U(FREE_TV) },
  ]);
  const byId = Object.fromEntries(catalog.channels.map((c) => [c.id, c]));

  it('dedupes the same channel across sources into one failover chain', () => {
    const kan = byId['kan11.il'];
    expect(kan.streams).toHaveLength(2);
    // iptv-org 1080p official stream outranks the geo-blocked Free-TV one
    expect(kan.streams[0].url).toContain('medonecdn');
    expect(kan.hubs).toContain('israel');
  });

  it('ranks the official https stream above an http raw-IP mirror', () => {
    const r1 = byId['russia1.ru'];
    expect(r1.streams[0].url).toContain('smotrim.ru');
    expect(r1.hubs).toContain('russian');
  });

  it('drops adult categories, non-HLS pages and filtered countries', () => {
    expect(byId['hidden.us']).toBeUndefined();
    expect(catalog.channels.find((c) => c.name.includes('Albania'))).toBeUndefined();
    expect(byId['canaluno.mx']?.hubs).toContain('latin');
  });

  it('puts UFC in Fight Night and Sports, Love Nature in Wild Planet', () => {
    const ufc = catalog.channels.find((c) => c.name === 'UFC')!;
    expect(ufc.hubs).toEqual(expect.arrayContaining(['fight', 'sports']));
    expect(byId['lovenature.ca'].hubs).toContain('wildlife');
    expect(byId['lovenature.ca'].bestHeight).toBe(2160);
  });

  it('hides channels whose every stream failed 3+ times', () => {
    const ufc = catalog.channels.find((c) => c.name === 'UFC')!;
    const health = { [ufc.streams[0].url]: { consecutiveFails: 3 } };
    const visible = applyHealth(catalog.channels, health);
    expect(visible.find((c) => c.id === ufc.id)).toBeUndefined();
    expect(visible.length).toBe(catalog.channels.length - 1);
  });
});

describe('country fallback', () => {
  it('labels channels without tvg-id by the country file they came from', () => {
    const c = buildCatalog([{
      source: { id: 'iptv-org:raw:ca_pluto' },
      entries: parseM3U('#EXTINF:-1 tvg-id="",UFC (720p)\nhttps://jmp2.uk/plu-1.m3u8\n#EXTINF:-1 tvg-id="CBSNews247.us@SD",CBS News 24/7\nhttps://jmp2.uk/plu-2.m3u8\n'),
    }]);
    expect(c.channels.find((x) => x.name === 'UFC')?.country).toBe('CA');
    expect(c.channels.find((x) => x.name === 'CBS News 24/7')?.country).toBe('US');
  });
});

describe('language feeds', () => {
  it('routes Russian-language channels from other countries into Russian TV', () => {
    const c = buildCatalog([{
      source: { id: 'iptv-org:language:rus', tag: 'lang:rus' },
      entries: parseM3U('#EXTINF:-1 tvg-id="Inter.ua",Inter (576p)\nhttps://a.example.com/inter.m3u8\n'),
    }]);
    expect(c.channels[0].hubs).toContain('russian');
    expect(c.channels[0].country).toBe('UA');
  });
});

describe('classify', () => {
  it('maps Spanish-language US channels into Latin', () => {
    expect(classify({ name: 'Fox Deportes', country: 'US', categories: [] })).toEqual(
      expect.arrayContaining(['usa', 'latin', 'sports']),
    );
  });
  it('puts Israeli Channel 9 in Russian too', () => {
    expect(classify({ name: 'Channel 9', country: 'IL', categories: [] })).toEqual(
      expect.arrayContaining(['israel', 'russian']),
    );
  });
});

describe('search', () => {
  const catalog = buildCatalog([{ source: { id: 's' }, entries: parseM3U(IPTV_ORG) }]);
  it('finds by name, country word, genre and Hebrew alias', () => {
    expect(searchChannels(catalog.channels, 'kan')[0].name).toBe('Kan 11');
    expect(searchChannels(catalog.channels, 'israel').map((c) => c.name)).toContain('Keshet 12');
    expect(searchChannels(catalog.channels, 'mma').map((c) => c.name)).toContain('UFC');
    expect(searchChannels(catalog.channels, 'קשת').map((c) => c.name)).toContain('Keshet 12');
  });
});

describe('cache', () => {
  const mem = (): BlobStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      read: async (k) => data.get(k) ?? null,
      write: async (k, v) => void data.set(k, v),
      remove: async (k) => void data.delete(k),
    };
  };
  const cat = (n: number) => ({ version: 1, builtAt: n, sources: [], channels: [] });

  it('serves fresh cache without network, stale cache with background refresh', async () => {
    const store = mem();
    let calls = 0;
    const load = async () => (calls++, cat(calls));
    const t0 = 1_000_000;
    expect((await getCatalog({ store, load, now: t0 })).from).toBe('network');
    expect((await getCatalog({ store, load, now: t0 + 1000 })).from).toBe('cache');
    expect(calls).toBe(1);

    let updated = false;
    const res = await getCatalog({ store, load, now: Date.now() + 2 * 86_400_000, onBackgroundUpdate: () => (updated = true) });
    expect(res.from).toBe('cache');
    await new Promise((r) => setTimeout(r, 10));
    expect(updated).toBe(true);
  });

  it('pull-to-refresh falls back to disk when offline', async () => {
    const store = mem();
    await getCatalog({ store, load: async () => cat(1) });
    const res = await getCatalog({ store, force: true, load: async () => { throw new Error('offline'); } });
    expect(res.from).toBe('cache');
  });
});

describe('failover', () => {
  const catalog = buildCatalog([{ source: { id: 's' }, entries: parseM3U(IPTV_ORG) }]);
  const r1 = catalog.channels.find((c) => c.id === 'russia1.ru')!;

  it('retries twice, then switches stream, then goes offline and loops', () => {
    const f = new FailoverController(r1.streams);
    expect(f.onError()).toMatchObject({ kind: 'retrying', attempt: 1 });
    expect(f.onError()).toMatchObject({ kind: 'retrying', attempt: 2 });
    expect(f.onError()).toEqual({ kind: 'switching', from: 0, to: 1 });
    f.onError();
    f.onError();
    expect(f.onError()).toMatchObject({ kind: 'offline' });
    expect(f.currentIndex).toBe(0);
  });

  it('tracks health, zaps with wrap-around, keeps 10 recents', () => {
    let h = recordResult({}, 'u', false);
    h = recordResult(h, 'u', false);
    expect(h.u.consecutiveFails).toBe(2);
    expect(recordResult(h, 'u', true).u.consecutiveFails).toBe(0);
    const list = catalog.channels;
    expect(zap(list, list[list.length - 1].id, 1)).toBe(list[0]);
    let rec: string[] = [];
    for (let i = 0; i < 15; i++) rec = pushRecent(rec, `c${i}`);
    rec = pushRecent(rec, 'c10');
    expect(rec).toHaveLength(10);
    expect(rec[0]).toBe('c10');
  });
});
