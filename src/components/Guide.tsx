import { StyleSheet, Text, View } from 'react-native';
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

/** Full schedule list for the preview panel and player. */
export function Schedule({ channelId, now, max = 6 }: { channelId: string; now: number; max?: number }) {
  const { now: cur, next } = useProgramme(channelId, now);
  const items = [cur, ...next].filter(Boolean).slice(0, max) as Programme[];
  if (!items.length) return <Text style={styles.empty}>No schedule published for this channel.</Text>;
  return (
    <View style={{ gap: 2 }}>
      {items.map((p, i) => (
        <View key={`${p[0]}-${i}`} style={styles.item}>
          <Text style={[styles.itemTime, i === 0 && cur && { color: colors.gold }]}>{i === 0 && cur ? 'NOW' : clock(p[0])}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.itemTitle} numberOfLines={1}>{p[2]}</Text>
            {i === 0 && p[3] ? <Text style={styles.itemDesc} numberOfLines={2}>{p[3]}</Text> : null}
          </View>
        </View>
      ))}
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
  item: { flexDirection: 'row', gap: 14, paddingVertical: 6 },
  itemTime: { width: 64, color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 12, paddingTop: 1 },
  itemTitle: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 14 },
  itemDesc: { color: colors.textDim, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
});
