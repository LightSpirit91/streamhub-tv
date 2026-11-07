/**
 * One-off diagnostics on GitHub (reaches sites this workspace can't).
 * Now: trial of the real playback check on a sample of tonight's links, to
 * compare with the old check before the nightly job relies on it. Read only.
 */
import type { Catalog } from '../src/core/types';
import { nextUri, validateStream } from '../src/core/playback/validate';
import { outcomeOf } from '../src/core/playback/health';
import { Budget, makeGetBytes, safeGet } from './lib/net';

async function main() {
  const cat = (await (await fetch('https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/catalog.json')).json()) as Catalog;
  const all = cat.channels.flatMap((c) => c.streams.map((s) => ({ s, ch: c.name })));
  // Every 12th link: an even spread across sources.
  const sample = all.filter((_, i) => i % 12 === 0).slice(0, 600);
  const budget = new Budget(10_000, Date.now() + 20 * 60_000);
  const get = makeGetBytes({ budget, timeoutMs: 10_000 });
  const reasons: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const examples: Record<string, string[]> = {};
  const t0 = Date.now();
  let i = 0;
  await Promise.all(
    Array.from({ length: 48 }, async () => {
      while (i < sample.length) {
        const { s, ch } = sample[i++];
        const v = await validateStream(s.url, get, { format: s.format === 'youtube' ? undefined : s.format, headers: s.headers, live: true });
        const key = v.ok ? `ok (${v.detail})` : v.reason;
        reasons[key] = (reasons[key] ?? 0) + 1;
        outcomes[outcomeOf(v)] = (outcomes[outcomeOf(v)] ?? 0) + 1;
        if (!v.ok) (examples[v.reason] ??= []).length < 4 && examples[v.reason].push(`${ch}: ${v.detail} ${new URL(s.url).hostname}`);
      }
    }),
  );
  const secs = (Date.now() - t0) / 1000;
  console.log(`Sample: ${sample.length} of ${all.length} links · ${secs.toFixed(0)} s · ${budget.used} requests`);
  console.log(`Estimated full night: ${((secs * all.length) / sample.length / 60).toFixed(0)} min at 48 at a time, ${Math.round((budget.used * all.length) / sample.length)} requests`);
  console.log('Outcomes:', JSON.stringify(outcomes));
  console.log('Details:', JSON.stringify(reasons, null, 1));
  console.log('Examples:', JSON.stringify(examples, null, 1));

  // What do "not video" answers actually look like?
  const show = (b: Uint8Array) => JSON.stringify(new TextDecoder('latin1').decode(b.subarray(0, 120)));
  const hex = (b: Uint8Array) => Buffer.from(b.subarray(0, 16)).toString('hex');
  for (const u of ['https://jmp2.uk/plu-66ed3eb27358ce000830df49.m3u8', 'https://jmp2.uk/plu-545943f1c9f133a519bbac92.m3u8']) {
    console.log(`\n== ${u}`);
    try {
      let url = u;
      for (let d = 0; d < 4; d++) {
        const r = await safeGet(url, { Origin: 'https://lightspirit91.github.io' }, { maxBytes: 64_000 });
        console.log(`depth ${d} url ${r.finalUrl.slice(0, 140)}\n  status ${r.status} type ${r.type} enc ${r.headers['content-encoding'] ?? '-'} len ${r.bytes.length} hex ${hex(r.bytes)} text ${show(r.bytes)}`);
        if (d > 0) console.log('  lines:', JSON.stringify(new TextDecoder().decode(r.bytes).split('\\n').slice(0, 14)));
        const t = new TextDecoder().decode(r.bytes);
        if (/#EXT-X-KEY/.test(t)) console.log('  has EXT-X-KEY:', /#EXT-X-KEY:[^\n]*/.exec(t)?.[0].slice(0, 80));
        const n = nextUri(t, r.finalUrl);
        if (!n) break;
        url = n.uri;
      }
    } catch (e) {
      console.log('error', (e as Error).name, (e as Error).message);
    }
  }
}
main();
