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

/** Titles kept out of the library: exploitation, adult, disturbing or non-film uploads. */
const BLOCK = /\b(sex|sexual|nudist|nude|nudity|naked|erotic|erotica|stag|burlesque|striptease|molest\w*|rape|incest|adult film|exploitation|reefer|marihuana|marijuana|drug addict\w*|concentration camps?|atrocit\w*|execution|autopsy|snuff)\b/i;
const NOT_A_FEATURE = /\b(episodes?|trailers?|compilation|festival|collection|reel|newsreel|films|shorts|serial chapter|chapter \d+)\b/i;

/** Well-known classics float to the top of every row and the hero. */
const CLASSICS = [
  'his girl friday', 'house on haunted hill', 'night of the living dead', 'charade', 'metropolis', 'nosferatu',
  'the general', 'the little shop of horrors', 'detour', 'd.o.a.', 'the stranger', 'suddenly', 'plan 9 from outer space',
  'the kid', 'sherlock jr', 'the gold rush', 'mclintock', 'the lady vanishes', 'the 39 steps', 'carnival of souls',
  'the last man on earth', 'the hitch-hiker', 'scarlet street', 'the man with the golden arm', 'royal wedding',
  'my man godfrey', 'nothing sacred', 'angel and the badman', 'the outlaw', 'the brain that wouldn\'t die',
  'white zombie', 'the phantom of the opera', 'the cabinet of dr. caligari', 'dementia 13', 'a farewell to arms',
  'gulliver\'s travels', 'jungle book', 'the thief of bagdad', 'sita sings the blues', 'the great flamarion',
  'beat the devil', 'kansas city confidential', 'the big combo', 'quicksand', 'impact', 'the second woman',
];

export function isWatchable(doc: { title?: string; subject?: unknown; description?: unknown }): boolean {
  const title = String(doc.title ?? '');
  const subject = Array.isArray(doc.subject) ? doc.subject.join(' ') : String(doc.subject ?? '');
  const desc = Array.isArray(doc.description) ? doc.description.join(' ') : String(doc.description ?? '');
  if (BLOCK.test(title) || BLOCK.test(subject) || BLOCK.test(desc.slice(0, 600))) return false;
  if (NOT_A_FEATURE.test(title)) return false;
  return true;
}

export function classicBoost(title: string): number {
  const t = title.toLowerCase();
  return CLASSICS.some((c) => t === c || t.startsWith(`${c} `) || t.startsWith(`${c}(`)) ? 10 : 1;
}

/** "ANGEL AND THE BADMAN video quality upgrade" -> "Angel and the Badman". */
export function cleanTitle(raw: string): string {
  let t = cleanText(raw, 120)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\((?:\d{4}|complete[^)]*|restored[^)]*|hd|hq|colou?ri[sz]ed[^)]*|\d+p)\)/gi, '')
    .replace(/\b(video quality upgrade|high quality|full movie|hd|hq|restored|remastered|\d{3,4}p)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-:,.]+$/, '')
    .trim();
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) {
    const small = new Set(['a', 'an', 'and', 'the', 'of', 'on', 'in', 'to', 'for', 'at', 'by', 'from']);
    t = t
      .toLowerCase()
      .split(' ')
      .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
  }
  return t;
}

export function titleKey(title: string): string {
  return cleanTitle(title).toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
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
  if (!file || !doc.title || !isWatchable(doc)) return null;
  const year = Number(String(doc.year ?? '').slice(0, 4)) || undefined;
  return {
    id: doc.identifier,
    title: cleanTitle(doc.title),
    year,
    genres: genresFrom(doc.subject, doc.title),
    description: cleanText(doc.description),
    poster: posterUrl(doc.identifier),
    url: fileUrl(doc.identifier, file.name),
    runtime: doc.runtime || undefined,
    source: 'archive',
    popularity: (doc.downloads ?? 0) * classicBoost(cleanTitle(doc.title)),
  };
}
