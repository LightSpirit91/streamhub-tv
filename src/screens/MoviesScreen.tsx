import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Film, Info, Play } from 'lucide-react-native';
import type { Movie } from '../core/movies/types';
import { DECADES, MOVIE_GENRES, WORLD_ROWS, byNewest } from '../core/movies/types';
import { useStreamHub } from '../state/useStreamHub';
import { MovieCard } from '../components/MovieCard';
import { Row } from '../components/Row';
import { Button, useFocusRing } from '../ui/primitives';
import { colors, fonts, type } from '../ui/theme';
import { useLayout } from '../ui/layout';
import type { UpcomingMovie } from '../core/movies/upcoming';
import { UpcomingCard } from '../components/Upcoming';

type Sort = 'popular' | 'newest' | 'oldest' | 'best' | 'worst' | 'added' | 'az';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'popular', label: 'Most popular' },
  { id: 'added', label: 'Recently added' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'best', label: 'Best rated' },
  { id: 'worst', label: 'Lowest rated' },
  { id: 'az', label: 'A to Z' },
];
const ratingOf = (m: Movie) => m.imdbRating || m.tmdbRating || 0;
function sortMovies(list: Movie[], sort: Sort, minRating: number): Movie[] {
  const l = minRating ? list.filter((m) => ratingOf(m) >= minRating) : [...list];
  switch (sort) {
    case 'newest': return l.sort(byNewest);
    case 'oldest': return l.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    case 'best': return l.filter((m) => ratingOf(m) > 0).sort((a, b) => ratingOf(b) - ratingOf(a));
    case 'worst': return l.filter((m) => ratingOf(m) > 0).sort((a, b) => ratingOf(a) - ratingOf(b));
    case 'added': return l.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    case 'az': return l.sort((a, b) => a.title.localeCompare(b.title));
    default: return l.sort((a, b) => b.popularity - a.popularity);
  }
}

interface Props {
  onOpen(m: Movie): void;
  onPlay(m: Movie): void;
  onUpcoming(m: UpcomingMovie): void;
}

type Filter =
  | { kind: 'home' }
  | { kind: 'genre'; value: string }
  | { kind: 'language'; value: string; title: string }
  | { kind: 'decade'; value: number }
  | { kind: 'all' };

const decadeOf = (m: Movie) => (m.year ? Math.floor(m.year / 10) * 10 : undefined);

export function MoviesScreen({ onOpen, onPlay, onUpcoming }: Props) {
  const upcoming = useStreamHub((s) => s.upcoming);
  const [sort, setSort] = useState<Sort>('newest');
  const [minRating, setMinRating] = useState(0);
  const L = useLayout();
  const movies = useStreamHub((s) => s.movies);
  const movieList = useStreamHub((s) => s.movieList);
  const progress = useStreamHub((s) => s.movieProgress);
  const movieById = useStreamHub((s) => s.movieById);
  const [filter, setFilter] = useState<Filter>({ kind: 'home' });
  const [heroIdx, setHeroIdx] = useState(0);

  const cont = useMemo(
    () =>
      Object.entries(progress)
        .filter(([, t]) => t > 60)
        .map(([id]) => movieById.get(id))
        .filter((m): m is Movie => !!m),
    [progress, movieById],
  );
  const mine = useMemo(() => movieList.map((id) => movieById.get(id)).filter((m): m is Movie => !!m), [movieList, movieById]);
  const genres = useMemo(
    () => MOVIE_GENRES.map((g) => ({ g, list: movies.filter((m) => m.genres.includes(g)) })).filter((x) => x.list.length >= 4),
    [movies],
  );
  const world = useMemo(
    () => WORLD_ROWS.map((w) => ({ ...w, list: movies.filter((m) => m.language === w.language) })).filter((x) => x.list.length >= 3),
    [movies],
  );
  const decades = useMemo(
    () => DECADES.map((d) => ({ d, list: movies.filter((m) => decadeOf(m) === d) })).filter((x) => x.list.length >= 4),
    [movies],
  );
  const fresh = useMemo(() => {
    const cutoff = Date.now() - 14 * 86_400_000;
    return movies.filter((m) => (m.addedAt ?? 0) > cutoff).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 40);
  }, [movies]);
  // Newest first: the latest releases, then what's popular among recent free titles.
  const newest = useMemo(() => movies.filter((m) => m.year).sort(byNewest).slice(0, 40), [movies]);
  const popularFree = useMemo(() => movies.filter((m) => m.source === 'free').slice(0, 30), [movies]);
  const thisYear = new Date().getFullYear();
  const topRated = useMemo(
    () => movies.filter((m) => (m.imdbRating ?? 0) >= 7 && (m.imdbVotes ?? 0) >= 1000).sort((a, b) => (b.imdbRating ?? 0) - (a.imdbRating ?? 0)).slice(0, 40),
    [movies],
  );
  // "Because you watched": same lead genre as the latest film in progress.
  const because = useMemo(() => {
    const seed = cont[0] ?? mine[0];
    if (!seed) return null;
    const g = seed.genres[0];
    return { seed, list: movies.filter((m) => m.id !== seed.id && m.genres.includes(g)).slice(0, 30) };
  }, [cont, mine, movies]);

  const heroes = useMemo(() => {
    // Recent hits with artwork lead the hero; classics only when there are none.
    const recent = movies.filter((m) => m.backdrop && (m.year ?? 0) >= thisYear - 2).slice(0, 5);
    const pick = recent.length >= 3 ? recent : movies.slice(0, 5);
    return cont[0] ? [cont[0], ...pick.slice(0, 4)] : pick;
  }, [cont, movies, thisYear]);
  useEffect(() => {
    if (heroes.length < 2 || filter.kind !== 'home') return;
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroes.length), 9000);
    return () => clearInterval(t);
  }, [heroes.length, filter.kind]);

  const pct = (m: Movie) => {
    const t = progress[m.id];
    if (!t) return undefined;
    const total = (m.minutes ?? 90) * 60;
    return Math.min(0.97, t / total);
  };
  const card = (m: Movie) => <MovieCard movie={m} width={L.posterWidth} onPress={onOpen} progress={pct(m)} />;

  if (!movies.length) {
    return (
      <View style={styles.empty}>
        <Film size={40} color={colors.textFaint} />
        <Text style={styles.emptyHead}>Movies are on their way</Text>
        <Text style={styles.emptyText}>The free movie library builds every night. Check back in a few minutes.</Text>
      </View>
    );
  }

  const chips: { label: string; f: Filter; on: boolean }[] = [
    { label: 'Home', f: { kind: 'home' }, on: filter.kind === 'home' },
    { label: `All ${movies.length.toLocaleString()}`, f: { kind: 'all' }, on: filter.kind === 'all' },
    ...genres.map(({ g }) => ({ label: g, f: { kind: 'genre', value: g } as Filter, on: filter.kind === 'genre' && filter.value === g })),
    ...world.map((w) => ({
      label: w.title,
      f: { kind: 'language', value: w.language, title: w.title } as Filter,
      on: filter.kind === 'language' && filter.value === w.language,
    })),
    ...decades.map(({ d }) => ({ label: `${d}s`, f: { kind: 'decade', value: d } as Filter, on: filter.kind === 'decade' && filter.value === d })),
  ];

  const chipBar = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: L.gutter, gap: 8, paddingVertical: 8 }}>
      {chips.map((c) => (
        <Chip key={c.label} label={c.label} active={c.on} onPress={() => setFilter(c.f)} />
      ))}
    </ScrollView>
  );

  // Browse grid for a single genre / language / decade / everything.
  if (filter.kind !== 'home') {
    const base =
      filter.kind === 'all'
        ? movies
        : filter.kind === 'genre'
          ? movies.filter((m) => m.genres.includes(filter.value))
          : filter.kind === 'language'
            ? movies.filter((m) => m.language === filter.value)
            : movies.filter((m) => decadeOf(m) === filter.value);
    const list = sortMovies(base, sort, minRating);
    const title =
      filter.kind === 'all' ? 'All Movies' : filter.kind === 'genre' ? filter.value : filter.kind === 'language' ? filter.title : `The ${filter.value}s`;
    const cols = Math.max(3, Math.floor((L.width - L.gutter * 2) / (L.posterWidth + 16)));
    return (
      <View style={styles.root}>
        {chipBar}
        <FlatList
          key={`g-${cols}`}
          data={list}
          numColumns={cols}
          keyExtractor={(m) => m.id}
          initialNumToRender={cols * 4}
          windowSize={7}
          columnWrapperStyle={{ paddingHorizontal: L.gutter, marginBottom: 22 }}
          contentContainerStyle={{ paddingBottom: 56 }}
          ListHeaderComponent={
            <View>
              <Text style={[styles.gridTitle, { marginHorizontal: L.gutter }]}>
                {title} <Text style={styles.gridCount}>{list.length}</Text>
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: L.gutter, gap: 8, paddingBottom: 8 }}>
                <Text style={styles.sortLabel}>Sort</Text>
                {SORTS.map((x) => (
                  <Chip key={x.id} label={x.label} active={sort === x.id} onPress={() => setSort(x.id)} />
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: L.gutter, gap: 8, paddingBottom: 16 }}>
                <Text style={styles.sortLabel}>Rating</Text>
                {[0, 6, 7, 8].map((r) => (
                  <Chip key={r} label={r ? `${r}+ stars` : 'Any'} active={minRating === r} onPress={() => setMinRating(r)} />
                ))}
              </ScrollView>
            </View>
          }
          renderItem={({ item }) => card(item)}
        />
      </View>
    );
  }

  const hero = heroes[heroIdx % heroes.length];
  const resume = cont[0]?.id === hero.id;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 56 }}>
      {chipBar}
      <View style={[styles.hero, { marginHorizontal: L.gutter }]}>
        <Image source={{ uri: hero.backdrop ?? hero.poster }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={hero.backdrop ? 0 : 40} transition={500} />
        <LinearGradient colors={['rgba(28,23,25,0.3)', 'rgba(28,23,25,0.96)']} style={StyleSheet.absoluteFill} />
        <View style={[styles.heroInner, L.compact && { flexDirection: 'column-reverse', alignItems: 'flex-start' }]}>
          <View style={{ flex: 1, gap: 12 }}>
            <Text style={styles.overline}>{resume ? 'CONTINUE WATCHING' : (hero.year ?? 0) >= thisYear - 2 ? 'NEW RELEASE' : `#${heroIdx + (cont[0] ? 0 : 1)} MOST WATCHED`}</Text>
            <Text style={[styles.title, L.compact && { fontSize: 30, lineHeight: 34 }]} numberOfLines={2}>{hero.title}</Text>
            <Text style={styles.meta}>
              {[hero.imdbRating ? `IMDb ${hero.imdbRating.toFixed(1)}` : null, hero.year, hero.minutes ? `${Math.floor(hero.minutes / 60)}h ${hero.minutes % 60}m` : hero.runtime, hero.genres.slice(0, 3).join(' · '), hero.language]
                .filter(Boolean)
                .join('   ')}
            </Text>
            {!L.compact && hero.description ? <Text style={styles.desc} numberOfLines={3}>{hero.description}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              <Button variant="primary" label={hero.source === 'free' ? `Watch free on ${hero.freeOn?.[0]?.name ?? 'TV'}` : resume ? 'Resume' : 'Play'} icon={<Play size={18} color="#17110A" fill="#17110A" />} onPress={() => onPlay(hero)} preferredFocus />
              <Button label="Details" icon={<Info size={18} color={colors.text} />} onPress={() => onOpen(hero)} />
            </View>
            <View style={styles.dots}>
              {heroes.map((h, i) => (
                <Pressable key={h.id} onPress={() => setHeroIdx(i)} style={[styles.dot, i === heroIdx % heroes.length && styles.dotOn]} />
              ))}
            </View>
          </View>
          <Image source={{ uri: hero.posterHi ?? hero.poster }} style={[styles.heroPoster, L.compact && { width: 110, height: 163 }]} contentFit="cover" transition={400} />
        </View>
      </View>

      <View style={{ height: 22 }} />
      <Row title="Continue Watching" data={cont} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      <Row title="My Movies" data={mine} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      <Row title="New Releases" subtitle="latest first" accent={colors.coral} data={newest} keyOf={(m) => m.id} gutter={L.gutter} render={card} onSeeAll={() => { setSort('newest'); setFilter({ kind: 'all' }); }} />
      <Row title="Popular Free Movies Right Now" subtitle="Tubi, Pluto TV, Roku and more" accent={colors.gold} data={popularFree} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      <Row
        title="Top 10 on StreamHub"
        accent={colors.gold}
        data={movies.slice(0, 10)}
        keyOf={(m) => m.id}
        gutter={L.gutter}
        render={(m, i) => <TopTen movie={m} rank={i + 1} width={L.posterWidth} onPress={onOpen} />}
      />
      <Row
        title="Coming Soon"
        subtitle={upcoming.length ? 'release dates in Canada' : undefined}
        accent={colors.coral}
        data={upcoming.slice(0, 30)}
        keyOf={(m) => m.id}
        gutter={L.gutter}
        render={(m) => <UpcomingCard movie={m} width={L.posterWidth} onPress={onUpcoming} />}
      />
      <Row title="New on StreamHub" subtitle={fresh.length ? `${fresh.length} this week` : undefined} accent={colors.ok} data={fresh} keyOf={(m) => m.id} gutter={L.gutter} render={card} onSeeAll={() => { setSort('added'); setFilter({ kind: 'all' }); }} />
      <Row title="Highest Rated on IMDb" accent="#F5C518" data={topRated} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      {because && (
        <Row title={`Because you watched ${because.seed.title}`} data={because.list} keyOf={(m) => m.id} gutter={L.gutter} render={card} />
      )}
      <Row title="Trending Classics" data={movies.slice(10, 40)} keyOf={(m) => m.id} gutter={L.gutter} render={card} onSeeAll={() => setFilter({ kind: 'all' })} />
      {genres.map(({ g, list }) => (
        <Row key={g} title={g} subtitle={`${list.length}`} data={list.slice(0, 30)} keyOf={(m) => m.id} gutter={L.gutter} render={card} onSeeAll={() => setFilter({ kind: 'genre', value: g })} />
      ))}
      {world.map((w) => (
        <Row
          key={w.language}
          title={w.title}
          subtitle={`${w.list.length}`}
          data={w.list.slice(0, 30)}
          keyOf={(m) => m.id}
          gutter={L.gutter}
          render={card}
          onSeeAll={() => setFilter({ kind: 'language', value: w.language, title: w.title })}
        />
      ))}
      {decades.map(({ d, list }) => (
        <Row key={d} title={`The ${d}s`} subtitle={`${list.length}`} data={list.slice(0, 30)} keyOf={(m) => m.id} gutter={L.gutter} render={card} onSeeAll={() => setFilter({ kind: 'decade', value: d })} />
      ))}
      <Text style={[styles.note, { marginHorizontal: L.gutter }]}>
        {movies.length.toLocaleString()} films. The newest movies streaming free in Canada (they open on Tubi, Pluto TV and others) and public-domain classics. New releases are added every night.
      </Text>
    </ScrollView>
  );
}

function TopTen({ movie, rank, width, onPress }: { movie: Movie; rank: number; width: number; onPress(m: Movie): void }) {
  const f = useFocusRing();
  const h = Math.round(width * 1.48);
  return (
    <Pressable onPress={() => onPress(movie)} {...f.handlers} style={[styles.top10, f.on && { transform: [{ scale: 1.05 }], zIndex: 2 }]} accessibilityLabel={`${rank}. ${movie.title}`}>
      <Text style={[styles.rank, { fontSize: h * 0.72, lineHeight: h * 0.86 }]}>{rank}</Text>
      <View style={[styles.topPoster, { width, height: h, marginLeft: -h * 0.12 }, f.on && { borderColor: colors.focus, borderWidth: 2 }]}>
        <Image source={{ uri: movie.posterHi ?? movie.poster }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={movie.id} />
      </View>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} style={[styles.chip, active && styles.chipOn, f.on && { borderColor: colors.focus }]}>
      <Text style={[styles.chipText, active && { color: '#17110A' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { borderRadius: 22, overflow: 'hidden', marginTop: 6, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgRaised },
  heroInner: { flexDirection: 'row', alignItems: 'flex-end', gap: 28, padding: 32 },
  heroPoster: { width: 190, height: 281, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHi },
  overline: { ...type.overline, color: colors.gold },
  title: { ...type.hero, color: colors.text },
  meta: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 14 },
  desc: { color: colors.textDim, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, maxWidth: 640 },
  dots: { flexDirection: 'row', gap: 8, marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotOn: { width: 22, backgroundColor: colors.gold },
  top10: { flexDirection: 'row', alignItems: 'flex-end', marginRight: 20 },
  rank: {
    fontFamily: fonts.displayHeavy, color: colors.bg, letterSpacing: -8,
    textShadowColor: 'rgba(255,255,255,0.75)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 2,
  },
  topPoster: { borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chip: {
    paddingHorizontal: 14, height: 34, justifyContent: 'center', borderRadius: 999, borderWidth: 1.5,
    borderColor: colors.line, backgroundColor: colors.bgRaised,
  },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 13 },
  gridTitle: { ...type.h1, color: colors.text, marginTop: 10, marginBottom: 18 },
  sortLabel: { color: colors.textFaint, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, alignSelf: 'center', marginRight: 4 },
  gridCount: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 16 },
  note: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 13, marginTop: 18 },
  empty: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyHead: { ...type.h2, color: colors.text },
  emptyText: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14, textAlign: 'center', maxWidth: 420 },
});
