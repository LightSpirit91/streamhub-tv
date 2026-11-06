import { describe, expect, it } from 'vitest';
import { episodeFiles, itemToShowParts, seasonEpisode, splitEpisodeTitle } from '../shows/archive';

describe('classic TV shows', () => {
  it('splits series and episode titles', () => {
    expect(splitEpisodeTitle('Dragnet - The Big Seventeen (1952)')).toEqual({ series: 'Dragnet', episode: 'The Big Seventeen' });
    expect(splitEpisodeTitle('Bonanza: The Spitfire')).toEqual({ series: 'Bonanza', episode: 'The Spitfire' });
  });

  it('reads season and episode numbers', () => {
    expect(seasonEpisode('lucy_s01e05.mp4')).toEqual({ season: 1, episode: 5 });
    expect(seasonEpisode('Episode 12')).toEqual({ episode: 12 });
  });

  it('keeps one best file per episode', () => {
    const f = episodeFiles([
      { name: 'ep1.mp4', format: 'h.264' }, { name: 'ep1_512kb.mp4', format: '512Kb MPEG4' },
      { name: 'ep2_512kb.mp4', format: '512Kb MPEG4' }, { name: 'ep2.ogv', format: 'Ogg Video' },
    ]);
    expect(f.map((x) => x.name)).toEqual(['ep1.mp4', 'ep2_512kb.mp4']);
  });

  it('turns a multi-file item into a series with numbered episodes', () => {
    const p = itemToShowParts(
      { identifier: 'beverly_hillbillies_s1', title: 'The Beverly Hillbillies - Season 1', downloads: 50 },
      [{ name: 'BH_S01E01.mp4', format: 'h.264' }, { name: 'BH_S01E02.mp4', format: 'h.264' }],
    )!;
    expect(p.show.title).toBe('The Beverly Hillbillies');
    expect(p.episodes).toHaveLength(2);
    expect(p.episodes[1]).toMatchObject({ season: 1, episode: 2 });
  });
});
