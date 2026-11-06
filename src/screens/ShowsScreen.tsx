import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Clapperboard, Info, Play } from 'lucide-react-native';
import type { Show } from '../core/shows/types';
import { WORLD_ROWS, byNewest } from '../core/movies/types';
import { useStreamHub } from '../state/useStreamHub';
import { Row } from '../components/Row';
import { Button, useFocusRing } from '../ui/primitives';
import { colors, fonts, radius, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

interface Props {
  onOpen(s: Show): void;
  onPlay(s: Show, index: number): void;
}

export function ShowCard({ show, width, onPress }: { show: Show; width: number; onPress(s: Show): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={() => onPress(show)} {...f.handlers} style={[{ width, marginRight: 16 }, f.on && { transform: [{ scale: 1.05 }], zIndex: 2 }]} accessibilityLabel={show.title}>
      <View style={[styles.art, { height: Math.round((width * 9) / 16) }, f.on && styles.artOn]}>
        <Image source={{ uri: show.backdrop ?? show.poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={show.id} />
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />
        <Text style={styles.epCount}>{show.source === 'free' ? `Free on ${show.freeOn?.[0]?.name ?? 'TV'}${show.seasons ? `  ·  ${show.seasons} season${show.seasons > 1 ? 's' : ''}` : ''}` : `${show.episodes.length} episodes`}</Text>
      </View>
      <Text numberOfLines={1} style={styles.title}>{show.title}</Text>
      <Text numberOfLines={1} style={styles.meta}>{[show.imdbRating ? `★ ${show.imdbRating.toFixed(1)}` : null, show.year, show.genres[0], show.language && show.language !== 'English' ? show.language : null].filter(Boolean).join('  ·  ')}</Text>
    </Pressable>
  );
}

export function ShowsScreen({ onOpen, onPlay }: Props) {
  const L = useLayout();
  const shows = useStreamHub((s) => s.shows);
  const progress = useStreamHub((s) => s.movieProgress);
  const [lang, setLang] = useState<string | null>(null);
  const w = L.cardWidth;

  const watching = useMemo(() => shows.filter((s) => s.episodes.some((e) => (progress[e.id] ?? 0) > 60)), [shows, progress]);
  const fresh = useMemo(() => shows.filter((s) => (s.addedAt ?? 0) > Date.now() - 14 * 86_400_000).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 30), [shows]);
  // Newest first: series with the latest episodes / premieres.
  const newest = useMemo(() => shows.filter((s) => s.releaseDate).sort(byNewest).slice(0, 40), [shows]);
  const popularFree = useMemo(() => shows.filter((s) => s.source === 'free').slice(0, 30), [shows]);
  const world = useMemo(
    () => WORLD_ROWS.map((r) => ({ ...r, list: shows.filter((s) => s.language === r.language) })).filter((r) => r.list.length),
    [shows],
  );
  const byGenre = useMemo(() => {
    const g = new Map<string, Show[]>();
    for (const s of shows) for (const x of s.genres.slice(0, 1)) g.set(x, [...(g.get(x) ?? []), s]);
    return [...g.entries()].filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length);
  }, [shows]);

  if (!shows.length) {
    return (
      <View style={styles.empty}>
        <Clapperboard size={40} color={colors.textFaint} />
        <Text style={styles.emptyHead}>TV shows are on their way</Text>
        <Text style={styles.emptyText}>The series library builds every night. Check back after the next update.</Text>
      </View>
    );
  }

  const card = (s: Show) => <ShowCard show={s} width={w} onPress={onOpen} />;

  if (lang) {
    const list = shows.filter((s) => s.language === lang);
    const cols = Math.max(2, Math.floor((L.width - L.gutter * 2) / (w + 16)));
    return (
      <FlatList
        key={`sg-${cols}`}
        style={styles.root}
        data={list}
        numColumns={cols}
        keyExtractor={(s) => s.id}
        columnWrapperStyle={{ paddingHorizontal: L.gutter, marginBottom: 22 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: L.gutter, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Button label="All shows" onPress={() => setLang(null)} />
            <Text style={styles.gridTitle}>{WORLD_ROWS.find((r) => r.language === lang)?.title.replace('Cinema', 'TV') ?? lang}</Text>
          </View>
        }
        renderItem={({ item }) => card(item)}
      />
    );
  }

  const hero = watching[0] ?? newest.find((s) => s.backdrop && s.popularity > 0) ?? shows[0];
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 56 }}>
      <View style={[styles.hero, { marginHorizontal: L.gutter }]}>
        <Image source={{ uri: hero.backdrop ?? hero.poster }} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient colors={['rgba(28,23,25,0.2)', 'rgba(28,23,25,0.95)']} style={StyleSheet.absoluteFill} />
        <View style={styles.heroBody}>
          <Text style={styles.overline}>{watching[0] ? 'CONTINUE WATCHING' : hero.source === 'free' ? 'NEW EPISODES' : 'FEATURED SERIES'}</Text>
          <Text style={[styles.heroTitle, L.compact && { fontSize: 30, lineHeight: 34 }]} numberOfLines={2}>{hero.title}</Text>
          <Text style={styles.meta}>{[hero.year, hero.source === 'free' ? (hero.freeOn?.[0] ? `Free on ${hero.freeOn[0].name}` : null) : `${hero.episodes.length} episodes`, hero.genres[0], hero.language].filter(Boolean).join('   ')}</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <Button variant="primary" label={hero.source === 'free' ? `Watch free on ${hero.freeOn?.[0]?.name ?? 'TV'}` : 'Play'} icon={<Play size={18} color="#17110A" fill="#17110A" />} onPress={() => {
              const i = hero.episodes.findIndex((e) => (progress[e.id] ?? 0) > 60);
              onPlay(hero, Math.max(0, i));
            }} preferredFocus />
            <Button label={hero.source === 'free' ? 'Details' : 'Episodes'} icon={<Info size={18} color={colors.text} />} onPress={() => onOpen(hero)} />
          </View>
        </View>
      </View>
      <View style={{ height: 22 }} />
      <Row title="Continue Watching" data={watching} keyOf={(s) => s.id} gutter={L.gutter} render={card} />
      <Row title="Newest Episodes & Series" subtitle="latest first" accent={colors.coral} data={newest} keyOf={(s) => s.id} gutter={L.gutter} render={card} />
      <Row title="Just Added" accent={colors.ok} data={fresh} keyOf={(s) => s.id} gutter={L.gutter} render={card} />
      <Row title="Popular Free Series Right Now" subtitle="Tubi, Pluto TV, Roku and more" accent={colors.gold} data={popularFree} keyOf={(s) => s.id} gutter={L.gutter} render={card} />
      <Row title="Most Watched Series" accent={colors.gold} data={shows.slice(0, 30)} keyOf={(s) => s.id} gutter={L.gutter} render={card} />
      {world.map((r) => (
        <Row key={r.language} title={r.title.replace('Cinema', 'TV')} subtitle={`${r.list.length}`} data={r.list.slice(0, 30)} keyOf={(s) => s.id} gutter={L.gutter} render={card} onSeeAll={() => setLang(r.language)} />
      ))}
      {byGenre.map(([g, list]) => (
        <Row key={g} title={g} subtitle={`${list.length}`} data={list.slice(0, 30)} keyOf={(s) => s.id} gutter={L.gutter} render={card} />
      ))}
      <Text style={[styles.note, { marginHorizontal: L.gutter }]}>
        {shows.length} series, {shows.reduce((n, s) => n + s.episodes.length, 0).toLocaleString()} episodes. The newest series streaming free in Canada (they open on Tubi, Pluto TV and others) and classic public-domain TV.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  art: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 8 },
  artOn: { borderColor: colors.focus, borderWidth: 2 },
  epCount: { position: 'absolute', left: 10, bottom: 8, color: colors.text, fontFamily: fonts.bodyBold, fontSize: 11.5 },
  title: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 },
  meta: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 12.5, marginTop: 2 },
  hero: { borderRadius: 22, overflow: 'hidden', minHeight: 300, justifyContent: 'flex-end', marginTop: 8, borderWidth: 1, borderColor: colors.line },
  heroBody: { padding: 32, gap: 10, maxWidth: 720 },
  overline: { ...type.overline, color: colors.gold },
  heroTitle: { ...type.hero, color: colors.text },
  gridTitle: { ...type.h1, color: colors.text },
  note: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 13, marginTop: 18 },
  empty: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyHead: { ...type.h2, color: colors.text },
  emptyText: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14, textAlign: 'center', maxWidth: 420 },
});
