/**
 * One-off diagnostics run on GitHub (whose network reaches sites this
 * workspace can't): prints status and the start of each URL's response.
 */
import { gunzipSync } from 'node:zlib';

const URLS = [
  'https://jfc.org.il/wp-json/',
  'https://jfc.org.il/wp-json/wp/v2/types',
  'https://jfc.org.il/en/faqs/',
  'https://jfc.org.il/sitemap_index.xml',
  'https://jfc.org.il/lobby/archive-materials/',
  'https://epgshare01.online/epgshare01/',
  'https://i.mjh.nz/SamsungTVPlus/us.xml.gz',
  'https://i.mjh.nz/Plex/us.xml.gz',
];

async function main() {
  for (const url of URLS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 StreamHub-Probe/1.0' } });
      const buf = Buffer.from(await res.arrayBuffer());
      const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
      console.log(`\n===== ${url}\nstatus ${res.status} · ${buf.length} bytes · type ${res.headers.get('content-type')}`);
      if (url.endsWith('/epgshare01/')) {
        const files = [...text.matchAll(/href="(epg_ripper_[^"]+)"/g)].map((m) => m[1]);
        console.log(files.join('\n'));
      } else if (url.includes('wp-json/wp/v2/types')) {
        try {
          const j = JSON.parse(text) as Record<string, { rest_base?: string; name?: string }>;
          for (const [k, v] of Object.entries(j)) console.log(`${k} -> /wp-json/wp/v2/${v.rest_base} (${v.name})`);
        } catch {
          console.log(text.slice(0, 1500));
        }
      } else if (url.endsWith('/wp-json/')) {
        try {
          const j = JSON.parse(text) as { routes?: Record<string, unknown> };
          console.log(Object.keys(j.routes ?? {}).filter((r) => !/oembed|users|settings|block|template|menu|widget|sidebar|plugin|theme|font|navigation|global|pattern|search|comment|media/.test(r)).join('\n'));
        } catch {
          console.log(text.slice(0, 1500));
        }
      } else {
        console.log(text.slice(0, 2500).replace(/\s+/g, ' '));
        const players = [...new Set([...text.matchAll(/(vimeo\.com\/[^"' ]+|youtube(?:-nocookie)?\.com\/embed\/[^"' ]+|kaltura[^"' ]+|\.m3u8[^"' ]*|jwplayer[^"' ]*|vod[^"' ]+\.mp4)/gi)].map((m) => m[1]))].slice(0, 15);
        if (players.length) console.log('PLAYER HINTS:', players.join(' | '));
      }
    } catch (e) {
      console.log(`\n===== ${url}\nFAILED ${(e as Error).message}`);
    }
  }
}
main();
