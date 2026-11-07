import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useUi } from '../state/ui';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Clapperboard, Film, Search, Tv, X } from 'lucide-react-native';
import type { Channel } from '../core/types';
import type { Movie } from '../core/movies/types';
import type { Show } from '../core/shows/types';
import { searchChannels } from '../core/search/search';
import { useStreamHub } from '../state/useStreamHub';
import { colors, fonts, radius } from '../ui/theme';

type Hit =
  | { kind: 'channel'; key: string; title: string; sub: string; img?: string; channel: Channel }
  | { kind: 'movie'; key: string; title: string; sub: string; img?: string; movie: Movie }
  | { kind: 'show'; key: string; title: string; sub: string; img?: string; show: Show };

const words = (t: string) => t.toLowerCase().trim().split(/\s+/).filter(Boolean);
const matches = (title: string, ws: string[]) => {
  const t = title.toLowerCase();
  return ws.every((w) => t.includes(w));
};
const starts = (title: string, q: string) => (title.toLowerCase().startsWith(q) ? 0 : 1);

/** Suggestions for what has been typed so far: channels, movies, shows. */
export function quickHits(q: string, channels: Channel[], movies: Movie[], shows: Show[], max = 10): Hit[] {
  const ws = words(q);
  if (!ws.length) return [];
  const lq = q.toLowerCase().trim();
  const ch = searchChannels(channels, q, 5).map<Hit>((c) => ({ kind: 'channel', key: `c:${c.id}`, title: c.name, sub: `Live channel${c.country ? ` · ${c.country}` : ''}`, img: c.logo, channel: c }));
  const mv = movies
    .filter((m) => matches(m.title, ws))
    .sort((a, b) => starts(a.title, lq) - starts(b.title, lq) || (b.year ?? 0) - (a.year ?? 0))
    .slice(0, 4)
    .map<Hit>((m) => ({ kind: 'movie', key: `m:${m.id}`, title: m.title, sub: `Movie${m.year ? ` · ${m.year}` : ''}`, img: m.poster, movie: m }));
  const sh = shows
    .filter((s) => matches(s.title, ws))
    .sort((a, b) => starts(a.title, lq) - starts(b.title, lq))
    .slice(0, 3)
    .map<Hit>((s) => ({ kind: 'show', key: `s:${s.id}`, title: s.title, sub: `Series${s.year ? ` · ${s.year}` : ''}`, img: s.poster, show: s }));
  return [...ch, ...mv, ...sh].slice(0, max);
}

interface Props {
  compact: boolean;
  onChannel(c: Channel): void;
  onMovie(m: Movie): void;
  onShow(s: Show): void;
  /** Enter / "See all results": the full Search page with this text. */
  onAll(q: string): void;
}

/** Search box at the top of every page, with suggestions as you type. */
export function QuickSearch({ compact, onChannel, onMovie, onShow, onAll }: Props) {
  const channels = useStreamHub((s) => s.channels);
  const movies = useStreamHub((s) => s.movies);
  const shows = useStreamHub((s) => s.shows);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const win = useWindowDimensions();
  const [x, setX] = useState(0);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const showing = open && !!q.trim();
  useEffect(() => {
    useUi.getState().setSearchOpen(showing);
    return () => useUi.getState().setSearchOpen(false);
  }, [showing]);
  const hits = useMemo(() => quickHits(q, channels, movies, shows), [q, channels, movies, shows]);

  const done = () => {
    setOpen(false);
    setQ('');
    input.current?.blur();
  };
  const choose = (h: Hit) => {
    done();
    if (h.kind === 'channel') onChannel(h.channel);
    else if (h.kind === 'movie') onMovie(h.movie);
    else onShow(h.show);
  };
  const all = () => {
    const t = q.trim();
    if (!t) return;
    done();
    onAll(t);
  };

  return (
    <View style={[styles.wrap, compact ? { flex: 1, minWidth: 0 } : { width: 320 }]} onLayout={(e) => setX(e.nativeEvent.layout.x)}>
      <View style={[styles.box, open && styles.boxOn]}>
        <Search size={16} color={colors.textDim} />
        <TextInput
          ref={input}
          value={q}
          onChangeText={(t) => {
            setQ(t);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Let a tap on a suggestion land before the list closes.
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onSubmitEditing={all}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'Escape') done();
          }}
          placeholder={compact ? 'Search' : 'Search channels, movies, shows'}
          placeholderTextColor={colors.textFaint}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search channels and movies"
          style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} accessibilityLabel="Clear search" hitSlop={8}>
            <X size={16} color={colors.textDim} />
          </Pressable>
        ) : null}
      </View>
      {showing ? (
        <View style={[styles.drop, compact ? { left: 12 - x, right: undefined, width: win.width - 24, minWidth: 0 } : null]} accessibilityRole="list" accessibilityLabel="Search suggestions">
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            {hits.length ? (
              hits.map((h) => (
                <Pressable key={h.key} onPress={() => choose(h)} accessibilityRole="button" accessibilityLabel={`${h.title}, ${h.sub}`} style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.item, (hovered || pressed) && styles.itemOn]}>
                  <View style={[styles.thumb, h.kind !== 'channel' && styles.poster]}>
                    {h.img ? (
                      <Image source={{ uri: h.img }} style={{ width: '100%', height: '100%' }} contentFit={h.kind === 'channel' ? 'contain' : 'cover'} />
                    ) : h.kind === 'channel' ? (
                      <Tv size={16} color={colors.textDim} />
                    ) : h.kind === 'movie' ? (
                      <Film size={16} color={colors.textDim} />
                    ) : (
                      <Clapperboard size={16} color={colors.textDim} />
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.title} numberOfLines={1}>{h.title}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{h.sub}</Text>
                  </View>
                </Pressable>
              ))
            ) : (
              <Text style={styles.none}>No matches for "{q.trim()}"</Text>
            )}
            <Pressable onPress={all} accessibilityRole="button" accessibilityLabel="See all results" style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.allBtn, (hovered || pressed) && styles.itemOn]}>
              <Search size={14} color={colors.gold} />
              <Text style={styles.allText}>See all results</Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 50 },
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 12, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1.5, borderColor: 'transparent',
  },
  boxOn: { borderColor: colors.gold },
  input: { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.bodySemi, fontSize: 16, paddingVertical: 0 },
  drop: {
    position: 'absolute', top: 44, left: 0, right: 0, minWidth: 300, backgroundColor: colors.bgRaised, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.line, paddingVertical: 6, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, elevation: 12,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 52 },
  itemOn: { backgroundColor: 'rgba(255,255,255,0.07)' },
  thumb: { width: 44, height: 30, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  poster: { width: 28, height: 40 },
  title: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 },
  sub: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12, marginTop: 2 },
  none: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 13, padding: 12 },
  allBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.line, marginTop: 4 },
  allText: { color: colors.gold, fontFamily: fonts.bodyBold, fontSize: 13 },
});
