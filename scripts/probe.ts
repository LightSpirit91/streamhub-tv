/**
 * One-off diagnostics run on GitHub (whose network reaches sites this
 * workspace can't): prints status and the start of each URL's response.
 */
import { gunzipSync } from 'node:zlib';

const URLS = [
  'https://jfc.org.il/movie-sitemap.xml',
  'https://jfc.org.il/general_film-sitemap.xml',
  'https://jfc.org.il/compilation-sitemap.xml',

];

async function main() {
  for (const url of URLS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 StreamHub-Probe/1.0' } });
      const buf = Buffer.from(await res.arrayBuffer());
      const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
      console.log(`\n===== ${url}\nstatus ${res.status} · ${buf.length} bytes · type ${res.headers.get('content-type')}`);
      if (url.endsWith('-sitemap.xml')) {
        const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        console.log(`${locs.length} urls; first: ${locs.slice(0, 4).join(' ')}`);
        // Inspect two film pages in detail.
        for (const page of locs.slice(1, 3)) {
          const h = await (await fetch(page, { headers: { 'User-Agent': 'Mozilla/5.0 StreamHub-Probe/1.0' } })).text();
          const pick = (re: RegExp) => re.exec(h)?.[1]?.slice(0, 200);
          console.log(`\n  --- ${page}`);
          console.log('  og:title', pick(/property="og:title" content="([^"]+)"/));
          console.log('  og:image', pick(/property="og:image" content="([^"]+)"/));
          console.log('  description', pick(/name="description" content="([^"]+)"/));
          const free = h.match(/(בחינם|חינם|free|לרכישה|בתשלום|price|₪|ש"ח|add-to-cart|woocommerce-Price)[^<]{0,60}/gi)?.slice(0, 8);
          console.log('  price/free hints', free);
          const players = [...new Set([...h.matchAll(/(player\.vimeo\.com\/video\/\d+[^"' ]*|vimeo\.com\/\d+|youtube(?:-nocookie)?\.com\/embed\/[\w-]+|[\w./:-]+\.m3u8[^"' ]*|[\w./:-]+\.mp4|kaltura[\w./:-]*|jwplayer[\w./:-]*|<iframe[^>]+src="[^"]+")/gi)].map((m) => m[1]))].slice(0, 10);
          console.log('  players', players);
          const ld = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(h)?.[1];
          if (ld) console.log('  ld+json', ld.slice(0, 600).replace(/\s+/g, ' '));
          const yr = h.match(/(שנת הפקה|שנה|Year)[^0-9]{0,40}(19\d\d|20\d\d)/);
          console.log('  year hint', yr?.[2]);
        }
      } else if (url.endsWith('/epgshare01/')) {
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
