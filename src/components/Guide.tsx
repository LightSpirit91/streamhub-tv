import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, BellRing } from 'lucide-react-native';
import type { Programme } from '../core/epg/xmltv';
import { nowNext } from '../core/epg/xmltv';
import { useStreamHub } from '../state/useStreamHub';
import { clock } from '../hooks/useNow';
import { colors, fonts } from '../ui/theme';

/** Now / next for one channel, from the TV guide. */
export function useProgramme(channelId: string, now: number) {
  const list = useStreamHub((s) => s.epg[channelId]);
  return nowNext(list, now);
}

export function progressOf(p: Programme | undefined, now: number): number {
  if (!p) return 0;
  return Math.max(0, Math.min(1, (now - p[0]) / Math.max(1, p[1] - p[0])));
}

export function ProgressLine({ value, color = colors.gold }: { value: number; color?: string }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.round(value * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

/** A guide cell: time, title, optional progress. Used in the Live TV grid. */
export function ProgramCell({ p, now, live, flex = 1 }: { p?: Programme; now: number; live?: boolean; flex?: number }) {
  if (!p) return <View style={[styles.cell, { flex }]} />;
  return (
    <View style={[styles.cell, { flex }, live && styles.cellLive]}>
      <Text style={[styles.time, live && { color: colors.gold }]} numberOfLines={1}>
        {live ? 'NOW' : clock(p[0])}
      </Text>
      <Text style={styles.title} numberOfLines={1}>{p[2]}</Text>
      {live ? <ProgressLine value={progressOf(p, now)} /> : null}
    </View>
  );
}

/** Asks the browser for notification permission the first time a reminder is set. */
function askNotify() {
  if (Platform.OS !== 'web') return;
  const N = (globalThis as unknown as { Notification?: { permission: string; requestPermission(): Promise<string> } }).Notification;
  if (N && N.permission === 'default') N.requestPermission().catch(() => {});
}

/** Full schedule list for the preview panel and player. Tap the bell to get reminded. */
export function Schedule({ channelId, now, max = 6 }: { channelId: string; now: number; max?: number }) {
  const { now: cur, next } = useProgramme(channelId, now);
  const reminders = useStreamHub((s) => s.reminders);
  const toggle = useStreamHub((s) => s.toggleReminder);
  const items = [cur, ...next].filter(Boolean).slice(0, max) as Programme[];
  if (!items.length) return <Text style={styles.empty}>No schedule published for this channel.</Text>;
  return (
    <View style={{ gap: 2 }}>
      {items.map((p, i) => {
        const live = i === 0 && !!cur;
        const on = reminders.some((r) => r.channelId === channelId && r.start === p[0]);
        return (
          <View key={`${p[0]}-${i}`} style={styles.item}>
            <Text style={[styles.itemTime, live && { color: colors.gold }]}>{live ? 'NOW' : clock(p[0])}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.itemTitle} numberOfLines={1}>{p[2]}</Text>
              {i === 0 && p[3] ? <Text style={styles.itemDesc} numberOfLines={2}>{p[3]}</Text> : null}
            </View>
            {!live ? (
              <Pressable
                onPress={() => {
                  if (!on) askNotify();
                  toggle({ channelId, start: p[0], end: p[1], title: p[2] });
                }}
                style={[styles.bell, on && styles.bellOn]}
                accessibilityLabel={on ? `Cancel reminder for ${p[2]}` : `Remind me when ${p[2]} starts`}
              >
                {on ? <BellRing size={15} color="#1B140C" /> : <Bell size={15} color={colors.textDim} />}
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%' },
  cell: {
    minWidth: 0, paddingHorizontal: 10, paddingVertical: 6, borderLeftWidth: 1, borderLeftColor: colors.line,
    justifyContent: 'center',
  },
  cellLive: { backgroundColor: 'rgba(242,193,78,0.06)' },
  time: { color: colors.textFaint, fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.6 },
  title: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 13, marginTop: 2 },
  empty: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 13 },
  item: { flexDirection: 'row', gap: 14, paddingVertical: 6, alignItems: 'center' },
  bell: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  bellOn: { backgroundColor: colors.gold },
  itemTime: { width: 64, color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 12, paddingTop: 1 },
  itemTitle: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 14 },
  itemDesc: { color: colors.textDim, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
});
