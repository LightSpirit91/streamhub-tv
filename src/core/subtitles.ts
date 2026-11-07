/**
 * Subtitles: the four languages offered, language detection, and a small
 * SRT / WebVTT reader for subtitle files that ship next to a film.
 */

export type SubLang = 'en' | 'es' | 'ru' | 'he';
export type SubChoice = SubLang | 'off';

export const SUB_LANGS: { code: SubLang; label: string; native: string; rtl?: boolean }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'he', label: 'Hebrew', native: 'עברית', rtl: true },
];

/** A subtitle file next to a film (Internet Archive). */
export interface SubFile {
  lang: SubLang;
  url: string;
  /** Made by machine translation from the film's English subtitles. */
  auto?: boolean;
}

/** A subtitle / caption track inside the stream itself. */
export interface StreamTrack {
  id: string;
  lang?: SubLang;
  label: string;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** "eng", "en-US", "English", "Español", "rus", "iw", "עברית" ... -> our code. */
export function normLang(s?: string): SubLang | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase().trim();
  if (/^(en|eng)(\b|[-_])|english|^cc1$|^captions?$/.test(t)) return 'en';
  if (/^(es|spa)(\b|[-_])|spanish|español|espanol|castellano|^cc3$/.test(t)) return 'es';
  if (/^(ru|rus)(\b|[-_])|russian|русск/.test(t)) return 'ru';
  if (/^(he|heb|iw)(\b|[-_])|hebrew|עברית/.test(t)) return 'he';
  return undefined;
}

/**
 * Language of a subtitle file from its name: "Film.eng.srt", "Film_Spanish.vtt",
 * "film.ru.srt". A file without a language tag in an English-language film is English.
 */
export function langFromFileName(name: string, filmLanguage?: string): SubLang | undefined {
  const base = name.replace(/\.(srt|vtt)$/i, '').toLowerCase();
  const parts = base.split(/[\s._()[\]-]+/).filter(Boolean);
  for (const p of parts.slice().reverse()) {
    const l = normLang(p);
    if (l) return l;
  }
  const named = /english|spanish|español|russian|hebrew/.exec(base)?.[0];
  if (named) return normLang(named);
  return !filmLanguage || filmLanguage === 'English' ? 'en' : normLang(filmLanguage);
}

/** Subtitle files listed in an Internet Archive item, one per language. */
export function subFilesOf(files: { name: string; format?: string }[], fileUrl: (name: string) => string, filmLanguage?: string): SubFile[] {
  const out: SubFile[] = [];
  for (const f of files) {
    if (!/\.(srt|vtt)$/i.test(f.name)) continue;
    const lang = langFromFileName(f.name.split('/').pop() ?? f.name, filmLanguage);
    if (!lang || out.some((x) => x.lang === lang)) continue;
    out.push({ lang, url: fileUrl(f.name) });
  }
  return out;
}

const toSec = (h: string, m: string, s: string, ms: string) => +h * 3600 + +m * 60 + +s + +ms.padEnd(3, '0').slice(0, 3) / 1000;

/** Reads SRT or WebVTT text into cues (HTML-ish tags removed). */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  const time = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => time.test(l));
    if (i === -1) continue;
    const m = time.exec(lines[i])!;
    const body = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .trim();
    if (!body) continue;
    cues.push({ start: toSec(m[1] ?? '0', m[2], m[3], m[4]), end: toSec(m[5] ?? '0', m[6], m[7], m[8]), text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cue showing at time t (binary search). */
export function cueAt(cues: Cue[], t: number): Cue | undefined {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].end < t) lo = mid + 1;
    else if (cues[mid].start > t) hi = mid - 1;
    else return cues[mid];
  }
  return undefined;
}
