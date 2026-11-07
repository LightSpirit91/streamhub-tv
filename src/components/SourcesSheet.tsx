import { useEffect, useMemo } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { SOURCE_GROUPS, groupCounts } from '../core/catalog/sourceGroups';
import { useStreamHub } from '../state/useStreamHub';
import { useFocusRing } from '../ui/primitives';
import { colors, fonts, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

/** Researched and not used, with the reason (see docs/SOURCES.md). No links. */
const LEFT_OUT: { name: string; why: string }[] = [
  { name: 'PPV playlists (PPVTV, ppv.land, chzw2025/ppv)', why: 'Unlicensed copies of pay-per-view and pay-TV channels from the ppv.to family of sites; links were expired, missing or placeholders. Off: no broadcaster permission.' },
  { name: 'PPV-EPG', why: 'Schedules copied from epgshare01, which StreamHub already reads directly.' },
  { name: 'Samsung TV Plus, Plex, YouTube', why: 'Removed at your request.' },
  { name: 'Kodi / webOS / Streamlink add-ons', why: 'Players and tools, not channel sources; several need your own paid accounts.' },
];

export function SourcesSheet({ onClose }: { onClose(): void }) {
  const L = useLayout();
  const raw = useStreamHub((s) => s.raw);
  const off = useStreamHub((s) => s.sourcesOff);
  const shown = useStreamHub((s) => s.channels.length);
  const setOn = useStreamHub((s) => s.setSourceOn);
  const counts = useMemo(() => groupCounts(raw), [raw]);

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

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close sources" />
      <View style={[styles.sheet, L.compact ? styles.sheetPhone : { width: Math.min(720, L.width - 64) }]}>
        <View style={styles.head}>
          <Text style={styles.title}>Channel sources</Text>
          <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close sources">
            <X size={20} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 0, gap: 12 }}>
          <Text style={styles.note}>{shown.toLocaleString()} channels shown. Turning a source off hides its links; channels that also come from another source keep playing from it. Saved on this device.</Text>
          {SOURCE_GROUPS.map((g) => (
            <SourceRow key={g.id} name={g.name} count={counts[g.id] ?? 0} credit={g.credit} license={g.license} about={g.about} on={!off.includes(g.id)} onToggle={(v) => setOn(g.id, v)} />
          ))}
          <Text style={[styles.section]}>Researched, not used</Text>
          {LEFT_OUT.map((x) => (
            <View key={x.name} style={styles.left}>
              <Text style={styles.leftName}>{x.name}</Text>
              <Text style={styles.leftWhy}>{x.why}</Text>
            </View>
          ))}
          <Text style={styles.note}>TV schedules: epgshare01, epg.pw, i.mjh.nz and iptv-org/epg. Channel details and logos: iptv-org/database.</Text>
        </ScrollView>
      </View>
    </View>
  );
}

function SourceRow({ name, count, credit, license, about, on, onToggle }: { name: string; count: number; credit: string; license: string; about: string; on: boolean; onToggle(v: boolean): void }) {
  const f = useFocusRing();
  return (
    <Pressable
      onPress={() => onToggle(!on)}
      {...f.handlers}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`Source ${name} ${on ? 'on' : 'off'}`}
      style={[styles.row, f.on && styles.rowOn]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.name}>{name} <Text style={styles.count}>{count.toLocaleString()} channels</Text></Text>
        <Text style={styles.about}>{about}</Text>
        <Text style={styles.credit}>{credit} · {license}</Text>
      </View>
      <View style={[styles.switch, on && styles.switchOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: colors.bgRaised, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.lineHi, maxHeight: '88%' },
  sheetPhone: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 40, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: undefined },
  head: { flexDirection: 'row', alignItems: 'center', padding: 18 },
  title: { ...type.h2, color: colors.text, flex: 1 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  note: { color: colors.textDim, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  rowOn: { borderColor: colors.focus },
  name: { color: colors.text, fontFamily: fonts.display, fontSize: 16 },
  count: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12 },
  about: { color: colors.textDim, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
  credit: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 11 },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: colors.surfaceHi, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: colors.ok },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textDim },
  knobOn: { backgroundColor: '#fff', alignSelf: 'flex-end' },
  section: { color: colors.text, fontFamily: fonts.display, fontSize: 15, marginTop: 6 },
  left: { gap: 2, paddingHorizontal: 4 },
  leftName: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13 },
  leftWhy: { color: colors.textDim, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
});
