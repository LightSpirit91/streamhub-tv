import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { Image } from 'expo-image';
import { Bell, BellRing, CalendarDays, Play, X } from 'lucide-react-native';
import type { Channel } from '../core/types';
import { splitDays, weekBucket, type Guide, type GuideDay, type Programme } from '../core/epg/xmltv';
import { streamhubEpgWeekUrl } from '../core/catalog/sources';
import { fetchText } from '../core/catalog/loader';
import { useStreamHub } from '../state/useStreamHub';
import { clock, useNow } from '../hooks/useNow';
import { Button, useFocusRing } from '../ui/primitives';
import { colors, fonts, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

// ---------------------------------------------------------------------------
// Data: the week-long guide file that holds this channel (cached ~3 hours).

const cache = new Map<number, { at: number; p: Promise<Record<string, Programme[]>> }>();
function loadBucket(b: number) {
  const hit = cache.get(b);
  if (hit && Date.now() - hit.at < 3 * 3_600_000) return hit.p;
  const p = fetchText(streamhubEpgWeekUrl(b), globalThis.fetch as never, 20_000).then((t) => (JSON.parse(t) as Guide).programs);
  p.catch(() => cache.delete(b));
  cache.set(b, { at: Date.now(), p });
  return p;
}

/** Everything published for a channel over the coming days (falls back to the short guide). */
export function useWeekSchedule(channelId: string) {
  const short = useStreamHub((s) => s.epg[channelId]);
  const [week, setWeek] = useState<Programme[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setWeek(undefined);
    loadBucket(weekBucket(channelId))
      .then((p) => alive && setWeek(p[channelId] ?? null))
      .catch(() => alive && setWeek(null));
    return () => {
      alive = false;
    };
  }, [channelId]);
  const list = week && week.length >= (short?.length ?? 0) ? week : short;
  return { list, loading: week === undefined && !short };
}

// ---------------------------------------------------------------------------

const dayTime = (p: Programme) => {
  const d = new Date(p[0] * 1000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${d} · ${clock(p[0])} – ${clock(p[1])}`;
};
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

interface Props {
  channel: Channel;
  onWatch(c: Channel): void;
  onClose(): void;
}

/**
 * A channel's full schedule for today and the coming days (up to a week,
 * as far as the broadcaster publishes). Big screens get a week grid:
 * one column per day, time running down. Phones get one day at a time.
 */
export function WeekGuide({ channel, onWatch, onClose }: Props) {
  const L = useLayout();
  const now = useNow();
  const { list, loading } = useWeekSchedule(channel.id);
  const days = useMemo(() => splitDays(list, now), [list, now]);
  const live = useMemo(() => list?.find((p) => p[0] <= now && p[1] > now), [list, now]);
  const [sel, setSel] = useState<Programme | undefined>(undefined);
  const shown = sel ?? live ?? days[0]?.items.find((p) => p[1] > now);

  // Escape / Back closes the schedule (screens underneath ignore keys while it is open).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    if (Platform.OS !== 'web') return () => sub.remove();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const w = globalThis as unknown as Window;
    w.addEventListener('keydown', onKey, true);
    return () => {
      sub.remove();
      w.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const lastDay = days[days.length - 1];
  const reach = days.length > 1 ? `Schedule through ${new Date(lastDay.start * 1000).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}` : days.length ? 'Schedule for today' : '';

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close schedule" />
      <View style={[styles.sheet, L.compact ? styles.sheetPhone : { width: Math.min(1280, L.width - 64), height: L.height - 64 }]}>
        <View style={styles.head}>
          {channel.logo ? <Image source={{ uri: channel.logo }} style={styles.logo} contentFit="contain" /> : <CalendarDays size={28} color={colors.gold} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>{channel.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{loading ? 'Loading the schedule…' : reach || 'TV schedule'}</Text>
          </View>
          {/* Phones: "Watch now" sits with what's on now, so the channel name gets the room. */}
          {!L.compact || (!loading && !days.length) ? (
            <Button variant="primary" label="Watch live" icon={<Play size={16} color="#17110A" fill="#17110A" />} onPress={() => onWatch(channel)} preferredFocus />
          ) : null}
          <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close schedule">
            <X size={20} color={colors.text} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
        ) : !days.length ? (
          <View style={styles.center}>
            <CalendarDays size={36} color={colors.textFaint} />
            <Text style={styles.emptyHead}>No schedule published for this channel</Text>
            <Text style={styles.emptyText}>Many free and international channels don't publish a TV guide. You can still watch it live.</Text>
          </View>
        ) : (
          <>
            {shown ? <Details channelId={channel.id} p={shown} now={now} onWatch={() => onWatch(channel)} /> : null}
            {L.compact ? (
              <DayList channelId={channel.id} days={days} now={now} sel={shown} onSelect={setSel} />
            ) : (
              <WeekGrid channelId={channel.id} days={days} now={now} sel={shown} onSelect={setSel} width={Math.min(1280, L.width - 64)} tv={L.ff === 'tv'} />
            )}
          </>
        )}
      </View>
    </View>
  );
}

/** What's selected: time, description, Watch now / Remind me. */
function Details({ channelId, p, now, onWatch }: { channelId: string; p: Programme; now: number; onWatch(): void }) {
  const reminders = useStreamHub((s) => s.reminders);
  const toggle = useStreamHub((s) => s.toggleReminder);
  const on = reminders.some((r) => r.channelId === channelId && r.start === p[0]);
  const isLive = p[0] <= now && p[1] > now;
  const past = p[1] <= now;
  return (
    <View style={styles.details}>
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Text style={[styles.dTime, isLive && { color: colors.gold }]}>{isLive ? `ON NOW · until ${clock(p[1])}` : dayTime(p)}</Text>
        <Text style={styles.dTitle} numberOfLines={2}>{p[2]}</Text>
        {p[4] ? <Text style={styles.dCat}>{p[4]}</Text> : null}
        {p[3] ? <Text style={styles.dDesc} numberOfLines={3}>{p[3]}</Text> : null}
      </View>
      {isLive ? (
        <Button label="Watch now" icon={<Play size={16} color={colors.text} />} onPress={onWatch} />
      ) : !past ? (
        <Button
          label={on ? 'Reminder set' : 'Remind me'}
          icon={on ? <BellRing size={16} color={colors.gold} /> : <Bell size={16} color={colors.text} />}
          onPress={() => {
            if (!on && Platform.OS === 'web') {
              const N = (globalThis as unknown as { Notification?: { permission: string; requestPermission(): Promise<string> } }).Notification;
              if (N && N.permission === 'default') N.requestPermission().catch(() => {});
            }
            toggle({ channelId, start: p[0], end: p[1], title: p[2] });
          }}
        />
      ) : (
        <Text style={styles.aired}>Aired</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Big screens: week grid (one column per day, time running down).

const GUTTER = 64;

function WeekGrid({ channelId, days, now, sel, onSelect, width, tv }: {
  channelId: string; days: GuideDay[]; now: number; sel?: Programme; onSelect(p: Programme): void; width: number; tv: boolean;
}) {
  const PX = tv ? 1.8 : 1.5; // pixels per minute
  const reminders = useStreamHub((s) => s.reminders);
  const remindSet = useMemo(() => new Set(reminders.filter((r) => r.channelId === channelId).map((r) => r.start)), [reminders, channelId]);
  const colW = Math.max(150, Math.floor((width - GUTTER - 24) / days.length));
  const scroll = useRef<ScrollViewInstance>(null);
  const today = days[0];
  const nowY = today && now >= today.start ? ((now - today.start) / 60) * PX : -1;

  // Open at the current time (an hour and a half of context above it).
  const placed = useRef(false);
  const toNow = () => {
    if (placed.current) return;
    placed.current = true;
    scroll.current?.scrollTo({ y: Math.max(0, nowY - 90 * PX), animated: false });
  };

  const height = 24 * 60 * PX;
  const grid = (
    <View style={{ flex: 1 }}>
      <View style={styles.dayHeads}>
        <View style={{ width: GUTTER }} />
        {days.map((d) => (
          <View key={d.start} style={[styles.dayHead, { width: colW }]}>
            <Text style={[styles.dayHeadText, d === today && { color: colors.gold }]}>{d.label}</Text>
          </View>
        ))}
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ height }} showsVerticalScrollIndicator onLayout={() => setTimeout(toNow, 0)}>
        <View style={{ flexDirection: 'row', height }}>
          <View style={{ width: GUTTER }}>
            {Array.from({ length: 24 }, (_, h) => (
              <Text key={h} style={[styles.hour, { top: h * 60 * PX - 7 }]}>{h ? hourLabel(h) : ''}</Text>
            ))}
          </View>
          {days.map((d) => (
            <View key={d.start} style={[styles.col, { width: colW, height }]}>
              {Array.from({ length: 24 }, (_, h) => (
                <View key={h} style={[styles.hourLine, { top: h * 60 * PX }]} />
              ))}
              {d.items.map((p) => {
                const top = (Math.max(0, p[0] - d.start) / 60) * PX;
                const bottom = (Math.min(24 * 3600, p[1] - d.start) / 60) * PX;
                return (
                  <Block
                    key={`${d.start}-${p[0]}`}
                    p={p}
                    top={top}
                    height={Math.max(18, bottom - top - 2)}
                    now={now}
                    selected={!!sel && sel[0] === p[0]}
                    reminder={remindSet.has(p[0])}
                    onSelect={onSelect}
                  />
                );
              })}
              {d === today && nowY >= 0 ? <View pointerEvents="none" style={[styles.nowLine, { top: nowY }]} /> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
  const fits = GUTTER + colW * days.length <= width - 24;
  return (
    <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 12 }}>
      {fits ? grid : (
        <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }} showsHorizontalScrollIndicator>
          <View style={{ width: GUTTER + colW * days.length, flex: 1 }}>{grid}</View>
        </ScrollView>
      )}
    </View>
  );
}

const Block = memo(function Block({ p, top, height, now, selected, reminder, onSelect }: {
  p: Programme; top: number; height: number; now: number; selected: boolean; reminder: boolean; onSelect(p: Programme): void;
}) {
  const f = useFocusRing();
  const isLive = p[0] <= now && p[1] > now;
  const past = p[1] <= now;
  return (
    <Pressable
      onPress={() => onSelect(p)}
      onFocus={() => {
        f.handlers.onFocus();
        onSelect(p);
      }}
      onBlur={f.handlers.onBlur}
      onHoverIn={f.handlers.onHoverIn}
      onHoverOut={f.handlers.onHoverOut}
      accessibilityRole="button"
      accessibilityLabel={`${clock(p[0])} ${p[2]}`}
      style={[
        styles.block,
        { top, height },
        isLive && styles.blockLive,
        past && { opacity: 0.45 },
        (selected || f.on) && styles.blockOn,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={[styles.bTime, isLive && { color: colors.gold }]} numberOfLines={1}>{isLive ? 'NOW' : clock(p[0])}</Text>
        {reminder ? <BellRing size={11} color={colors.gold} /> : null}
      </View>
      {height > 30 ? <Text style={styles.bTitle} numberOfLines={Math.max(1, Math.floor((height - 18) / 16))}>{p[2]}</Text> : null}
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Phones: one day at a time.

function DayList({ channelId, days, now, sel, onSelect }: {
  channelId: string; days: GuideDay[]; now: number; sel?: Programme; onSelect(p: Programme): void;
}) {
  const [idx, setIdx] = useState(0);
  const [earlier, setEarlier] = useState(false);
  const reminders = useStreamHub((s) => s.reminders);
  const toggle = useStreamHub((s) => s.toggleReminder);
  const day = days[Math.min(idx, days.length - 1)];
  const items = idx === 0 && !earlier ? day.items.filter((p) => p[1] > now) : day.items;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 10 }}>
        {days.map((d, i) => (
          <DayChip key={d.start} label={d.label} active={i === idx} onPress={() => setIdx(i)} />
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {idx === 0 && !earlier && items.length < day.items.length ? (
          <Pressable onPress={() => setEarlier(true)} style={styles.earlier}><Text style={styles.earlierText}>Show earlier today</Text></Pressable>
        ) : null}
        {items.map((p) => {
          const isLive = p[0] <= now && p[1] > now;
          const on = reminders.some((r) => r.channelId === channelId && r.start === p[0]);
          const selected = !!sel && sel[0] === p[0];
          return (
            <Pressable key={p[0]} onPress={() => onSelect(p)} style={[styles.row, selected && styles.rowOn, p[1] <= now && { opacity: 0.5 }]}>
              <Text style={[styles.rTime, isLive && { color: colors.gold }]}>{isLive ? 'NOW' : clock(p[0])}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.rTitle} numberOfLines={2}>{p[2]}</Text>
                {selected && p[3] ? <Text style={styles.rDesc}>{p[3]}</Text> : null}
              </View>
              {p[0] > now ? (
                <Pressable
                  onPress={() => toggle({ channelId, start: p[0], end: p[1], title: p[2] })}
                  style={[styles.bell, on && styles.bellOn]}
                  accessibilityLabel={on ? `Cancel reminder for ${p[2]}` : `Remind me when ${p[2]} starts`}
                >
                  {on ? <BellRing size={15} color="#1B140C" /> : <Bell size={15} color={colors.textDim} />}
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function DayChip({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} style={[styles.chip, active && styles.chipOn, f.on && { borderColor: colors.focus }]} accessibilityRole="button">
      <Text style={[styles.chipText, active && { color: '#17110A' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: colors.bgRaised, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.lineHi },
  sheetPhone: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 40, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, paddingRight: 64 },
  logo: { width: 52, height: 36 },
  title: { ...type.h2, color: colors.text, fontSize: 24 },
  sub: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 13, marginTop: 2 },
  close: {
    position: 'absolute', top: 18, right: 16, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32, minHeight: 240 },
  emptyHead: { color: colors.text, fontFamily: fonts.display, fontSize: 19, textAlign: 'center' },
  emptyText: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14, textAlign: 'center', maxWidth: 420 },
  details: {
    flexDirection: 'row', alignItems: 'center', gap: 16, marginHorizontal: 16, marginBottom: 12, padding: 14,
    borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  dTime: { color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.4 },
  dTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 18 },
  dCat: { color: colors.coral, fontFamily: fonts.bodySemi, fontSize: 12 },
  dDesc: { color: colors.textDim, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  aired: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 13 },
  dayHeads: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.lineHi },
  dayHead: { paddingVertical: 8, paddingHorizontal: 8, borderLeftWidth: 1, borderLeftColor: colors.line },
  dayHeadText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13 },
  hour: { position: 'absolute', right: 8, color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 11 },
  col: { borderLeftWidth: 1, borderLeftColor: colors.line, position: 'relative' },
  hourLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.line },
  block: {
    position: 'absolute', left: 3, right: 3, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden',
    backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.line,
  },
  blockLive: { backgroundColor: 'rgba(244,184,96,0.16)', borderColor: 'rgba(244,184,96,0.6)' },
  blockOn: { borderColor: colors.focus, borderWidth: 2 },
  bTime: { color: colors.textFaint, fontFamily: fonts.bodyBold, fontSize: 10.5 },
  bTitle: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 12.5, lineHeight: 16 },
  nowLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: colors.live },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.lineHi, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13 },
  earlier: { paddingVertical: 10 },
  earlierText: { color: colors.gold, fontFamily: fonts.bodyBold, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
  rowOn: { backgroundColor: colors.surface },
  rTime: { width: 70, color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 12.5 },
  rTitle: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 14.5 },
  rDesc: { color: colors.textDim, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, marginTop: 2 },
  bell: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  bellOn: { backgroundColor: colors.gold },
});
