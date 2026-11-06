/**
 * XMLTV parsing and channel matching for the TV guide.
 * Pure TypeScript so it runs in the nightly job and in tests.
 */

/** Compact programme: [startSec, endSec, title, description?, category?] */
export type Programme = [number, number, string, string?, string?];

export interface Guide {
  version: number;
  builtAt: number;
  programs: Record<string, Programme[]>;
}

export interface XmlChannel {
  id: string;
  names: string[];
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&')
    .trim();

/** "20261106140000 +0000" -> unix seconds */
export function parseXmltvTime(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(s.trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, se = '0', tz = '+0000'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) / 1000;
  const sign = tz[0] === '-' ? -1 : 1;
  const off = sign * (+tz.slice(1, 3) * 3600 + +tz.slice(3, 5) * 60);
  return utc - off;
}

export function parseChannels(xml: string): XmlChannel[] {
  const out: XmlChannel[] = [];
  const re = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const names = [...m[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map((x) => decode(x[1]));
    out.push({ id: decode(m[1]), names });
  }
  return out;
}

/**
 * Streams programmes for the wanted channel ids inside [from, to].
 * Regex over the document, so 100+ MB files never become a DOM.
 */
export function collectProgrammes(
  xml: string,
  wanted: Set<string>,
  from: number,
  to: number,
  into: Map<string, Programme[]>,
): number {
  const re = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const ch = /channel="([^"]+)"/.exec(attrs)?.[1];
    if (!ch) continue;
    const id = decode(ch);
    if (!wanted.has(id)) continue;
    const start = parseXmltvTime(/start="([^"]+)"/.exec(attrs)?.[1] ?? '');
    const stop = parseXmltvTime(/stop="([^"]+)"/.exec(attrs)?.[1] ?? '');
    if (!(stop > from && start < to)) continue;
    const body = m[2];
    const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? '');
    if (!title) continue;
    const sub = decode(/<sub-title[^>]*>([\s\S]*?)<\/sub-title>/.exec(body)?.[1] ?? '');
    let desc = decode(/<desc[^>]*>([\s\S]*?)<\/desc>/.exec(body)?.[1] ?? '');
    if (sub && !desc.startsWith(sub)) desc = desc ? `${sub}. ${desc}` : sub;
    if (desc.length > 180) desc = `${desc.slice(0, 177).replace(/\s\S*$/, '')}...`;
    const cat = decode(/<category[^>]*>([\s\S]*?)<\/category>/.exec(body)?.[1] ?? '');
    const p: Programme = [start, stop, title];
    if (desc || cat) p.push(desc);
    if (cat) p.push(cat);
    const list = into.get(id) ?? [];
    list.push(p);
    into.set(id, list);
    n++;
  }
  return n;
}

export const normKey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/@.*$/, '')
    .replace(/\b(hd|sd|fhd|uhd|4k|tv|channel)\b/g, '')
    .replace(/[^a-z0-9Ѐ-ӿ֐-׿]+/g, '');

export interface MatchTarget {
  id: string;
  name: string;
  country?: string;
  /** Pluto TV channel id taken from the stream URL, when present. */
  plutoId?: string;
}

/**
 * Maps app channel ids to XMLTV channel ids:
 * 1. Pluto id appears in the XMLTV id
 * 2. Same id once normalized ("Kan11.il@SD" ~ "kan11.il")
 * 3. Same display name, preferring a matching country suffix
 */
export function matchChannels(targets: MatchTarget[], xml: XmlChannel[]): Map<string, string> {
  const byId = new Map<string, string>();
  const byName = new Map<string, string[]>();
  const pluto = new Map<string, string>();
  for (const c of xml) {
    byId.set(normKey(c.id), c.id);
    const hex = /[0-9a-f]{24}/.exec(c.id)?.[0];
    if (hex) pluto.set(hex, c.id);
    for (const n of c.names) {
      const k = normKey(n);
      if (k) byName.set(k, [...(byName.get(k) ?? []), c.id]);
    }
  }
  const out = new Map<string, string>();
  for (const t of targets) {
    if (t.plutoId && pluto.has(t.plutoId)) {
      out.set(t.id, pluto.get(t.plutoId)!);
      continue;
    }
    const direct = byId.get(normKey(t.id));
    if (direct) {
      out.set(t.id, direct);
      continue;
    }
    const cands = byName.get(normKey(t.name)) ?? [];
    if (!cands.length) continue;
    const cc = t.country?.toLowerCase();
    const pick = (cc && cands.find((x) => new RegExp(`[._-]${cc}\\b`, 'i').test(x))) || (cands.length === 1 ? cands[0] : undefined);
    if (pick) out.set(t.id, pick);
  }
  return out;
}

/** What's on now and next, from a compact programme list. */
export function nowNext(list: Programme[] | undefined, nowSec: number): { now?: Programme; next: Programme[] } {
  if (!list?.length) return { next: [] };
  const i = list.findIndex((p) => p[0] <= nowSec && p[1] > nowSec);
  if (i === -1) return { next: list.filter((p) => p[0] > nowSec) };
  return { now: list[i], next: list.slice(i + 1) };
}
