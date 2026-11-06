import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Expand, Heart, Volume2, VolumeX } from 'lucide-react-native';
import type { Channel, HubId } from '../core/types';
import { HUBS, HUB_BY_ID } from '../core/catalog/hubs';
import { useStreamHub } from '../state/useStreamHub';
import StreamVideo from '../player/StreamVideo';
import { initials } from '../components/ChannelCard';
import { Button, CountryTag, LiveBadge, QualityBadge, useFocusRing } from '../ui/primitives';
import { colors, fonts, qualityLabel, radius, type } from '../ui/theme';
import { useLayout } from '../ui/layout';
import { ProgramCell, Schedule, useProgramme } from '../components/Guide';
import { useNow } from '../hooks/useNow';

const ROW_H = 68;
const TUNE_DELAY = 550;

interface Props {
  initialHub?: HubId | null;
  onFullscreen(c: Channel, row: Channel[]): void;
}

/**
 * Live TV: the cable-box experience. A numbered channel guide on one side,
 * the selected channel playing live on the other. Up/Down surfs, Enter or
 * OK goes fullscreen.
 */
export function LiveTVScreen({ initialHub, onFullscreen }: Props) {
  const L = useLayout();
  const channels = useStreamHub((s) => s.channels);
  const favorites = useStreamHub((s) => s.favorites);
  const [hub, setHub] = useState<HubId | 'all' | 'mylist'>(initialHub ?? 'all');
  useEffect(() => {
    if (initialHub) setHub(initialHub);
  }, [initialHub]);

  // Stable channel numbers across the whole lineup, in hub order.
  const numbers = useMemo(() => {
    const m = new Map<string, number>();
    let n = 1;
    for (const h of HUBS) for (const c of channels) if (c.hubs.includes(h.id) && !m.has(c.id)) m.set(c.id, n++);
    for (const c of channels) if (!m.has(c.id)) m.set(c.id, n++);
    return m;
  }, [channels]);

  const list = useMemo(() => {
    let l: Channel[];
    if (hub === 'all') l = [...channels];
    else if (hub === 'mylist') l = channels.filter((c) => favorites.includes(c.id));
    else l = channels.filter((c) => c.hubs.includes(hub));
    return l.sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));
  }, [hub, channels, favorites, numbers]);

  const [sel, setSel] = useState(0);
  const [tuned, setTuned] = useState<Channel | undefined>(list[0]);
  const listRef = useRef<FlatList<Channel>>(null);
  const tuneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setSel(0);
    setTuned(list[0]);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [hub]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback(
    (i: number, scroll: boolean) => {
      const c = list[i];
      if (!c) return;
      setSel(i);
      if (scroll) listRef.current?.scrollToIndex({ index: i, viewPosition: 0.4, animated: true });
      clearTimeout(tuneTimer.current);
      tuneTimer.current = setTimeout(() => setTuned(c), TUNE_DELAY);
    },
    [list],
  );

  // Keyboard surfing on Mac / PC.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowDown') select(Math.min(list.length - 1, sel + 1), true);
      else if (e.key === 'ArrowUp') select(Math.max(0, sel - 1), true);
      else if (e.key === 'PageDown') select(Math.min(list.length - 1, sel + 10), true);
      else if (e.key === 'PageUp') select(Math.max(0, sel - 10), true);
      else if (e.key === 'Enter' && list[sel]) onFullscreen(list[sel], list);
      else return;
      e.preventDefault();
    };
    const w = globalThis as unknown as Window;
    w.addEventListener('keydown', onKey);
    return () => w.removeEventListener('keydown', onKey);
  }, [sel, list, select, onFullscreen]);

  const wide = !L.compact && L.ff !== 'tablet';
  const current = list[sel];
  const now = useNow();

  const filters: { id: HubId | 'all' | 'mylist'; label: string; color: string }[] = [
    { id: 'all', label: 'All channels', color: colors.gold },
    { id: 'mylist', label: 'My List', color: colors.gold },
    ...HUBS.filter((h) => h.id !== 'spotlight').map((h) => ({ id: h.id, label: h.title, color: h.accent })),
  ];

  const preview = (
    <View style={[styles.preview, wide ? { flex: 1 } : { aspectRatio: 16 / 9 }]}>
      {tuned ? <Preview key={tuned.id} channel={tuned} /> : null}
      {current && (
        <View style={styles.previewInfo}>
          <View style={styles.infoRow}>
            <LiveBadge />
            <Text style={styles.chNumBig}>{numbers.get(current.id)}</Text>
          </View>
          <Text style={[styles.previewTitle, L.compact && { fontSize: 22 }]} numberOfLines={1}>{current.name}</Text>
          <View style={styles.infoRow}>
            <CountryTag country={current.country} />
            <QualityBadge label={qualityLabel(current.bestHeight)} />
            {current.hubs
              .filter((h) => h !== 'spotlight')
              .slice(0, 2)
              .map((h) => (
                <Text key={h} style={[styles.hubTag, { color: HUB_BY_ID[h].accent }]}>{HUB_BY_ID[h].title}</Text>
              ))}
          </View>
          {current.tagline ? <Text style={styles.tagline}>{current.tagline}</Text> : null}
          {wide ? (
            <View style={styles.schedule}>
              <Schedule channelId={current.id} now={now} max={5} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Button
              variant="primary"
              label="Watch fullscreen"
              icon={<Expand size={16} color="#17110A" />}
              onPress={() => onFullscreen(current, list)}
            />
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: L.gutter, gap: 8, paddingVertical: 8 }}
      >
        {filters.map((f) => (
          <FilterChip key={f.id} label={f.label} color={f.color} active={hub === f.id} onPress={() => setHub(f.id)} />
        ))}
      </ScrollView>

      <View style={[styles.body, { paddingHorizontal: L.gutter }, wide ? { flexDirection: 'row' } : { flexDirection: 'column' }]}>
        {!wide && preview}
        <View style={[styles.guide, wide ? { width: Math.min(820, L.width * 0.56) } : { flex: 1 }]}>
          <Text style={styles.guideHead}>
            {list.length.toLocaleString()} channels{Platform.OS === 'web' && wide ? '  ·  Use ↑ ↓ to surf, Enter for fullscreen' : ''}
          </Text>
          <FlatList
            ref={listRef}
            data={list}
            keyExtractor={(c) => c.id}
            getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
            initialNumToRender={14}
            windowSize={9}
            renderItem={({ item, index }) => (
              <GuideRow
                channel={item}
                grid={wide}
                number={numbers.get(item.id) ?? 0}
                selected={index === sel}
                favorite={favorites.includes(item.id)}
                onSelect={() => select(index, false)}
                onOpen={() => (index === sel ? onFullscreen(item, list) : select(index, false))}
              />
            )}
            ListEmptyComponent={<Text style={styles.empty}>Nothing here yet. Add channels to My List with the heart in the player.</Text>}
          />
        </View>
        {wide && preview}
      </View>
    </View>
  );
}

const Preview = memo(function Preview({ channel }: { channel: Channel }) {
  const [idx, setIdx] = useState(0);
  const [muted, setMuted] = useState(false);
  const [down, setDown] = useState(false);
  const stream = channel.streams[idx];
  const report = useStreamHub((s) => s.reportStream);
  return (
    <View style={StyleSheet.absoluteFill}>
      {stream && !down ? (
        <StreamVideo
          stream={stream}
          attempt={0}
          muted={muted}
          volume={1}
          paused={false}
          fit="contain"
          pipRequest={0}
          onPlaying={() => report(stream.url, true)}
          onError={() => {
            report(stream.url, false);
            if (idx + 1 < channel.streams.length) setIdx(idx + 1);
            else setDown(true);
          }}
          onAutoMuted={() => setMuted(true)}
        />
      ) : (
        <View style={styles.offline}>
          <Text style={styles.offlineHead}>Channel offline</Text>
          <Text style={styles.offlineText}>Surf to another channel, or try it fullscreen to keep retrying.</Text>
        </View>
      )}
      <Pressable style={styles.mute} onPress={() => setMuted((m) => !m)} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
        {muted ? <VolumeX size={18} color="#fff" /> : <Volume2 size={18} color="#fff" />}
      </Pressable>
    </View>
  );
});

const GuideRow = memo(function GuideRow({
  channel, number, selected, favorite, grid, onSelect, onOpen,
}: { channel: Channel; number: number; selected: boolean; favorite: boolean; grid: boolean; onSelect(): void; onOpen(): void }) {
  const f = useFocusRing();
  const [logoFailed, setLogoFailed] = useState(false);
  const now = useNow();
  const { now: cur, next } = useProgramme(channel.id, now);
  return (
    <Pressable
      onPress={onOpen}
      onFocus={() => {
        f.handlers.onFocus();
        onSelect();
      }}
      onBlur={f.handlers.onBlur}
      onHoverIn={f.handlers.onHoverIn}
      onHoverOut={f.handlers.onHoverOut}
      style={[styles.row, selected && styles.rowSel, f.on && !selected && styles.rowHover]}
    >
      <Text style={[styles.num, selected && { color: colors.gold }]}>{number}</Text>
      <View style={styles.rowLogo}>
        {channel.logo && !logoFailed ? (
          <Image source={{ uri: channel.logo }} style={{ width: '80%', height: '70%' }} contentFit="contain" onError={() => setLogoFailed(true)} recyclingKey={channel.id} />
        ) : (
          <Text style={styles.rowInitials}>{initials(channel.name)}</Text>
        )}
      </View>
      <View style={{ width: grid ? 190 : undefined, flex: grid ? undefined : 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={[styles.rowName, selected && { color: '#fff' }, { flexShrink: 1 }]}>{channel.name}</Text>
          {favorite ? <Heart size={12} color={colors.gold} fill={colors.gold} /> : null}
        </View>
        <Text numberOfLines={1} style={styles.rowSub}>{!grid && cur ? cur[2] : channel.tagline ?? channel.country ?? ''}</Text>
      </View>
      {grid ? (
        <View style={styles.cells}>
          {cur || next.length ? (
            <>
              <ProgramCell p={cur} now={now} live flex={1.3} />
              <ProgramCell p={next[0]} now={now} />
              <ProgramCell p={next[1]} now={now} />
            </>
          ) : (
            <View style={styles.noGuide}>
              <CountryTag country={channel.country} />
              <QualityBadge label={qualityLabel(channel.bestHeight)} />
            </View>
          )}
        </View>
      ) : (
        <QualityBadge label={qualityLabel(channel.bestHeight)} />
      )}
    </Pressable>
  );
});

function FilterChip({ label, color, active, onPress }: { label: string; color: string; active: boolean; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable
      onPress={onPress}
      {...f.handlers}
      style={[styles.chip, active && { backgroundColor: `${color}22`, borderColor: `${color}88` }, f.on && { borderColor: colors.focus }]}
    >
      <Text style={[styles.chipText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, gap: 20, paddingBottom: 16 },
  guide: { minHeight: 200 },
  guideHead: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12, marginBottom: 8, marginTop: 6 },
  row: {
    height: ROW_H - 6, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent',
  },
  rowSel: { backgroundColor: colors.surfaceHi, borderColor: 'rgba(242,193,78,0.55)' },
  rowHover: { backgroundColor: colors.surface },
  num: { width: 40, color: colors.textFaint, fontFamily: fonts.display, fontSize: 17, textAlign: 'right' },
  rowLogo: {
    width: 64, height: 38, borderRadius: 6, backgroundColor: colors.surface, alignItems: 'center',
    justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: colors.line,
  },
  rowInitials: { color: colors.textDim, fontFamily: fonts.displayHeavy, fontSize: 14 },
  rowName: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 },
  rowSub: { color: colors.textDim, fontFamily: fonts.body, fontSize: 12 },
  cells: { flex: 1, flexDirection: 'row', alignSelf: 'stretch', marginVertical: 4 },
  noGuide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: colors.line },
  tagline: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 13 },
  schedule: { marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line, maxWidth: 560 },
  preview: {
    borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: colors.line,
    justifyContent: 'flex-end', minHeight: 220,
  },
  previewInfo: {
    padding: 24, gap: 8, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chNumBig: { color: colors.gold, fontFamily: fonts.display, fontSize: 16 },
  previewTitle: { ...type.h1, color: colors.text },
  hubTag: { fontFamily: fonts.bodyBold, fontSize: 12 },
  offline: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6 },
  offlineHead: { ...type.h2, color: colors.text },
  offlineText: { color: colors.textDim, fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
  mute: {
    position: 'absolute', top: 14, right: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  chip: {
    paddingHorizontal: 14, height: 34, justifyContent: 'center', borderRadius: 999, borderWidth: 1.5,
    borderColor: colors.line, backgroundColor: colors.bgRaised,
  },
  chipText: { color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 13 },
  empty: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14, padding: 16 },
});
