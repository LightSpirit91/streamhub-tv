import type { Movie } from './types';

/**
 * Internet Archive "Feature Films" and related collections: thousands of
 * full-length films that are public domain or freely licensed. Legal, free,
 * no account, playable as plain MP4 on every device.
 */
export const ARCHIVE_COLLECTIONS = ['feature_films', 'Film_Noir', 'SciFi_Horror'];

export function searchUrl(rows: number, page = 1): string {
  const q = `collection:(${ARCHIVE_COLLECTIONS.join(' OR ')}) AND mediatype:movies`;
  const fl = ['identifier', 'title', 'year', 'downloads', 'subject', 'description', 'runtime'];
  const params = [
    `q=${encodeURIComponent(q)}`,
    ...fl.map((f) => `fl[]=${f}`),
    'sort[]=downloads+desc',
    `rows=${rows}`,
    `page=${page}`,
    'output=json',
  ];
  return `https://archive.org/advancedsearch.php?${params.join('&')}`;
}

export const metadataUrl = (id: string) => `https://archive.org/metadata/${encodeURIComponent(id)}`;
export const posterUrl = (id: string) => `https://archive.org/services/img/${encodeURIComponent(id)}`;
export const fileUrl = (id: string, name: string) =>
  `https://archive.org/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;

export interface ArchiveFile {
  name: string;
  format?: string;
  size?: string;
  height?: string;
}

/** Best playable MP4: original h.264 first, then MPEG4, then the 512kb copy. */
export function pickVideoFile(files: ArchiveFile[]): ArchiveFile | undefined {
  const mp4 = files.filter((f) => /\.mp4$/i.test(f.name));
  const rank = (f: ArchiveFile) => {
    const fmt = (f.format ?? '').toLowerCase();
    if (fmt === 'h.264' || fmt === 'h.264 hd') return 3;
    if (fmt === 'mpeg4') return 2;
    if (fmt.includes('512kb')) return 1;
    return 0;
  };
  const size = (f: ArchiveFile) => Number(f.size ?? 0);
  // Skip giant masters (>4 GB) that stream poorly.
  const ok = mp4.filter((f) => size(f) === 0 || size(f) < 4e9);
  return ok.sort((a, b) => rank(b) - rank(a) || size(b) - size(a))[0];
}

const GENRE_RULES: [string, RegExp][] = [
  ['Crime & Noir', /\b(noir|crime|gangster|detective|heist)\b/i],
  ['Horror', /\b(horror|zombie|vampire|monster|ghost|frankenstein|dracula)\b/i],
  ['Sci-Fi', /\b(sci-?fi|science fiction|space|alien|robot|future)\b/i],
  ['Western', /\b(western|cowboy|outlaw)\b/i],
  ['War', /\b(war|wwii|world war|soldier|army|navy)\b/i],
  ['Comedy', /\b(comedy|comedies|slapstick|humor|humour)\b/i],
  ['Mystery & Thriller', /\b(mystery|thriller|suspense|spy|hitchcock)\b/i],
  ['Romance', /\b(romance|romantic|love story)\b/i],
  ['Adventure', /\b(adventure|action|swashbuckler|jungle|pirate)\b/i],
  ['Animation', /\b(animation|animated|cartoon)\b/i],
  ['Musical', /\b(musical|music)\b/i],
  ['Documentary', /\b(documentary|newsreel)\b/i],
  ['Drama', /\b(drama|melodrama)\b/i],
];

export function genresFrom(subject: unknown, title = ''): string[] {
  const text = [Array.isArray(subject) ? subject.join(' ') : String(subject ?? ''), title].join(' ');
  const g = GENRE_RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
  return g.length ? g.slice(0, 3) : ['Drama'];
}

export function cleanText(html: unknown, max = 320): string {
  const s = (Array.isArray(html) ? html.join(' ') : String(html ?? ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max).replace(/\s\S*$/, '')}...` : s;
}

export interface SearchDoc {
  identifier: string;
  title?: string;
  year?: string | number;
  downloads?: number;
  subject?: string | string[];
  description?: string | string[];
  runtime?: string;
}

export function toMovie(doc: SearchDoc, files: ArchiveFile[]): Movie | null {
  const file = pickVideoFile(files);
  if (!file || !doc.title) return null;
  const year = Number(String(doc.year ?? '').slice(0, 4)) || undefined;
  return {
    id: doc.identifier,
    title: cleanText(doc.title, 90),
    year,
    genres: genresFrom(doc.subject, doc.title),
    description: cleanText(doc.description),
    poster: posterUrl(doc.identifier),
    url: fileUrl(doc.identifier, file.name),
    runtime: doc.runtime || undefined,
    source: 'archive',
    popularity: doc.downloads ?? 0,
  };
}
