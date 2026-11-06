import { describe, expect, it } from 'vitest';
import { cleanText, genresFrom, pickVideoFile, searchUrl, toMovie } from '../movies/archive';

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

  it('queries the feature film collections', () => {
    expect(decodeURIComponent(searchUrl(10))).toContain('collection:(feature_films');
  });
});
