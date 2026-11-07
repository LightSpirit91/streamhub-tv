import { describe, expect, it } from 'vitest';
import { looksLikeMedia, nextUri, validateStream, type GetBytes } from '../playback/validate';
import { isSafeUrl } from '../playback/safeUrl';
import { emptyHealth, recordLink, recordSource, restingLink, restingSources } from '../playback/health';
import { DEFAULT_SETTINGS, isDue, parseSettings } from '../refresh/settings';

const enc = (s: string) => new TextEncoder().encode(s);
const ts = () => {
  const b = new Uint8Array(376);
  b[0] = 0x47;
  b[188] = 0x47;
  return b;
};
const fmp4 = () => new Uint8Array([0, 0, 0, 24, ...enc('ftyp'), ...enc('isom')]);

function net(map: Record<string, { status?: number; type?: string; body: Uint8Array | string; to?: string }>): GetBytes {
  return async (url) => {
    const r = map[url];
    if (!r) return { status: 404, type: 'text/html', bytes: enc('<html>nope'), finalUrl: url };
    return { status: r.status ?? 200, type: r.type ?? '', bytes: typeof r.body === 'string' ? enc(r.body) : r.body, finalUrl: r.to ?? url };
  };
}

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nhigh/index.m3u8\n';
const MEDIA = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nseg2.ts\n';

describe('real playback check', () => {
  it('follows master -> variant -> segment and accepts real video bytes', async () => {
    const get = net({
      'https://cdn.example.com/live/master.m3u8': { body: MASTER },
      'https://cdn.example.com/live/low/index.m3u8': { body: MEDIA },
      'https://cdn.example.com/live/low/seg1.ts': { body: ts() },
    });
    const v = await validateStream('https://cdn.example.com/live/master.m3u8', get, { live: true });
    expect(v).toMatchObject({ ok: true, kind: 'hls', detail: 'mpeg-ts' });
  });

  it('accepts fragmented MP4 (init segment in EXT-X-MAP)', async () => {
    const get = net({
      'https://cdn.example.com/a.m3u8': { body: '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg.m4s\n' },
      'https://cdn.example.com/init.mp4': { body: fmp4() },
    });
    expect(await validateStream('https://cdn.example.com/a.m3u8', get)).toMatchObject({ ok: true });
  });

  it('rejects a playlist whose segment is an error page', async () => {
    const get = net({
      'https://cdn.example.com/a.m3u8': { body: MEDIA },
      'https://cdn.example.com/seg1.ts': { status: 200, type: 'text/html', body: '<!doctype html><title>Expired</title>' },
    });
    expect(await validateStream('https://cdn.example.com/a.m3u8', get)).toMatchObject({ ok: false, reason: 'html' });
  });

  it('rejects an HTML page answering 200 instead of a playlist', async () => {
    const get = net({ 'https://x.example.com/live.m3u8': { type: 'text/html', body: '<html><body>Watch here</body></html>' } });
    expect(await validateStream('https://x.example.com/live.m3u8', get)).toMatchObject({ ok: false, reason: 'html' });
  });

  it('rejects an ended live playlist and an empty one', async () => {
    const ended = net({ 'https://c.example.com/a.m3u8': { body: MEDIA + '#EXT-X-ENDLIST\n' } });
    expect(await validateStream('https://c.example.com/a.m3u8', ended, { live: true })).toMatchObject({ ok: false, reason: 'ended' });
    const empty = net({ 'https://c.example.com/a.m3u8': { body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n' } });
    expect(await validateStream('https://c.example.com/a.m3u8', empty)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('treats 403 as a geo-lock and 404 as an http failure', async () => {
    expect(await validateStream('https://c.example.com/a.m3u8', net({ 'https://c.example.com/a.m3u8': { status: 403, body: '' } }))).toMatchObject({ ok: false, reason: 'locked' });
    expect(await validateStream('https://c.example.com/a.m3u8', net({}))).toMatchObject({ ok: false, reason: 'http' });
  });

  it('never follows a playlist entry or redirect into a private network', async () => {
    const entry = net({ 'https://c.example.com/a.m3u8': { body: '#EXTM3U\n#EXTINF:6,\nhttp://192.168.1.1/seg.ts\n' } });
    expect(await validateStream('https://c.example.com/a.m3u8', entry)).toMatchObject({ ok: false, reason: 'unsafe' });
    const redirect = net({ 'https://c.example.com/a.m3u8': { body: MEDIA, to: 'http://169.254.169.254/latest/' } });
    expect(await validateStream('https://c.example.com/a.m3u8', redirect)).toMatchObject({ ok: false, reason: 'unsafe' });
    expect(await validateStream('http://localhost:8080/a.m3u8', net({}))).toMatchObject({ ok: false, reason: 'unsafe' });
  });

  it('recognises media bytes and resolves relative entries', () => {
    expect(looksLikeMedia(ts())).toBe('mpeg-ts');
    expect(looksLikeMedia(fmp4())).toMatch(/mp4/);
    expect(looksLikeMedia(enc('<html>'))).toBeUndefined();
    expect(nextUri(MASTER, 'https://a.com/x/m.m3u8')).toEqual({ kind: 'variant', uri: 'https://a.com/x/low/index.m3u8' });
  });
});

describe('safe addresses', () => {
  it('blocks private, loopback, link-local, metadata and credential URLs', () => {
    for (const u of ['http://127.0.0.1/', 'http://10.0.0.5/', 'http://172.20.1.1/', 'http://192.168.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://[fd00::1]/', 'http://localhost/', 'http://router.local/', 'http://metadata.google.internal/', 'http://user:pw@a.com/', 'ftp://a.com/', 'file:///etc/passwd', 'http://2130706433/', 'http://0x7f000001/', 'http://a.com:22/', 'http://a.com:6379/'])
      expect(isSafeUrl(u), u).toBe(false);
    for (const u of ['https://cdn.example.com/live.m3u8', 'http://1.2.3.4:8080/a.m3u8', 'http://tv.example.com:9090/live.m3u8', 'https://[2606:4700::1]/a.m3u8']) expect(isSafeUrl(u), u).toBe(true);
  });
});

describe('link and source health', () => {
  const rules = { failuresBeforeRemoval: 3, recheckRemovedEveryDays: 7 };
  const bad = { ok: false as const, reason: 'html' as const, detail: 'x' };
  const day = 86_400_000;

  it('removes a link only after 3 failed nights; one good night clears it', () => {
    const h = emptyHealth();
    expect(recordLink(h, 'u', bad, rules, 1).keep).toBe(true);
    expect(recordLink(h, 'u', bad, rules, 2).keep).toBe(true);
    expect(recordLink(h, 'u', bad, rules, 3).keep).toBe(false);
    expect(restingLink(h, 'u', rules, 3 + day)).toBe(true);
    expect(restingLink(h, 'u', rules, 3 + 8 * day)).toBe(false);
    expect(recordLink(h, 'u', { ok: true, kind: 'hls', detail: 'mpeg-ts' }, rules, 4).keep).toBe(true);
    expect(h.links.u).toBeUndefined();
  });

  it('404 removes at once; geo-locks and timeouts never count', () => {
    const h = emptyHealth();
    expect(recordLink(h, 'a', { ok: false, reason: 'http', detail: 'HTTP 404' }, rules, 1).keep).toBe(false);
    for (let i = 0; i < 5; i++) expect(recordLink(h, 'b', { ok: false, reason: 'locked', detail: 'HTTP 403' }, rules, i).keep).toBe(true);
    expect(recordLink(h, 'c', { ok: false, reason: 'timeout', detail: '' }, rules, 1).keep).toBe(true);
  });

  it('switches a source off after 3 bad nights and retries it after a week', () => {
    const h = emptyHealth();
    recordSource(h, 's', 10, 0, true, rules, 1);
    recordSource(h, 's', 10, 0, true, rules, 2);
    expect(restingSources(h, rules, 3).has('s')).toBe(false);
    recordSource(h, 's', 0, 0, false, rules, 3);
    expect(restingSources(h, rules, 4).has('s')).toBe(true);
    expect(restingSources(h, rules, 3 + 8 * day).has('s')).toBe(false);
    recordSource(h, 's', 10, 4, true, rules, 3 + 8 * day);
    expect(h.sources.s.badNights).toBe(0);
  });
});

describe('refresh settings', () => {
  it('clamps hand-edited values and ignores junk', () => {
    const s = parseSettings({ refresh: { channelsEveryHours: 1, guideEveryHours: 'x' }, limits: { costCapUsd: 50, maxRunMinutes: 999 }, discovery: { excludedHosts: ['*.Bad.com', 42, 'a\u0000b'] } });
    expect(s.refresh.channelsEveryHours).toBe(24);
    expect(s.refresh.guideEveryHours).toBe(DEFAULT_SETTINGS.refresh.guideEveryHours);
    expect(s.limits.costCapUsd).toBe(0);
    expect(s.limits.maxRunMinutes).toBe(80);
    expect(s.discovery.excludedHosts).toEqual(['bad.com']);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('knows when a job is due', () => {
    const h = 3_600_000;
    expect(isDue(undefined, 24)).toBe(true);
    expect(isDue(0, 24, 23 * h)).toBe(false);
    expect(isDue(0, 24, 24 * h - 5 * 60_000)).toBe(true);
  });
});

describe('encrypted HLS (Pluto TV style)', () => {
  const pl = '#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-KEY:METHOD=AES-128,URI="https://k.example.com/1.key"\n#EXTINF:5,\nhttps://seg.example.com/a.ts\n';
  const scrambled = () => Uint8Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) % 251);
  it('accepts a scrambled segment when the playlist declares AES-128', async () => {
    const get = net({ 'https://c.example.com/a.m3u8': { body: pl }, 'https://seg.example.com/a.ts': { type: 'video/mp2t', body: scrambled() } });
    expect(await validateStream('https://c.example.com/a.m3u8', get, { live: true })).toMatchObject({ ok: true, detail: 'encrypted segment' });
  });
  it('still rejects an error page in place of an encrypted segment, and scrambled bytes without encryption', async () => {
    const err = net({ 'https://c.example.com/a.m3u8': { body: pl }, 'https://seg.example.com/a.ts': { status: 200, type: 'application/xml', body: '<?xml version="1.0"?><Error>AccessDenied</Error>' } });
    expect(await validateStream('https://c.example.com/a.m3u8', err)).toMatchObject({ ok: false });
    const plain = net({ 'https://c.example.com/a.m3u8': { body: pl.replace(/#EXT-X-KEY[^\n]*\n/, '') }, 'https://seg.example.com/a.ts': { body: scrambled() } });
    expect(await validateStream('https://c.example.com/a.m3u8', plain)).toMatchObject({ ok: false, reason: 'not-media' });
  });
});
