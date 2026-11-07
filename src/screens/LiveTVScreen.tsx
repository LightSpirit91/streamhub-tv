import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { CalendarDays, Expand, Heart, Pause, Play, Volume2, VolumeX } from 'lucide-react-native';
import { overlayOpen, useUi } from '../state/ui';
import { COUNTRY } from '../core/catalog/enrich';
import { readJSON, writeJSON } from '../services/storage';

/** Countries shown first in the picker; the rest follow by number of channels. */
const COUNTRY_ORDER = ['US', 'CA', 'UK', 'RU', 'IL', 'MX', 'AR', 'CO', 'CL', 'PE'];
const countryName = (cc: string) => (cc === 'INT' ? 'International' : COUNTRY[cc] ?? cc);
import type { Channel, HubId } from '../core/types';
import { HUBS, HUB_BY_ID } from '../core/catalog/hubs';
import { useStreamHub } from '../state/useStreamHub';
import StreamVideo from '../player/MediaView';
import { initials } from '../components/ChannelCard';
import { Button, CountryTag, Flag, LiveBadge, QualityBadge, useFocusRing } from '../ui/primitives';
import { colors, fonts, qualityLabel, radius, type } from '../ui/theme';
import { useLayout } from '../ui/layout';
import { ProgramCell, Schedule, useProgramme } from '../components/Guide';
import { useNow } from '../hooks/useNow';
import { useCast } from '../player/cast/useCast';

const ROW_H = 68;
const TUNE_DELAY = 550;

interface Props {
  initialHub?: HubId | null;
  onFullscreen(c: Channel, row: Channel[]): void;
  /** The fullscreen player is open: the preview stops (one sound at a time). */
  suspended?: boolean;
}

/**
 * Live TV: the cable-box experience. A numbered channel guide on one side,
 * the selected channel playing live on the other. Up/Down surfs, Enter or
 * OK goes fullscreen.
 */
export function LiveTVScreen({ initialHub, onFullscreen, suspended }: Props) {
  const L = useLayout();
  const channels = useStreamHub((s) => s.channels);
  const favorites = useStreamHub((s) => s.favorites);
  const [hub, setHub] = useState<HubId | 'all' | 'mylist'>(initialHub ?? 'all');
  useEffect(() => {
    if (initialHub) setHub(initialHub);
  }, [initialHub]);
  // Country picker (remembered on this device).
  const [country, setCountryState] = useState<string>(() => readJSON<string>('live:country', 'all'));
  const setCountry = (cc: string) => {
    setCountryState(cc);
    writeJSON('live:country', cc);
  };
  const countries = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of channels) n.set(c.country ?? 'INT', (n.get(c.country ?? 'INT') ?? 0) + 1);
    const rank = (cc: string) => (COUNTRY_ORDER.includes(cc) ? COUNTRY_ORDER.indexOf(cc) : 100);
    return [...n.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);
  }, [channels]);

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
    if (country !== 'all') l = l.filter((c) => (c.country ?? 'INT') === country);
    return l.sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));
  }, [hub, country, channels, favorites, numbers]);

  const [sel, setSel] = useState(0);
  const [tuned, setTuned] = useState<Channel | undefined>(list[0]);
  const listRef = useRef<FlatList<Channel>>(null);
  const wide = !L.compact && L.ff !== 'tablet';
  const tuneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setSel(0);
    setTuned(list[0]);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [hub, country]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback(
    (i: number, scroll: boolean) => {
      const c = list[i];
      if (!c) return;
      setSel(i);
      if (scroll && wide) listRef.current?.scrollToIndex({ index: i, viewPosition: 0.4, animated: true });
      clearTimeout(tuneTimer.current);
      tuneTimer.current = setTimeout(() => setTuned(c), TUNE_DELAY);
    },
    [list, wide],
  );

  const scrollY = useRef(0);
  const headerH = useRef(0);
  const pick = useCallback(
    (i: number) => {
      select(i, false);
      if (!wide && scrollY.current > headerH.current * 0.6) listRef.current?.scrollToOffset({ offset: 0, animated: true });
    },
    [select, wide],
  );

  // Keyboard surfing on Mac / PC.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpen()) return; // the schedule sheet owns the keys
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Enter on a focused control (filter chip, guide row) belongs to that control,
      // except the nav tabs, which keep focus after you click "Live TV".
      if (e.key === 'Enter' && el && el !== document.body && el.getAttribute('role') !== 'tab') return;
      if (e.key === 'ArrowDown') select(Math.min(list.length - 1, sel + 1), true);
      else if (e.key === 'ArrowUp') select(Math.max(0, sel - 1), true);
      else if (e.key === 'PageDown') select(Math.min(list.length - 1, sel + 10), true);
      else if (e.key === 'PageUp') select(Math.max(0, sel - 10), true);
      else if (e.key === 'Enter' && list[sel]) onFullscreen(list[sel], list);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const w = globalThis as unknown as Window;
    // Capture phase: the guide sees arrows and Enter before a focused button swallows them.
    w.addEventListener('keydown', onKey, true);
    return () => w.removeEventListener('keydown', onKey, true);
  }, [sel, list, select, onFullscreen]);

  const current = list[sel];
  const now = useNow();

  const filters: { id: HubId | 'all' | 'mylist'; label: string; color: string }[] = [
    { id: 'all', label: 'All channels', color: colors.gold },
    { id: 'mylist', label: 'My List', color: colors.gold },
    ...HUBS.filter((h) => h.id !== 'spotlight').map((h) => ({ id: h.id, label: h.title, color: h.accent })),
  ];

  // Video in its own 16:9 box with small controls; channel info below it, never on top.
  const video = (
    <View style={[styles.videoBox, wide && L.height < 760 ? { maxHeight: L.height * 0.42 } : null]}>
      {tuned && !suspended ? (
        <Preview key={tuned.id} channel={tuned} onFullscreen={() => current && onFullscreen(current, list)} />
      ) : null}
    </View>
  );
  const info = current ? (
    <View style={[styles.previewInfo, !wide && styles.previewInfoCompact]}>
      <View style={styles.infoRow}>
        <LiveBadge />
        <Text style={styles.chNumBig}>{numbers.get(current.id)}</Text>
        <CountryTag country={current.country} />
        <QualityBadge label={qualityLabel(current.bestHeight)} />
        {wide
          ? current.hubs
              .filter((h) => h !== 'spotlight')
              .slice(0, 2)
              .map((h) => (
                <Text key={h} style={[styles.hubTag, { color: HUB_BY_ID[h].accent }]}>{HUB_BY_ID[h].title}</Text>
              ))
          : null}
      </View>
      <Text style={[styles.previewTitle, !wide && { fontSize: 20 }]} numberOfLines={1}>{current.name}</Text>
      {wide && current.tagline ? <Text style={styles.tagline} numberOfLines={2}>{current.tagline}</Text> : null}
      {wide ? (
        <View style={styles.schedule}>
          <Schedule channelId={current.id} now={now} max={4} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
        <Button variant="primary" accessibilityLabel="Watch fullscreen" label={wide ? 'Watch fullscreen' : 'Fullscreen'} icon={<Expand size={16} color="#17110A" />} onPress={() => onFullscreen(current, list)} />
        <Button accessibilityLabel="Full schedule" label={wide ? 'Full schedule' : 'Schedule'} icon={<CalendarDays size={16} color={colors.text} />} onPress={() => useUi.getState().openSchedule(current)} />
      </View>
    </View>
  ) : null;
  const preview = wide ? (
    <View style={[styles.preview, { flex: 1 }]}>
      {video}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>{info}</ScrollView>
    </View>
  ) : (
    <View style={styles.preview}>
      {video}
      {info}
    </View>
  );

  const chips = (
    <>
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: L.gutter, gap: 8, paddingBottom: 8, alignItems: 'center' }}
      >
        <Pressable onPress={() => useUi.getState().setSources(true)} accessibilityRole="button" accessibilityLabel="Channel sources" style={[styles.chip, styles.countryChip]}>
          <Text style={styles.chipText}>Sources</Text>
        </Pressable>
        <Text style={styles.countryLabel}>Country</Text>
        <CountryChip label="All countries" active={country === 'all'} onPress={() => setCountry('all')} />
        {countries.map(([cc, n]) => (
          <CountryChip key={cc} cc={cc} label={`${countryName(cc)} ${n.toLocaleString()}`} active={country === cc} onPress={() => setCountry(cc)} />
        ))}
      </ScrollView>
    </>
  );
  const head = (
    <Text style={styles.guideHead}>
      {list.length.toLocaleString()} channels{Platform.OS === 'web' && wide ? '  ·  Use ↑ ↓ to surf, Enter for fullscreen' : ''}
    </Text>
  );
  const renderRow = ({ item, index }: { item: Channel; index: number }) => (
    <GuideRow
      channel={item}
      grid={wide}
      number={numbers.get(item.id) ?? 0}
      selected={index === sel}
      favorite={favorites.includes(item.id)}
      onSelect={() => pick(index)}
      onOpen={() => (index === sel ? onFullscreen(item, list) : pick(index))}
    />
  );
  const empty = <Text style={styles.empty}>Nothing here yet. Add channels to My List with the heart in the player.</Text>;

  if (!wide) {
    // Phone / narrow: one list for the whole page, so a swipe anywhere scrolls
    // (chips and the preview scroll away with it).
    return (
      <View style={styles.root}>
        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(c) => c.id}
          initialNumToRender={14}
          windowSize={9}
          onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={64}
          ListHeaderComponent={
            <View onLayout={(e) => (headerH.current = e.nativeEvent.layout.height)}>
              {chips}
              <View style={{ paddingHorizontal: L.gutter }}>
                {preview}
                {head}
              </View>
            </View>
          }
          renderItem={({ item, index }) => <View style={{ paddingHorizontal: L.gutter }}>{renderRow({ item, index })}</View>}
          ListEmptyComponent={empty}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {chips}
      <View style={[styles.body, { paddingHorizontal: L.gutter, flexDirection: 'row' }]}>
        <View style={[styles.guide, { width: Math.min(820, L.width * 0.56) }]}>
          {head}
          <FlatList
            ref={listRef}
            data={list}
            keyExtractor={(c) => c.id}
            getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
            initialNumToRender={14}
            windowSize={9}
            renderItem={renderRow}
            ListEmptyComponent={empty}
          />
        </View>
        {preview}
      </View>
    </View>
  );
}

const Preview = memo(function Preview({ channel, onFullscreen }: { channel: Channel; onFullscreen(): void }) {
  const castDevice = useCast().device;
  if (castDevice) {
    // While casting, nothing plays here: picking a channel sends it to the TV.
    return (
      <View style={styles.offline}>
        <Text style={styles.offlineHead}>Casting to {castDevice}</Text>
        <Text style={styles.offlineText}>Press Enter or tap a channel twice to put it on the TV.</Text>
      </View>
    );
  }
  return <LocalPreview channel={channel} onFullscreen={onFullscreen} />;
});

const LocalPreview = memo(function LocalPreview({ channel, onFullscreen }: { channel: Channel; onFullscreen(): void }) {
  const [idx, setIdx] = useState(0);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
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
          paused={paused}
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
      <View style={styles.miniBar}>
        <MiniBtn label={paused ? 'Play preview' : 'Pause preview'} onPress={() => setPaused((x) => !x)}>
          {paused ? <Play size={16} color="#fff" fill="#fff" /> : <Pause size={16} color="#fff" fill="#fff" />}
        </MiniBtn>
        <MiniBtn label={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((m) => !m)}>
          {muted ? <VolumeX size={16} color="#fff" /> : <Volume2 size={16} color="#fff" />}
        </MiniBtn>
        <View style={{ flex: 1 }} />
        <MiniBtn label="Fullscreen" onPress={onFullscreen}>
          <Expand size={15} color="#fff" />
        </MiniBtn>
      </View>
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

function MiniBtn({ label, onPress, children }: { label: string; onPress(): void; children: React.ReactNode }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} accessibilityRole="button" accessibilityLabel={label} style={[styles.miniBtn, f.on && { borderColor: colors.focus }]}>
      {children}
    </Pressable>
  );
}

function CountryChip({ cc, label, active, onPress }: { cc?: string; label: string; active: boolean; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable
      onPress={onPress}
      {...f.handlers}
      accessibilityRole="button"
      accessibilityLabel={`Country ${label}`}
      style={[styles.chip, styles.countryChip, active && { backgroundColor: 'rgba(244,184,96,0.16)', borderColor: colors.gold }, f.on && { borderColor: colors.focus }]}
    >
      {cc && cc !== 'INT' ? <Flag country={cc} size={12} /> : null}
      <Text style={[styles.chipText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

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
  preview: { borderRadius: 18, overflow: 'hidden', backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.line },
  videoBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  previewInfo: { padding: 20, gap: 8 },
  previewInfoCompact: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  miniBar: {
    position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  miniBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'transparent',
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
  countryChip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 30 },
  countryLabel: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12, marginRight: 2 },
  chipText: { color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 13 },
  empty: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14, padding: 16 },
});
