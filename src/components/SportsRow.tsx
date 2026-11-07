import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, Play } from 'lucide-react-native';
import type { Channel } from '../core/types';
import { sportsEvents, type SportEvent } from '../core/epg/sports';
import { useStreamHub } from '../state/useStreamHub';
import { useUi } from '../state/ui';
import { clock, useNow } from '../hooks/useNow';
import { Row } from './Row';
import { useFocusRing } from '../ui/primitives';
import { colors, fonts, radius } from '../ui/theme';

/** "Today 7:30 PM", "Tomorrow 1:00 PM", "Sat 3:00 PM": always in this device's time zone. */
function when(sec: number, nowSec: number): string {
  const d = new Date(sec * 1000);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(nowSec * 1000))) / 86_400_000);
  const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short' });
  return `${label} ${clock(sec)}`;
}

/**
 * Live and upcoming sports from the TV guides of channels that play here.
 * Live: plays the channel. Upcoming: opens the channel's schedule (Remind me).
 */
export function SportsRow({ width, gutter, onPlay }: { width: number; gutter: number; onPlay(c: Channel, row: Channel[]): void }) {
  const channels = useStreamHub((s) => s.channels);
  const byId = useStreamHub((s) => s.byId);
  const epg = useStreamHub((s) => s.epg);
  const now = useNow();
  const events = useMemo(() => sportsEvents(channels, epg, now, 24).slice(0, 40), [channels, epg, now]);
  const sportsRow = useMemo(() => channels.filter((c) => c.hubs.includes('sports') || c.hubs.includes('fight')), [channels]);
  if (!events.length) return null;
  return (
    <Row
      onSeeAll={() => useUi.getState().setSports(true)}
      title="Live & Upcoming Sports"
      subtitle="from the TV guide · your time zone"
      accent={colors.live}
      data={events}
      keyOf={(e) => e.key}
      gutter={gutter}
      render={(e) => <EventCard ev={e} width={width} now={now} byId={byId} onPlay={(c) => onPlay(c, sportsRow)} />}
    />
  );
}

function EventCard({ ev, width, now, byId, onPlay }: { ev: SportEvent; width: number; now: number; byId: Map<string, Channel>; onPlay(c: Channel): void }) {
  const f = useFocusRing();
  const chans = ev.channelIds.map((id) => byId.get(id)).filter((c): c is Channel => !!c);
  const live = ev.start <= now && ev.end > now;
  const first = chans[0];
  if (!first) return null;
  const progress = live ? Math.min(1, (now - ev.start) / Math.max(1, ev.end - ev.start)) : 0;
  return (
    <Pressable
      onPress={() => (live ? onPlay(first) : useUi.getState().openSchedule(first))}
      {...f.handlers}
      accessibilityRole="button"
      accessibilityLabel={`${live ? 'Watch live' : 'Schedule'}: ${ev.title} on ${first.name}`}
      style={[styles.card, { width }, f.on && styles.cardOn]}
    >
      <View style={styles.top}>
        {live ? <Text style={styles.live}>● LIVE</Text> : <Text style={styles.time}>{when(ev.start, now)}</Text>}
        {live ? <Play size={14} color={colors.text} fill={colors.text} /> : <Bell size={14} color={colors.textDim} />}
      </View>
      <Text style={styles.title} numberOfLines={2}>{ev.title}</Text>
      <Text style={styles.meta} numberOfLines={1}>
        {first.name}{chans.length > 1 ? `  +${chans.length - 1} more` : ''}
      </Text>
      <Text style={[styles.tag, live ? { color: colors.ok } : null]}>{live ? 'Plays here now' : `Starts ${clock(ev.start)} · tap for schedule`}</Text>
      {live ? <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} /></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginRight: 16, padding: 14, gap: 6, borderRadius: radius.lg, backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: colors.line, minHeight: 138,
  },
  cardOn: { borderColor: colors.focus, transform: [{ scale: 1.03 }] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  live: { color: colors.live, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.6 },
  time: { color: colors.gold, fontFamily: fonts.bodyBold, fontSize: 12 },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 16, lineHeight: 21 },
  meta: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 12.5 },
  tag: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 11.5 },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 2 },
  fill: { height: '100%', backgroundColor: colors.live },
});
