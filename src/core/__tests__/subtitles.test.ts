import { describe, expect, it } from 'vitest';
import { cueAt, langFromFileName, normLang, parseSubtitles, subFilesOf } from '../subtitles';

describe('subtitles', () => {
  it('reads SRT and WebVTT', () => {
    const srt = '1\n00:00:01,500 --> 00:00:04,000\n<i>Hello</i> there\n\n2\n00:01:00,000 --> 00:01:02,250\nSecond line\nwraps\n';
    const c = parseSubtitles(srt);
    expect(c).toEqual([
      { start: 1.5, end: 4, text: 'Hello there' },
      { start: 60, end: 62.25, text: 'Second line\nwraps' },
    ]);
    const vtt = 'WEBVTT\n\n00:05.000 --> 00:07.000 align:center\nשלום\n';
    expect(parseSubtitles(vtt)).toEqual([{ start: 5, end: 7, text: 'שלום' }]);
    expect(cueAt(c, 2)?.text).toBe('Hello there');
    expect(cueAt(c, 30)).toBeUndefined();
    expect(cueAt(c, 61)?.start).toBe(60);
  });

  it('detects the four languages from tracks and file names', () => {
    expect(['eng', 'en-US', 'English', 'CC1', 'spa', 'Español', 'rus', 'Русский', 'heb', 'iw', 'עברית', 'fra'].map(normLang))
      .toEqual(['en', 'en', 'en', 'en', 'es', 'es', 'ru', 'ru', 'he', 'he', 'he', undefined]);
    expect(langFromFileName('Detour.1945.eng.srt')).toBe('en');
    expect(langFromFileName('detour_spanish.srt')).toBe('es');
    expect(langFromFileName('film.ru.vtt')).toBe('ru');
    expect(langFromFileName('film.srt')).toBe('en'); // English film, no tag
    expect(langFromFileName('film.srt', 'Russian')).toBe('ru');
    expect(langFromFileName('film.srt', 'French')).toBeUndefined();
    const files = [{ name: 'a.mp4' }, { name: 'a.eng.srt' }, { name: 'a.en.vtt' }, { name: 'a.spa.srt' }];
    expect(subFilesOf(files, (n) => `u/${n}`)).toEqual([{ lang: 'en', url: 'u/a.eng.srt' }, { lang: 'es', url: 'u/a.spa.srt' }]);
  });
});
