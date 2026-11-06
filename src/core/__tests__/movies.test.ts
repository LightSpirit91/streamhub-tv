import { describe, expect, it } from 'vitest';
import { classicBoost, cleanText, cleanTitle, languageOf, runtimeMinutes, titleKey, genresFrom, isWatchable, pickVideoFile, searchUrl, toMovie } from '../movies/archive';

describe('archive movies', () => {
  const files = [
    { name: 'night.ogv', format: 'Ogg Video', size: '300000000' },
    { name: 'night_512kb.mp4', format: '512Kb MPEG4', size: '200000000' },
    { name: 'night.mp4', format: 'h.264', size: '900000000' },
    { name: 'master.mp4', format: 'h.264', size: '9000000000' },
  ];

  it('picks the best streamable mp4 and skips giant masters', () => {
    expect(pickVideoFile(files)?.name).toBe('night.mp4');
    expect(pickVideoFile([{ name: 'a.ogv' }])).toBeUndefined();
  });

  it('maps subjects to genres', () => {
    expect(genresFrom(['Film Noir', 'crime'])).toContain('Crime & Noir');
    expect(genresFrom('zombies; horror')).toContain('Horror');
    expect(genresFrom(undefined, 'Untitled')).toEqual(['Drama']);
  });

  it('cleans HTML descriptions', () => {
    expect(cleanText('<p>A <b>classic</b> &amp; more</p>')).toBe('A classic & more');
  });

  it('builds a movie with direct mp4 URL and poster', () => {
    const m = toMovie(
      { identifier: 'night_of_the_living_dead', title: 'Night of the Living Dead', year: '1968', downloads: 9, subject: ['horror'] },
      files,
    )!;
    expect(m.url).toBe('https://archive.org/download/night_of_the_living_dead/night.mp4');
    expect(m.poster).toBe('https://archive.org/services/img/night_of_the_living_dead');
    expect(m.year).toBe(1968);
    expect(m.genres).toContain('Horror');
  });

  it('keeps exploitation, adult and non-film uploads out', () => {
    expect(isWatchable({ title: 'Sex Madness' })).toBe(false);
    expect(isWatchable({ title: 'Diary of a Nudist' })).toBe(false);
    expect(isWatchable({ title: 'Reefer Madness' })).toBe(false);
    expect(isWatchable({ title: 'Three Stooges Episodes' })).toBe(false);
    expect(isWatchable({ title: 'His Girl Friday', subject: ['comedy'] })).toBe(true);
    expect(isWatchable({ title: 'Night of the Living Dead' })).toBe(true);
  });

  it('cleans messy upload titles so duplicates merge', () => {
    expect(cleanTitle('ANGEL AND THE BADMAN video quality upgrade')).toBe('Angel and the Badman');
    expect(cleanTitle("Gulliver's Travels [720p]")).toBe("Gulliver's Travels");
    expect(cleanTitle('Carnival of Souls (1962)')).toBe('Carnival of Souls');
    expect(titleKey('The General (complete & clearer) (1926)')).toBe(titleKey('The General'));
  });

  it('floats well-known classics to the top', () => {
    expect(classicBoost('His Girl Friday')).toBeGreaterThan(1);
    expect(classicBoost('Some Unknown Film')).toBe(1);
  });

  it('reads language and runtime, drops shorts', () => {
    expect(languageOf('rus')).toBe('Russian');
    expect(languageOf(['English', 'Spanish'])).toBe('Spanish');
    expect(languageOf('eng')).toBe('English');
    expect(runtimeMinutes('1:25:33')).toBe(85);
    expect(runtimeMinutes('72 min')).toBe(72);
    expect(toMovie({ identifier: 'x', title: 'A Short', runtime: '8 min' }, files)).toBeNull();
    const m = toMovie({ identifier: 'p', title: 'Battleship Potemkin', year: '1925', language: 'Russian', runtime: '1:15:00' }, files)!;
    expect(m.language).toBe('Russian');
    expect(m.genres).toContain('Silent Era');
  });

  it('queries the feature film collections', () => {
    expect(decodeURIComponent(searchUrl(10))).toContain('collection:(feature_films');
  });
});
