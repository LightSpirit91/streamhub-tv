import { describe, expect, it } from 'vitest';
import { screenEntry, screenRepo, toM3uLine, trustedHosts, trustKey } from '../discovery/screen';
import { parseM3U } from '../m3u/parseM3U';
import type { PlaylistEntry } from '../types';

const entry = (url: string, extra: Partial<PlaylistEntry> = {}): PlaylistEntry => ({ name: 'Some Channel', url, groups: [], attrs: {}, ...extra });
const ctx = () => ({
  trusted: trustedHosts(['https://amg00123-a.amagi.tv/playlist.m3u8', 'https://d1abc.cloudfront.net/live.m3u8', 'https://news.cbc.ca/live.m3u8'], ['trusted.example.org']),
  excludedHosts: ['blocked.example.com'],
  knownUrls: new Set(['https://news.cbc.ca/live.m3u8']),
});

describe('discovery rules', () => {
  it('skips PPV / restream repos, known sources and excluded repos', () => {
    expect(screenRepo({ full_name: 'someone/PPVTV' }, [])).toBe('repo-ppv');
    expect(screenRepo({ full_name: 'x/sports', description: 'streamed.su mirror' }, [])).toBe('repo-ppv');
    expect(screenRepo({ full_name: 'x/y', topics: ['crackstreams'] }, [])).toBe('repo-ppv');
    expect(screenRepo({ full_name: 'iptv-org/iptv' }, [])).toBe('repo-known-source');
    expect(screenRepo({ full_name: 'a/b' }, ['a/b'])).toBe('repo-excluded');
    expect(screenRepo({ full_name: 'someone/fast-channels', description: 'Free ad-supported TV playlists' }, [])).toBeUndefined();
  });

  it('accepts a new link on a host the vetted catalog already uses', () => {
    expect(screenEntry(entry('https://amg99999-b.amagi.tv/new.m3u8'), ctx())).toBeUndefined();
    expect(screenEntry(entry('https://cdn.trusted.example.org/a.m3u8'), ctx())).toBeUndefined();
  });

  it('rejects unknown hosts, other cloudfront tenants, excluded hosts and duplicates', () => {
    expect(screenEntry(entry('https://random-iptv.xyz/a.m3u8'), ctx())).toBe('host-not-trusted');
    expect(screenEntry(entry('https://d9other.cloudfront.net/a.m3u8'), ctx())).toBe('host-not-trusted');
    expect(screenEntry(entry('https://d1abc.cloudfront.net/other.m3u8'), ctx())).toBeUndefined();
    expect(screenEntry(entry('https://x.blocked.example.com/a.m3u8'), ctx())).toBe('host-excluded');
    expect(screenEntry(entry('https://news.cbc.ca/live.m3u8'), ctx())).toBe('duplicate');
  });

  it('rejects faked headers, account links, short-lived links, PPV names, unsafe and banned links', () => {
    expect(screenEntry(entry('https://news.cbc.ca/b.m3u8', { referrer: 'https://site' }), ctx())).toBe('needs-faked-headers');
    expect(screenEntry(entry('https://news.cbc.ca/get.php?username=a&password=b'), ctx())).toBe('account-link');
    expect(screenEntry(entry('https://news.cbc.ca/live/user/pass/123.ts'), ctx())).toBe('account-link');
    expect(screenEntry(entry('https://news.cbc.ca/c.m3u8?token=abc&expires=1'), ctx())).toBe('expiring-link');
    expect(screenEntry(entry('https://news.cbc.ca/d.m3u8', { name: 'UFC PPV Main Card' }), ctx())).toBe('ppv-name');
    expect(screenEntry(entry('https://ppv.to/live/1.m3u8'), ctx())).toBe('repo-ppv');
    expect(screenEntry(entry('http://192.168.1.10/a.m3u8'), ctx())).toBe('unsafe');
    expect(screenEntry(entry('https://www.youtube.com/watch?v=abc'), ctx())).toBe('banned');
  });

  it('groups hosts by site but keeps shared hosting exact', () => {
    expect(trustKey('a.b.example.co.uk')).toBe('example.co.uk');
    expect(trustKey('live.cbc.ca')).toBe('cbc.ca');
    expect(trustKey('d1abc.cloudfront.net')).toBe('d1abc.cloudfront.net');
  });

  it('writes a clean playlist line that can be read back', () => {
    const line = toM3uLine(entry('https://news.cbc.ca/z.m3u8', { name: 'CBC "News"\u0007', tvgId: 'CBCNews.ca<script>', logo: 'javascript:alert(1)', groups: ['News'], country: 'CA' }), 'someone/repo');
    expect(line).not.toMatch(/javascript|<script>|\u0007/);
    const back = parseM3U(`#EXTM3U\n${line}\n`)[0];
    expect(back).toMatchObject({ name: 'CBC News', url: 'https://news.cbc.ca/z.m3u8', tvgId: 'CBCNews.cascript' });
  });
});

describe('discovery country rule', () => {
  const c = () => ({ ...ctx(), countries: new Set(['US', 'CA', 'UK', 'RU', 'IL', 'MX', 'INT']) });
  it('leaves out links marked for countries you do not watch', () => {
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { country: 'ID' }), c())).toBe('other-country');
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { tvgId: 'RCTI.id' }), c())).toBe('other-country');
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { tvgId: 'CNN.us' }), c())).toBeUndefined();
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { country: 'GB' }), c())).toBeUndefined();
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8'), c())).toBeUndefined();
  });
});

describe('discovery refuses restreams', () => {
  it('leaves out bare-IP servers, pay-TV channel names and restream services', () => {
    expect(screenEntry(entry('http://23.237.104.106:8080/cw/index.m3u8', { name: 'CW' }), ctx())).toBe('ip-host');
    for (const n of ['HBO Hits', 'FX', 'AMC', 'NFL Network', 'Disney Channel', 'ACC Network', 'Tennis Channel 2', 'NBC Sports Philadelphia', 'BBC America', 'Univision Network', 'Fox'])
      expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { name: n }), ctx()), n).toBe('pay-tv-channel');
    for (const n of ['CBS News Boston', 'ABC News Live', 'Fox Weather', 'NBC News NOW', 'Buzzr', 'Circle Country'])
      expect(screenEntry(entry('https://amg1.amagi.tv/b.m3u8', { name: n }), ctx()), n).toBeUndefined();
    expect(screenEntry(entry('https://tvsen3.aynaott.com/x/index.m3u8', { name: 'Something' }), ctx())).toBe('repo-ppv');
  });
});

describe('discovery: links without a country tag', () => {
  const c = () => ({ ...ctx(), countries: new Set(['US', 'CA']), knownNames: new Set(['buzzr', 'cbsnewsboston']) });
  it('only adds them as extra links for channels already in the lineup', () => {
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { name: 'Buzzr (1080p)' }), c())).toBeUndefined();
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { name: 'Hindi Movies' }), c())).toBe('unknown-country');
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { name: 'New FAST Channel', country: 'US' }), c())).toBeUndefined();
  });
});

describe('discovery: flag emoji as country', () => {
  it('reads the flag in the channel name', () => {
    const c = { ...ctx(), countries: new Set(['US']), knownNames: new Set(['southpark']) };
    expect(screenEntry(entry('https://amg1.amagi.tv/a.m3u8', { name: '☆ South Park (Coleção Kyle) 🇧🇷' }), c)).toBe('other-country');
    expect(screenEntry(entry('https://amg1.amagi.tv/b.m3u8', { name: '☆ Tastemade Travel 🇺🇸' }), c)).toBeUndefined();
  });
});
