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
const NOT_LIVE_EVENT = /highlight|replay|re-?airs?\b|classics?\b|rewind|recap|encore|best of|magazine|preview|previa\b|countdown|pre-?game|post-?game|analysis|originals\b|epic moments|\bdocs?\b|documentar|\bthe [^.:]{1,30} show\b|обзор|повтор|лучшее|resumen|repetición/i;
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

export type SportKind = 'fight' | 'soccer' | 'football' | 'hockey' | 'basketball' | 'baseball' | 'racing' | 'tennis' | 'golf' | 'other';

export const SPORT_KINDS: { id: SportKind; label: string }[] = [
  { id: 'fight', label: 'Fights' },
  { id: 'soccer', label: 'Soccer' },
  { id: 'football', label: 'Football' },
  { id: 'hockey', label: 'Hockey' },
  { id: 'basketball', label: 'Basketball' },
  { id: 'baseball', label: 'Baseball' },
  { id: 'racing', label: 'Racing' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'golf', label: 'Golf' },
  { id: 'other', label: 'More sports' },
];

const KIND_RULES: [SportKind, RegExp][] = [
  ['fight', /\b(UFC|PFL|Bellator|BKFC|Ringside|Prelims|Main Card|Weigh-?ins?|ONE Championship|Boxing|Boxeo|MMA|Fight Night|Top Rank|Golden Boy|Matchroom|Kickbox|GLORY|Wrestling|WWE|AEW|Lucha|Bare Knuckle|Muay Thai)\b|Бокс|ММА|Бои|רסלינג|אגרוף/i],
  ['football', /\bNFL\b|College Football|\bCFL\b|\bUFL\b|\bXFL\b|Super Bowl|American Football|F[uú]tbol Americano/i],
  ['soccer', /Premier League|La Liga|Liga MX|Champions League|Europa League|Serie A|Bundesliga|Ligue 1|\bMLS\b|\bFIFA\b|\bUEFA\b|Copa |Soccer|F[uú]tbol|Futbol|Футбол|РПЛ|כדורגל/i],
  ['hockey', /\bNHL\b|\bKHL\b|\bAHL\b|\bOHL\b|Hockey|Хоккей|КХЛ/i],
  ['basketball', /\bNBA\b|\bWNBA\b|College Basketball|\bNCAA[^.]*Basketball|EuroLeague|Basketball|Баскетбол|כדורסל/i],
  ['baseball', /\bMLB\b|Baseball|World Series|B[eé]isbol/i],
  ['racing', /Formula 1|\bF1\b|Grand Prix|NASCAR|IndyCar|MotoGP|Rally|Supercross|Motocross|Racing|Формула/i],
  ['tennis', /\bATP\b|\bWTA\b|Tennis|Wimbledon|US Open Tennis|Roland|Теннис/i],
  ['golf', /\bPGA\b|\bLPGA\b|\bLIV Golf|Golf|Masters Tournament|Ryder Cup/i],
];

/** Which sport an event is, from its title, guide category and channel. */
export function sportKind(title: string, category?: string, channel?: Pick<Channel, 'hubs' | 'name'>): SportKind {
  const text = `${title} ${category ?? ''}`;
  for (const [k, re] of KIND_RULES) if (re.test(text)) return k;
  if (channel?.hubs.includes('fight')) return 'fight';
  for (const [k, re] of KIND_RULES) if (channel && re.test(channel.name)) return k;
  return 'other';
}

/** A week of events for the Sports & Fights page (sports-week.json, built nightly). */
export interface SportsWeek {
  version: 1;
  builtAt: number;
  events: (SportEvent & { kind: SportKind })[];
}

export function sportsWeek(channels: Channel[], week: Record<string, Programme[] | undefined>, nowSec: number, max = 1500): SportsWeek {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const events = sportsEvents(channels, week, nowSec, 7 * 24)
    .slice(0, max)
    .map((e) => ({ ...e, kind: sportKind(e.title, e.category, byId.get(e.channelIds[0])) }));
  return { version: 1, builtAt: Date.now(), events };
}
