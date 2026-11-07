import { useEffect, useMemo, useState } from 'react';
import type { RefreshStatus } from '../core/refresh/history';
import { STREAMHUB_STATUS_URL } from '../core/catalog/sources';
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
          <RefreshPanel />
          <Text style={styles.note}>TV schedules: epgshare01, epg.pw, i.mjh.nz and iptv-org/epg. Channel details and logos: iptv-org/database.</Text>
        </ScrollView>
      </View>
    </View>
  );
}

const ago = (t: number) => {
  const h = Math.round((Date.now() - t) / 3_600_000);
  return h < 1 ? 'just now' : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/** Refresh settings, source health and history, from status.json (read only). */
function RefreshPanel() {
  const [st, setSt] = useState<RefreshStatus | null | 'error'>(null);
  useEffect(() => {
    fetch(STREAMHUB_STATUS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RefreshStatus) => setSt(d))
      .catch(() => setSt('error'));
  }, []);
  if (st === null) return <Text style={styles.note}>Loading refresh status…</Text>;
  if (st === 'error') return <Text style={styles.note}>Refresh status appears after the next nightly update.</Text>;
  const s = st.settings;
  const off = st.sources.filter((x) => x.off);
  const weak = st.sources.filter((x) => !x.off && x.links > 0 && x.working === 0);
  const working = st.sources.reduce((n, x) => n + x.working, 0);
  const links = st.sources.reduce((n, x) => n + x.links, 0);
  return (
    <View style={{ gap: 10 }} accessibilityLabel="Refresh and health">
      <Text style={styles.section}>Refresh & health</Text>
      <View style={styles.panel}>
        <Line k="Last update" v={ago(st.builtAt)} />
        <Line k="Channels refresh" v={`every ${s.channelsEveryHours} h`} />
        <Line k="TV guide refresh" v={`every ${s.guideEveryHours} h`} />
        <Line k="Playback check" v={s.deepCheck ? 'real video bytes, every link, every night' : 'playlist answers'} />
        <Line k="Bad links" v={`removed after ${s.failuresBeforeRemoval} failed nights, re-tested every ${s.recheckRemovedEveryDays} days`} />
        <Line k="Limits" v={`${s.maxRequestsPerRun.toLocaleString()} requests, ${s.maxRunMinutes} min per run · $0 (free GitHub minutes only)`} />
        <Line k="Daily discovery" v={!s.discovery ? 'off' : s.discoverySchedule === 'daily' ? 'on, daily' : 'manual (schedule waiting for your OK)'} />
        <Line k="Links working" v={`${working.toLocaleString()} of ${links.toLocaleString()} checked`} />
        {st.discovery ? <Line k="Last discovery" v={`${ago(st.discovery.at)} · ${st.discovery.repos} repos read · ${st.discovery.accepted} links added`} /> : null}
        <Line k="Snapshots" v={`${st.snapshots.length} nights kept for rollback`} />
      </View>
      {off.length || weak.length ? (
        <Text style={styles.note}>
          {off.length ? `Switched off (no working links for several nights, re-tried weekly): ${off.map((x) => x.id.replace(/^iptv-org:/, '')).join(', ')}. ` : ''}
          {weak.length ? `No working links last night: ${weak.map((x) => x.id.replace(/^iptv-org:/, '')).join(', ')}.` : ''}
        </Text>
      ) : null}
      <Text style={styles.leftName}>Recent updates</Text>
      {st.audit.slice(0, 8).map((a) => (
        <Text key={`${a.at}-${a.job}`} style={styles.leftWhy}>
          {new Date(a.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {a.job}
          {a.channels != null ? ` · ${a.channels.toLocaleString()} channels` : ''}
          {a.added || a.removed ? ` (+${a.added ?? 0} / -${a.removed ?? 0})` : ''}
          {a.discovered ? ` · ${a.discovered} links found` : ''}
          {a.note ? ` · ${a.note}` : ''}
        </Text>
      ))}
      <Text style={styles.note}>Change these in config/refresh.json in your GitHub repo. Roll back to an earlier night with the Rollback workflow.</Text>
    </View>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineK}>{k}</Text>
      <Text style={styles.lineV}>{v}</Text>
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
  panel: { padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: 8 },
  line: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  lineK: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12.5, width: 130 },
  lineV: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 12.5, flex: 1, minWidth: 160 },
  leftName: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13 },
  leftWhy: { color: colors.textDim, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
});
