/**
 * Adds English, Spanish, Russian and Hebrew subtitles from OpenSubtitles to
 * films that play inside StreamHub, most-watched first. Runs every night.
 *
 * Needs three secrets: OPENSUBTITLES_API_KEY, OPENSUBTITLES_USERNAME,
 * OPENSUBTITLES_PASSWORD (free account). Without them the job exits quietly.
 * The free plan allows about 20 downloads a day, so the library fills in
 * gradually. Files are kept in dist/subs and served from the catalog branch.
 *
 * Usage: npx tsx scripts/subtitle-doctor.ts [--out dist] [--previous prev]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Movie, MovieCatalog } from '../src/core/movies/types';
import type { SubLang } from '../src/core/subtitles';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', 'dist');
const PREV = arg('--previous', 'prev');
const KEY = process.env.OPENSUBTITLES_API_KEY;
const USER = process.env.OPENSUBTITLES_USERNAME;
const PASS = process.env.OPENSUBTITLES_PASSWORD;
const UA = 'StreamHub v1.0';
const SUBS_URL = 'https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/subs';
const WANT: SubLang[] = ['es', 'ru', 'he', 'en'];
const RETRY_MS = 30 * 86_400_000; // a language with nothing found is looked for again after a month
const SEARCH_MAX = 250; // searches a night (they don't use the download allowance)

type Tried = Partial<Record<SubLang, number>>;
type Film = Movie & { subsTried?: Tried };

let base = 'https://api.opensubtitles.com/api/v1';
let token = '';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Api-Key': KEY!, 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`OpenSubtitles HTTP ${res.status}`);
    return (await res.json()) as T;
  }
  throw new Error('OpenSubtitles busy');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileName = (id: string, lang: SubLang) => `${id.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 90)}.${lang}.srt`;

interface Hit {
  attributes: { language: string; download_count?: number; hearing_impaired?: boolean; machine_translated?: boolean; ai_translated?: boolean; files: { file_id: number }[] };
}

async function main() {
  const report = ['# Subtitles (OpenSubtitles)', ''];
  const write = () => {
    writeFileSync(join(OUT, 'subs-report.md'), report.join('\n'));
    console.log(report.join('\n'));
  };
  // Keep the files downloaded on earlier nights.
  mkdirSync(join(OUT, 'subs'), { recursive: true });
  if (existsSync(join(PREV, 'subs'))) cpSync(join(PREV, 'subs'), join(OUT, 'subs'), { recursive: true });

  if (!KEY || !USER || !PASS) {
    report.push('Skipped: add the OPENSUBTITLES_API_KEY, OPENSUBTITLES_USERNAME and OPENSUBTITLES_PASSWORD secrets.');
    return write();
  }
  const file = join(OUT, 'movies.json');
  if (!existsSync(file)) {
    report.push('Skipped: no movie library tonight.');
    return write();
  }
  const cat = JSON.parse(readFileSync(file, 'utf8')) as MovieCatalog;

  let login: { token: string; base_url?: string; user?: { allowed_downloads?: number } };
  try {
    login = await api('/login', { method: 'POST', body: JSON.stringify({ username: USER, password: PASS }) });
  } catch {
    report.push('Login failed: check the OpenSubtitles username and password secrets.');
    return write();
  }
  token = login.token;
  if (login.base_url) base = `https://${login.base_url.replace(/^https?:\/\//, '')}/api/v1`;
  let remaining = login.user?.allowed_downloads ?? 20;

  // Films that play here, with an IMDb id, most-watched first, still missing a wanted language.
  const now = Date.now();
  const missing = (m: Film) => WANT.filter((l) => !m.subs?.some((s) => s.lang === l) && now - (m.subsTried?.[l] ?? 0) > RETRY_MS);
  const queue = (cat.movies as Film[])
    .filter((m) => m.source === 'archive' && m.imdbId && missing(m).length)
    .sort((a, b) => b.popularity - a.popularity);

  let searched = 0;
  let got = 0;
  const byLang: Record<string, number> = {};
  for (const m of queue) {
    if (remaining <= 0 || searched >= SEARCH_MAX) break;
    const langs = missing(m);
    searched++;
    let hits: Hit[] = [];
    try {
      const r = await api<{ data: Hit[] }>(`/subtitles?imdb_id=${Number(m.imdbId!.replace(/^tt/, ''))}&languages=${langs.join(',')}&order_by=download_count&type=movie`);
      hits = r.data ?? [];
    } catch {
      continue;
    }
    await sleep(250);
    m.subsTried ??= {};
    for (const lang of langs) {
      m.subsTried[lang] = now;
      // Best human-made file for this language.
      const best = hits
        .filter((h) => h.attributes.language?.toLowerCase().startsWith(lang) && !h.attributes.machine_translated && !h.attributes.ai_translated && h.attributes.files?.length)
        .sort((a, b) => Number(!!a.attributes.hearing_impaired) - Number(!!b.attributes.hearing_impaired) || (b.attributes.download_count ?? 0) - (a.attributes.download_count ?? 0))[0];
      if (!best || remaining <= 0) continue;
      try {
        const d = await api<{ link: string; remaining?: number }>('/download', {
          method: 'POST',
          body: JSON.stringify({ file_id: best.attributes.files[0].file_id, sub_format: 'srt' }),
        });
        remaining = d.remaining ?? remaining - 1;
        const text = await (await fetch(d.link, { headers: { 'User-Agent': UA } })).text();
        if (!/-->/.test(text)) continue;
        const name = fileName(m.id, lang);
        writeFileSync(join(OUT, 'subs', name), text);
        m.subs = [...(m.subs ?? []).filter((s) => s.lang !== lang), { lang, url: `${SUBS_URL}/${encodeURIComponent(name)}` }];
        got++;
        byLang[lang] = (byLang[lang] ?? 0) + 1;
      } catch {
        // allowance used up or file gone: tomorrow
      }
      await sleep(300);
    }
  }

  writeFileSync(file, JSON.stringify(cat));
  const total = (l: SubLang) => cat.movies.filter((x) => x.subs?.some((s) => s.lang === l)).length;
  report.push(
    `- Tonight: ${got} subtitle files (${Object.entries(byLang).map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}), ${searched} films checked, ${remaining} downloads left today`,
    `- Films with subtitles: English ${total('en')} · Spanish ${total('es')} · Russian ${total('ru')} · Hebrew ${total('he')}`,
    '',
    'Subtitles from OpenSubtitles.com.',
  );
  write();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'subtitle-doctor failed');
  process.exit(1);
});
