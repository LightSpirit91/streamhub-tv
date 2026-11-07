/**
 * Live and upcoming sports events, found in the TV guides of channels that
 * play in StreamHub. Schedules only come from those guides: no external
 * event lists and no links to other websites.
 */
import type { Channel } from '../types';
import type { Programme } from './xmltv';

export interface SportEvent {
  key: string;
  title: string;
  start: number;
  end: number;
  category?: string;
  /** Channels showing it (playable in StreamHub), best first. */
  channelIds: string[];
  /** The guide marks it as a live broadcast (not a replay). */
  liveBroadcast: boolean;
}

const SPORT_CATEGORY = /sport|football|soccer|hockey|basketball|baseball|boxing|mma|ufc|wrestling|tennis|golf|racing|motor|rugby|cricket|fútbol|futbol|deporte|спорт|футбол|хоккей|бокс|ספורט|כדורגל/i;
const EVENT = new RegExp(
  [
    '\\b(vs\\.?|v\\.?)\\s', '\\s@\\s', '\\bat\\s+[A-Z]', // "A vs B", "A @ B", "A at B"
    'UFC', 'PFL', 'Bellator', 'BKFC', '\\bBoxing\\b', 'Fight Night', '\\bMMA\\b', 'Top Rank', 'Golden Boy',
    '\\bNFL\\b', '\\bNBA\\b', '\\bNHL\\b', '\\bMLB\\b', '\\bMLS\\b', '\\bNCAA', 'College Football', 'College Basketball',
    'Premier League', 'La Liga', 'Liga MX', 'Champions League', 'Europa League', 'Serie A', 'Bundesliga', 'Ligue 1', 'Copa ',
    'Formula 1', '\\bF1\\b', 'Grand Prix', 'NASCAR', 'IndyCar', 'MotoGP', '\\bATP\\b', '\\bWTA\\b', '\\bPGA\\b', 'Rugby', 'Cricket',
    '\\bKHL\\b', 'КХЛ', 'РПЛ', 'Футбол\\.', 'Хоккей\\.', 'Бокс\\.', 'ММА', 'Fútbol', 'Partido',
  ].join('|'),
  'i',
);
const NOT_LIVE_EVENT = /highlight|replay|re-?airs?\b|classics?\b|rewind|recap|encore|best of|magazine|preview|countdown|pre-?game|post-?game|analysis|обзор|повтор|лучшее|resumen|repetición/i;
const LIVE_MARK = /\blive\b|en vivo|en directo|прямая трансляция|прямой эфир|\bLIVE\b|שידור חי/i;

/** Normalised title for merging the same event shown on several channels. */
const norm = (t: string) => t.toLowerCase().replace(/\b(live|en vivo|hd)\b/g, '').replace(/[^a-z0-9а-яё֐-׿]+/g, '');

export function isSportEvent(p: Programme, channel?: Channel): boolean {
  const [, , title, desc, cat] = p;
  if (NOT_LIVE_EVENT.test(title)) return false;
  const sportish = SPORT_CATEGORY.test(cat ?? '') || !!channel?.hubs.some((h) => h === 'sports' || h === 'fight');
  return sportish && (EVENT.test(title) || (LIVE_MARK.test(title) && SPORT_CATEGORY.test(`${cat ?? ''} ${desc ?? ''}`)));
}

/**
 * Events on now or starting within `hours`, one entry per event (merged
 * across channels), live ones first, then by start time.
 */
export function sportsEvents(channels: Channel[], epg: Record<string, Programme[] | undefined>, nowSec: number, hours = 24): SportEvent[] {
  const until = nowSec + hours * 3600;
  const byKey = new Map<string, SportEvent>();
  for (const ch of channels) {
    for (const p of epg[ch.id] ?? []) {
      if (p[1] <= nowSec || p[0] > until || !isSportEvent(p, ch)) continue;
      const key = `${norm(p[2])}|${Math.round(p[0] / 900)}`;
      const ev = byKey.get(key);
      if (ev) {
        if (!ev.channelIds.includes(ch.id)) ev.channelIds.push(ch.id);
        continue;
      }
      byKey.set(key, { key, title: p[2], start: p[0], end: p[1], category: p[4], channelIds: [ch.id], liveBroadcast: LIVE_MARK.test(`${p[2]} ${p[3] ?? ''}`) });
    }
  }
  const live = (e: SportEvent) => e.start <= nowSec && e.end > nowSec;
  return [...byKey.values()].sort((a, b) => Number(live(b)) - Number(live(a)) || a.start - b.start);
}
