import { describe, expect, it } from 'vitest';
import { parseDetails, pickSearchHit } from '../meta/tmdb';

describe('tmdb', () => {
  it('parses details into posters, cast, trailer and Canadian providers', () => {
    const m = parseDetails(
      {
        id: 3083,
        poster_path: '/p.jpg',
        backdrop_path: '/b.jpg',
        tagline: 'Love, scoops and deadlines',
        overview: 'A newspaper editor...',
        vote_average: 7.86,
        vote_count: 900,
        genres: [{ name: 'Comedy' }, { name: 'Romance' }],
        credits: { cast: [{ name: 'Rosalind Russell', character: 'Hildy', profile_path: '/r.jpg', order: 1 }, { name: 'Cary Grant', character: 'Walter', profile_path: '/c.jpg', order: 0 }] },
        videos: { results: [{ site: 'YouTube', type: 'Teaser', key: 'tease' }, { site: 'YouTube', type: 'Trailer', key: 'trail', official: true }] },
        'watch/providers': {
          results: {
            CA: { link: 'https://www.themoviedb.org/movie/3083/watch?locale=CA', free: [{ provider_name: 'Tubi', logo_path: '/t.png' }], flatrate: [{ provider_name: 'Crave', logo_path: '/cr.png' }] },
            US: { flatrate: [{ provider_name: 'Max' }] },
          },
        },
      },
      'movie',
      1,
    );
    expect(m.posterHi).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
    expect(m.backdrop).toBe('https://image.tmdb.org/t/p/w1280/b.jpg');
    expect(m.tmdbRating).toBe(7.9);
    expect(m.castPhotos?.[0]).toEqual({ name: 'Cary Grant', role: 'Walter', photo: 'https://image.tmdb.org/t/p/w185/c.jpg' });
    expect(m.trailer).toBe('https://www.youtube-nocookie.com/embed/trail');
    expect(m.watch?.providers.map((p) => `${p.name}:${p.type}`)).toEqual(['Tubi:free', 'Crave:stream']);
  });

  it('only accepts search hits with the same title and a close year', () => {
    const hits = [
      { id: 1, title: 'Detour', release_date: '1992-01-01' },
      { id: 2, title: 'Detour', release_date: '1945-11-30' },
      { id: 3, title: 'Detour 2', release_date: '1945-01-01' },
    ];
    expect(pickSearchHit(hits, 'Detour', 1945)?.id).toBe(2);
    expect(pickSearchHit(hits, 'The Detour', 1946)?.id).toBe(2);
    expect(pickSearchHit(hits, 'Detour', 1970)).toBeUndefined();
  });
});
