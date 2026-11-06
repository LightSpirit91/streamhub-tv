import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Film, Info, Play } from 'lucide-react-native';
import type { Movie } from '../core/movies/types';
import { MOVIE_GENRES } from '../core/movies/types';
import { useStreamHub } from '../state/useStreamHub';
import { MovieCard } from '../components/MovieCard';
import { Row } from '../components/Row';
import { Button } from '../ui/primitives';
import { colors, fonts, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

interface Props {
  onOpen(m: Movie): void;
  onPlay(m: Movie): void;
}

export function MoviesScreen({ onOpen, onPlay }: Props) {
  const L = useLayout();
  const movies = useStreamHub((s) => s.movies);
  const movieList = useStreamHub((s) => s.movieList);
  const progress = useStreamHub((s) => s.movieProgress);
  const movieById = useStreamHub((s) => s.movieById);

  const cont = useMemo(
    () => Object.entries(progress).filter(([, t]) => t > 60).map(([id]) => movieById.get(id)).filter((m): m is Movie => !!m),
    [progress, movieById],
  );
  const mine = useMemo(() => movieList.map((id) => movieById.get(id)).filter((m): m is Movie => !!m), [movieList, movieById]);
  const genres = useMemo(
    () => MOVIE_GENRES.map((g) => ({ g, list: movies.filter((m) => m.genres.includes(g)) })).filter((x) => x.list.length >= 4),
    [movies],
  );

  if (!movies.length) {
    return (
      <View style={styles.empty}>
        <Film size={40} color={colors.textFaint} />
        <Text style={styles.emptyHead}>Movies are on their way</Text>
        <Text style={styles.emptyText}>
          The free movie library builds every night. Pull to refresh on Home, or check back in a few minutes.
        </Text>
      </View>
    );
  }

  const hero = cont[0] ?? movies[0];
  const card = (m: Movie) => (
    <MovieCard movie={m} width={L.posterWidth} onPress={onOpen} progress={progress[m.id] ? 0.01 + Math.min(0.95, progress[m.id] / 5400) : undefined} />
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 56 }}>
      <View style={[styles.hero, { marginHorizontal: L.gutter }]}>
        <Image source={{ uri: hero.poster }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
        <LinearGradient colors={['rgba(6,7,11,0.35)', 'rgba(6,7,11,0.95)']} style={StyleSheet.absoluteFill} />
        <View style={[styles.heroInner, L.compact && { flexDirection: 'column-reverse', alignItems: 'flex-start' }]}>
          <View style={{ flex: 1, gap: 12 }}>
            <Text style={styles.overline}>{cont[0] ? 'CONTINUE WATCHING' : 'FEATURED FREE MOVIE'}</Text>
            <Text style={[styles.title, L.compact && { fontSize: 30, lineHeight: 34 }]} numberOfLines={2}>{hero.title}</Text>
            <Text style={styles.meta}>{[hero.year, hero.genres.join(' · '), hero.runtime].filter(Boolean).join('   ')}</Text>
            {!L.compact && hero.description ? <Text style={styles.desc} numberOfLines={3}>{hero.description}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              <Button variant="primary" label={cont[0] ? 'Resume' : 'Play'} icon={<Play size={18} color="#17110A" fill="#17110A" />} onPress={() => onPlay(hero)} preferredFocus />
              <Button label="Details" icon={<Info size={18} color={colors.text} />} onPress={() => onOpen(hero)} />
            </View>
          </View>
          <Image source={{ uri: hero.poster }} style={[styles.heroPoster, L.compact && { width: 110, height: 163 }]} contentFit="cover" />
        </View>
      </View>

      <View style={{ height: 22 }} />
      <Row title="Continue Watching" data={cont} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      <Row title="My Movies" data={mine} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      <Row title="Most Watched" accent={colors.gold} data={movies.slice(0, 30)} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      {genres.map(({ g, list }) => (
        <Row key={g} title={g} subtitle={`${list.length}`} data={list.slice(0, 40)} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      ))}
      <Text style={[styles.note, { marginHorizontal: L.gutter }]}>
        {movies.length} full-length films from the Internet Archive: classics in the public domain, free and legal to watch.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { borderRadius: 22, overflow: 'hidden', marginTop: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgRaised },
  heroInner: { flexDirection: 'row', alignItems: 'flex-end', gap: 28, padding: 32 },
  heroPoster: { width: 180, height: 266, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHi },
  overline: { ...type.overline, color: colors.gold },
  title: { ...type.hero, color: colors.text },
  meta: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 14 },
  desc: { color: colors.textDim, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, maxWidth: 640 },
  note: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 13, marginTop: 18 },
  empty: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyHead: { ...type.h2, color: colors.text },
  emptyText: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14, textAlign: 'center', maxWidth: 420 },
});
