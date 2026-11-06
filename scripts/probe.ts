/**
 * One-off diagnostics run on GitHub (whose network reaches sites this
 * workspace can't). Playlists: status and first lines. XMLTV guides:
 * channels, programmes, and how many days ahead the schedule reaches.
 */
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

const URLS = [
  'https://i.mjh.nz/PlutoTV/us.m3u8',
  'https://i.mjh.nz/PlutoTV/all.m3u8',
  'https://i.mjh.nz/Roku/all.m3u8',
  'https://i.mjh.nz/PlutoTV/us.xml.gz',
  'https://i.mjh.nz/Roku/all.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_US2.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_CA2.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_IL1.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_US_SPORTS1.xml.gz',
  'https://epg.pw/xmltv/epg_US.xml.gz',
  'https://epg.pw/xmltv/epg_CA.xml.gz',
  'https://epg.pw/xmltv/epg_IL.xml.gz',
  'https://epg.pw/xmltv/epg_RU.xml.gz',
  'https://www.open-epg.com/files/unitedstates1.xml.gz',
  'https://www.open-epg.com/files/canada1.xml.gz',
  'https://www.open-epg.com/files/israel1.xml.gz',
  'https://www.open-epg.com/files/russia1.xml.gz',
];

const t = (s: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/.exec(s);
  if (!m) return NaN;
  const off = m[7] ? (Number(m[7].slice(0, 3)) * 60 + Math.sign(Number(m[7].slice(0, 3)) || 1) * Number(m[7].slice(3))) * 60 : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - off;
};

async function guide(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 240_000);
  const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'StreamHub-EPG/1.2' } });
  console.log(`status ${res.status} · type ${res.headers.get('content-type')} · length ${res.headers.get('content-length')}`);
  if (!res.ok || !res.body) return;
  let s: NodeJS.ReadableStream = Readable.fromWeb(res.body as never);
  if (url.endsWith('.gz')) s = s.pipe(createGunzip());
  const now = Date.now() / 1000;
  let channels = 0, programmes = 0, maxStop = 0, buf = '';
  const perChannelMax = new Map<string, number>();
  for await (const c of s as AsyncIterable<Buffer>) {
    buf += c.toString('utf8');
    channels += (buf.match(/<channel /g) ?? []).length;
    for (const m of buf.matchAll(/<programme[^>]*start="([^"]+)"[^>]*stop="([^"]+)"[^>]*channel="([^"]+)"|<programme[^>]*channel="([^"]+)"[^>]*start="([^"]+)"[^>]*stop="([^"]+)"/g)) {
      const stop = t(m[2] ?? m[6]);
      const ch = m[3] ?? m[4];
      programmes++;
      if (stop > maxStop) maxStop = stop;
      if (stop > (perChannelMax.get(ch) ?? 0)) perChannelMax.set(ch, stop);
    }
    const cut = buf.lastIndexOf('>');
    buf = buf.slice(cut + 1);
  }
  clearTimeout(timer);
  const reach = [...perChannelMax.values()].map((x) => (x - now) / 86400);
  const n = (d: number) => reach.filter((r) => r >= d).length;
  console.log(`channels ${channels} · programmes ${programmes} · furthest ${((maxStop - now) / 86400).toFixed(1)} days`);
  console.log(`channels reaching: 1d ${n(1)} · 2d ${n(2)} · 3d ${n(3)} · 5d ${n(5)} · 7d ${n(7)} (of ${perChannelMax.size})`);
}

async function main() {
  for (const url of URLS) {
    console.log(`\n===== ${url}`);
    try {
      if (/\.xml(\.gz)?$/.test(url)) await guide(url);
      else {
        const res = await fetch(url, { headers: { 'User-Agent': 'StreamHub/1.0' } });
        const text = await res.text();
        console.log(`status ${res.status} · ${text.length} chars · ${(text.match(/#EXTINF/g) ?? []).length} entries`);
        console.log(text.slice(0, 600));
      }
    } catch (e) {
      console.log(`FAILED ${(e as Error).message} ${(e as Error & { cause?: { code?: string } }).cause?.code ?? ''}`);
    }
  }
}
main();
