import { useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bell, Play, X } from 'lucide-react-native';
import type { Channel } from '../core/types';
import { SPORT_KINDS, sportKind, sportsEvents, type SportKind, type SportsWeek } from '../core/epg/sports';
import { STREAMHUB_SPORTS_URL } from '../core/catalog/sources';
import { useStreamHub } from '../state/useStreamHub';
import { useUi } from '../state/ui';
import { clock, useNow } from '../hooks/useNow';
import { useFocusRing } from '../ui/primitives';
import { colors, fonts, radius, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

type Ev = SportsWeek['events'][number];

let cache: { at: number; data: SportsWeek } | null = null;

/** The week of sports and fights, built nightly from every channel's TV guide. */
function useSportsWeek(): { events: Ev[]; loading: boolean } {
  const channels = useStreamHub((s) => s.channels);
  const epg = useStreamHub((s) => s.epg);
  const [data, setData] = useState<SportsWeek | null>(cache?.data ?? null);
  const [loading, setLoading] = useState(!cache);
  useEffect(() => {
    if (cache && Date.now() - cache.at < 3_600_000) return;
    let alive = true;
    fetch(STREAMHUB_SPORTS_URL)
      .then((r) => (r.ok ? (r.json() as Promise<SportsWeek>) : null))
      .then((d) => {
        if (!alive) return;
        if (d?.version === 1) {
          cache = { at: Date.now(), data: d };
          setData(d);
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  const events = useMemo(() => {
    const now = Date.now() / 1000;
    if (data?.events.length) return data.events.filter((e) => e.end > now);
    // Not built yet: the next 24 hours from the guide already on the device.
    const byId = new Map(channels.map((c) => [c.id, c]));
    return sportsEvents(channels, epg, now, 24).map((e) => ({ ...e, kind: sportKind(e.title, e.category, byId.get(e.channelIds[0])) }));
  }, [data, channels, epg]);
  return { events, loading };
}

function dayLabel(sec: number, nowSec: number): string {
  const d = new Date(sec * 1000);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(nowSec * 1000))) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

type Item = { kind: 'head'; key: string; label: string } | { kind: 'ev'; key: string; ev: Ev; chans: Channel[] };

export function SportsSheet({ onClose, onPlay }: { onClose(): void; onPlay(c: Channel, row: Channel[]): void }) {
  const L = useLayout();
  const byId = useStreamHub((s) => s.byId);
  const now = useNow();
  const { events, loading } = useSportsWeek();
  const [kind, setKind] = useState<SportKind | 'all'>('all');

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    if (Platform.OS !== 'web') return () => sub.remove();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

  // Only events on channels that play on this device.
  const playable = useMemo(
    () =>
      events
        .map((ev) => ({ ev, chans: ev.channelIds.map((id) => byId.get(id)).filter((c): c is Channel => !!c) }))
        .filter((x) => x.chans.length),
    [events, byId],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: playable.length };
    for (const x of playable) c[x.ev.kind] = (c[x.ev.kind] ?? 0) + 1;
    return c;
  }, [playable]);
  const items = useMemo(() => {
    const out: Item[] = [];
    let last = '';
    const live = (e: Ev) => e.start <= now && e.end > now;
    for (const x of playable.filter((p) => kind === 'all' || p.ev.kind === kind)) {
      const label = live(x.ev) ? 'Live now' : dayLabel(x.ev.start, now);
      if (label !== last) out.push({ kind: 'head', key: `h:${label}`, label });
      last = label;
      out.push({ kind: 'ev', key: x.ev.key, ev: x.ev, chans: x.chans });
    }
    return out;
  }, [playable, kind, now]);
  const sportsRow = useMemo(() => [...new Map(playable.flatMap((x) => x.chans).map((c) => [c.id, c])).values()], [playable]);

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close sports" />
      <View style={[styles.sheet, L.compact ? styles.sheetPhone : { width: Math.min(860, L.width - 64), height: '88%' }]}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Sports & Fights</Text>
            <Text style={styles.sub}>This week, from the TV guide of every channel here · your time zone</Text>
          </View>
          <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close sports">
            <X size={20} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8, paddingBottom: 10, alignItems: 'center' }}>
          {[{ id: 'all' as const, label: 'All' }, ...SPORT_KINDS].map((k) =>
            k.id === 'all' || counts[k.id] ? (
              <Chip key={k.id} label={`${k.label} ${counts[k.id] ?? 0}`} active={kind === k.id} onPress={() => setKind(k.id)} />
            ) : null,
          )}
        </ScrollView>
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(i) => i.key}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24 }}
          ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading the week…' : 'No sports found in the TV guide for this week yet.'}</Text>}
          renderItem={({ item }) =>
            item.kind === 'head' ? (
              <Text style={[styles.day, item.label === 'Live now' && { color: colors.live }]}>{item.label}</Text>
            ) : (
              <EventRow ev={item.ev} chans={item.chans} now={now} onPlay={(c) => onPlay(c, sportsRow)} />
            )
          }
        />
      </View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} accessibilityRole="button" accessibilityLabel={`Sport ${label}`} accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipOn, f.on && styles.focus]}>
      <Text style={[styles.chipText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const KIND_LABEL = Object.fromEntries(SPORT_KINDS.map((k) => [k.id, k.label]));

function EventRow({ ev, chans, now, onPlay }: { ev: Ev; chans: Channel[]; now: number; onPlay(c: Channel): void }) {
  const f = useFocusRing();
  const live = ev.start <= now && ev.end > now;
  const first = chans[0];
  return (
    <Pressable
      onPress={() => (live ? onPlay(first) : useUi.getState().openSchedule(first))}
      {...f.handlers}
      accessibilityRole="button"
      accessibilityLabel={`${live ? 'Watch live' : 'Schedule'}: ${ev.title} on ${first.name}`}
      style={[styles.row, f.on && styles.focus]}
    >
      <View style={styles.when}>
        {live ? <Text style={styles.live}>● LIVE</Text> : <Text style={styles.time}>{clock(ev.start)}</Text>}
        <Text style={styles.kind}>{KIND_LABEL[ev.kind]}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={styles.evTitle} numberOfLines={2}>{ev.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {first.name}
          {chans.length > 1 ? `  +${chans.length - 1} more` : ''}
          {ev.liveBroadcast && !live ? '  ·  live broadcast' : ''}
        </Text>
      </View>
      {live ? <Play size={18} color={colors.text} fill={colors.text} /> : <Bell size={18} color={colors.textDim} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: colors.bgRaised, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.lineHi },
  sheetPhone: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 40, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  head: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 12 },
  title: { ...type.h2, color: colors.text },
  sub: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12, marginTop: 2 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 14, height: 40, justifyContent: 'center', borderRadius: 999, borderWidth: 1.5, borderColor: colors.line },
  chipOn: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: colors.gold },
  chipText: { color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 13 },
  focus: { borderColor: colors.focus },
  day: { color: colors.text, fontFamily: fonts.display, fontSize: 15, marginTop: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, marginBottom: 8, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line, minHeight: 64 },
  when: { width: 78, gap: 3 },
  time: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 },
  live: { color: colors.live, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.5 },
  kind: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 11 },
  evTitle: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14.5 },
  meta: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 12 },
  empty: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14, padding: 20, textAlign: 'center' },
});
