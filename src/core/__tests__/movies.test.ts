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

describe('movie metadata', () => {
  it('reads IMDb ids and video quality', async () => {
    const { imdbIdFrom, qualityOf } = await import('../movies/archive');
    expect(imdbIdFrom(['urn:oclc:123', 'urn:imdb:tt0032599'])).toBe('tt0032599');
    expect(imdbIdFrom(undefined)).toBeUndefined();
    expect(qualityOf({ name: 'a.mp4', height: '1080' })).toBe('HD 1080p');
    expect(qualityOf({ name: 'a.mp4', height: '480' })).toBe('SD');
  });

  it('builds and parses the Wikidata credits query', async () => {
    const { creditsQuery, parseCredits } = await import('../movies/wikidata');
    expect(creditsQuery(['his_girl_friday'])).toContain('VALUES ?ia { "his_girl_friday" }');
    const c = parseCredits({
      results: {
        bindings: [{
          ia: { value: 'his_girl_friday' }, imdb: { value: 'tt0032599' },
          dirs: { value: 'Howard Hawks' }, casts: { value: 'Cary Grant|Rosalind Russell' },
          country: { value: 'United States' }, wiki: { value: 'https://en.wikipedia.org/wiki/His_Girl_Friday' },
        }],
      },
    });
    expect(c.get('his_girl_friday')).toEqual({
      imdbId: 'tt0032599', director: ['Howard Hawks'], cast: ['Cary Grant', 'Rosalind Russell'],
      country: 'United States', wikipedia: 'https://en.wikipedia.org/wiki/His_Girl_Friday',
    });
  });
});

describe('titles', () => {
  it('strips emoji from titles', async () => {
    const { stripEmoji } = await import('../movies/archive');
    expect(stripEmoji('כראמל 4 😺🐈')).toBe('כראמל 4');
    expect(stripEmoji('🏠 לבד בבית 5')).toBe('לבד בבית 5');
  });
});

describe('official channel films', () => {
  it('treats season and episode uploads as not films, keeps real films', async () => {
    const { isFilmTitle } = await import('../movies/youtube');
    expect(isFilmTitle('זמן אמת עונה 10')).toBe(false);
    expect(isFilmTitle('אויבים עונה 5')).toBe(false);
    expect(isFilmTitle('Ирония судьбы, 2 серия')).toBe(false);
    expect(isFilmTitle('Season 2 Episode 4')).toBe(false);
    expect(isFilmTitle('גבעת חלפון אינה עונה')).toBe(true);
    expect(isFilmTitle('Москва слезам не верит')).toBe(true);
    expect(isFilmTitle('Operation Thunderbolt')).toBe(true);
  });
});

describe('studio titles and genres', () => {
  it('cleans decorated titles and maps TMDB genres', async () => {
    const { tidyTitle, genresFromTmdb } = await import('../movies/youtube');
    expect(tidyTitle('Девчата (FullHD, комедия, реж. Юрий Чулюкин, 1961 г.)')).toBe('Девчата');
    expect(tidyTitle('The Shooter (Free ) Classic Western')).toBe('The Shooter');
    expect(tidyTitle('Москва слезам не верит (1 серия)')).toBe('Москва слезам не верит (1 серия)');
    expect(genresFromTmdb(['Thriller', 'Horror'])).toEqual(['Mystery & Thriller', 'Horror']);
    expect(genresFromTmdb([])).toBeUndefined();
  });
});

describe('new movies rule', () => {
  it('adds only films from 1990 on, with an open license', async () => {
    const { newEnough } = await import('../movies/types');
    const { openLicense, searchUrl } = await import('../movies/archive');
    expect(newEnough(1989)).toBe(false);
    expect(newEnough(undefined)).toBe(false);
    expect(newEnough(1990)).toBe(true);
    expect(newEnough(2024)).toBe(true);
    expect(openLicense('http://creativecommons.org/licenses/by-nc-nd/4.0/')).toBe(true);
    expect(openLicense('https://creativecommons.org/publicdomain/mark/1.0/')).toBe(true);
    expect(openLicense(undefined)).toBe(false);
    expect(decodeURIComponent(searchUrl(10, 1, 'addeddate desc', 1990))).toContain('year:[1990 TO 2100]');
  });
});

describe('north american titles', () => {
  it('keeps US and Canadian productions only', async () => {
    const { northAmerican } = await import('../movies/types');
    expect(northAmerican({ origin: ['US'] })).toBe(true);
    expect(northAmerican({ origin: ['GB', 'CA'] })).toBe(true);
    expect(northAmerican({ origin: ['KR'] })).toBe(false);
    expect(northAmerican({ country: 'United States of America' })).toBe(true);
    expect(northAmerican({ country: 'Canada' })).toBe(true);
    expect(northAmerican({ country: 'South Korea' })).toBe(false);
    expect(northAmerican({})).toBe(false);
  });
});

describe('archive license rule', () => {
  it('keeps old public-domain films and licensed recent ones only', async () => {
    const { archiveAllowed } = await import('../movies/types');
    expect(archiveAllowed({ source: 'archive', year: 1946 })).toBe(true);
    expect(archiveAllowed({ source: 'archive' })).toBe(true);
    expect(archiveAllowed({ source: 'archive', year: 2014 })).toBe(false);
    expect(archiveAllowed({ source: 'archive', year: 2014, license: 'http://creativecommons.org/licenses/by/4.0/' })).toBe(true);
    expect(archiveAllowed({ source: 'free', year: 2026 })).toBe(true);
  });
});
