import type { Episode, Show } from './types';
import { cleanText, cleanTitle, fileUrl, genresFrom, isWatchable, languageOf, posterUrl, type ArchiveFile, type SearchDoc } from '../movies/archive';

/**
 * Public-domain TV series from the Internet Archive ("Classic TV" and
 * related collections). Items are either a whole series/season (many video
 * files) or a single episode; single episodes are grouped by series name.
 */
// Curated public-domain TV only. User-upload collections (e.g. television_inbox)
// are excluded: they contain modern copyrighted series.
export const SHOW_COLLECTIONS = ['classic_tv', 'classic_tv_1950s', 'classic_tv_1960s', 'classic_tv_commercials_excluded'];

/** Public-domain TV is old TV. Anything that says it's recent is not ours to show. */
export function isClassicShow(title: string, year?: number, description = ''): boolean {
  if (year && year > 1978) return false;
  const text = `${title} ${description.slice(0, 300)}`;
  const recent = /\b(19[89]\d|20[0-2]\d)\b/.exec(text);
  if (recent && Number(recent[1]) > 1978) return false;
  if (/complete series|complete season|seasons? \d+\s*-\s*\d+|\bs\d{2}\b.*\b1080p\b/i.test(title)) return false;
  return true;
}

export function showSearchUrl(rows: number, page = 1): string {
  const q = `collection:(${SHOW_COLLECTIONS.join(' OR ')}) AND mediatype:movies`;
  const fl = ['identifier', 'title', 'year', 'downloads', 'subject', 'description', 'language', 'collection'];
  return `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&${fl.map((f) => `fl[]=${f}`).join('&')}&sort[]=downloads+desc&rows=${rows}&page=${page}&output=json`;
}

/** "Dragnet - The Big Seventeen (1952)" -> { series: "Dragnet", episode: "The Big Seventeen" } */
export function splitEpisodeTitle(raw: string): { series: string; episode: string } {
  const t = cleanTitle(raw);
  const m =
    /^(.+?)\s*[-–:|]\s*(?:s\d+\s*e\d+\s*[-–:]?\s*)?(.+)$/i.exec(t) ??
    /^(.+?)\s+(?:episode|ep\.?)\s*#?\d+.*$/i.exec(t);
  if (m && m[1].length >= 3) return { series: m[1].trim(), episode: (m[2] ?? t).trim() };
  return { series: t, episode: t };
}

export function seasonEpisode(name: string): { season?: number; episode?: number } {
  const m = /s(\d{1,2})\s*e(\d{1,3})/i.exec(name) ?? /(\d{1,2})x(\d{1,3})/.exec(name);
  if (m) return { season: +m[1], episode: +m[2] };
  const e = /(?:episode|ep\.?|#)\s*(\d{1,3})/i.exec(name);
  return e ? { episode: +e[1] } : {};
}

type EpFile = ArchiveFile & { title?: string; length?: string };

/** Every distinct playable episode file in one archive item, best copy each. */
export function episodeFiles(files: EpFile[]): EpFile[] {
  const mp4 = files.filter((f) => /\.mp4$/i.test(f.name));
  const byBase = new Map<string, EpFile>();
  const rank = (f: ArchiveFile) => {
    const fmt = (f.format ?? '').toLowerCase();
    if (fmt.includes('h.264')) return 3;
    if (fmt.includes('mpeg4') && !fmt.includes('512kb')) return 2;
    return 1;
  };
  for (const f of mp4) {
    const base = f.name.replace(/(_512kb|\.ia)?\.mp4$/i, '').toLowerCase();
    const prev = byBase.get(base);
    if (!prev || rank(f) > rank(prev)) byBase.set(base, f);
  }
  return [...byBase.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export const showKey = (title: string) =>
  cleanTitle(title).toLowerCase().replace(/^the /, '').replace(/[^a-z0-9Ѐ-ӿ֐-׿]/g, '');

export function itemToShowParts(
  doc: SearchDoc,
  files: EpFile[],
): { key: string; show: Omit<Show, 'episodes'>; episodes: Episode[] } | null {
  if (!doc.title || !isWatchable(doc)) return null;
  const docYear = Number(String(doc.year ?? '').slice(0, 4)) || undefined;
  if (!isClassicShow(doc.title, docYear, String(doc.description ?? ''))) return null;
  const eps = episodeFiles(files);
  if (!eps.length) return null;
  const multi = eps.length > 1;
  const { series, episode } = splitEpisodeTitle(doc.title);
  const seriesTitle = multi
    ? cleanTitle(doc.title).replace(/\s*[-–:]\s*(season|series|complete|episodes?)\b.*$/i, '').replace(/\s+(season|series)\s*\d+$/i, '')
    : series;
  const episodes: Episode[] = eps.map((f, i) => {
    const label = cleanText(f.title || f.name.replace(/\.mp4$/i, '').replace(/[_.]+/g, ' '), 90);
    const minutes = f.length ? Math.round(Number(f.length) / 60) || undefined : undefined;
    const se = seasonEpisode(multi ? f.name : doc.title ?? "");
    return {
      id: `${doc.identifier}/${f.name}`,
      title: multi ? label : episode,
      url: fileUrl(doc.identifier, f.name),
      minutes,
      ...se,
      ...(multi && !se.episode ? { episode: i + 1 } : {}),
    };
  });
  const year = Number(String(doc.year ?? '').slice(0, 4)) || undefined;
  return {
    key: showKey(seriesTitle),
    show: {
      id: showKey(seriesTitle),
      title: seriesTitle,
      poster: posterUrl(doc.identifier),
      description: cleanText(doc.description),
      genres: genresFrom(doc.subject, seriesTitle),
      year,
      language: languageOf(doc.language),
      source: 'archive',
      popularity: doc.downloads ?? 0,
    },
    episodes,
  };
}
