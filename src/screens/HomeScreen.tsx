import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Play, Plus, Tv } from 'lucide-react-native';
import type { Channel, HubId } from '../core/types';
import type { Movie } from '../core/movies/types';
import { HUBS, HUB_BY_ID } from '../core/catalog/hubs';
import { useStreamHub } from '../state/useStreamHub';
import { ChannelCard } from '../components/ChannelCard';
import { MovieCard } from '../components/MovieCard';
import { ShowCard } from './ShowsScreen';
import type { Show } from '../core/shows/types';
import { Row } from '../components/Row';
import { Button, CountryTag, LiveBadge, QualityBadge } from '../ui/primitives';
import { colors, fonts, qualityLabel, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

const ROW_LIMIT = 30;

interface Props {
  onPlay(c: Channel, row: Channel[]): void;
  onMovie(m: Movie): void;
  onSeeAll(hub: HubId): void;
  onMovies(): void;
  onShow?(s: Show): void;
}

export function HomeScreen({ onPlay, onMovie, onSeeAll, onMovies, onShow }: Props) {
  const L = useLayout();
  const channels = useStreamHub((s) => s.channels);
  const byId = useStreamHub((s) => s.byId);
  const favorites = useStreamHub((s) => s.favorites);
  const recents = useStreamHub((s) => s.recents);
  const movies = useStreamHub((s) => s.movies);
  const shows = useStreamHub((s) => s.shows);
  // "Just Added": anything that arrived in the last 7 days.
  const WEEK = 7 * 86_400_000;
  const newChannels = useMemo(() => {
    const cut = Date.now() - WEEK;
    return channels.filter((c) => (c.addedAt ?? 0) > cut).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 30);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps
  const newTitles = useMemo(() => {
    const cut = Date.now() - WEEK;
    const m = movies.filter((x) => (x.addedAt ?? 0) > cut).map((x) => ({ kind: 'movie' as const, item: x, at: x.addedAt ?? 0 }));
    const sh = shows.filter((x) => (x.addedAt ?? 0) > cut).map((x) => ({ kind: 'show' as const, item: x, at: x.addedAt ?? 0 }));
    return [...m, ...sh].sort((a, b) => b.at - a.at).slice(0, 30);
  }, [movies, shows]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFavorite = useStreamHub((s) => s.toggleFavorite);
  const load = useStreamHub((s) => s.load);
  const [refreshing, setRefreshing] = useState(false);

  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((c): c is Channel => !!c);
  const recentRow = useMemo(() => pick(recents), [recents, byId]);
  const favRow = useMemo(() => pick(favorites), [favorites, byId]);
  const hubRows = useMemo(
    () =>
      HUBS.map((h) => {
        const all = channels.filter((c) => c.hubs.includes(h.id));
        return { hub: h, count: all.length, row: all.slice(0, ROW_LIMIT) };
      }).filter((r) => r.count),
    [channels],
  );

  const spotlight = hubRows.find((r) => r.hub.id === 'spotlight')?.row ?? [];
  const hero = recentRow[0] ?? spotlight[0] ?? channels[0];
  const heroRow = recentRow[0] ? recentRow : spotlight;
  const heroAccent = hero ? HUB_BY_ID[hero.hubs.find((h) => h !== 'spotlight') ?? 'spotlight'].accent : colors.gold;

  const card = (row: Channel[], accent: string) => (c: Channel) => (
    <ChannelCard channel={c} width={L.cardWidth} accent={accent} favorite={favSet.has(c.id)} onPress={(x) => onPlay(x, row)} />
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: 56 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.gold}
          onRefresh={async () => {
            setRefreshing(true);
            await load(true);
            setRefreshing(false);
          }}
        />
      }
    >
      {hero && (
        <View style={[styles.hero, { marginHorizontal: L.gutter, minHeight: L.compact ? 260 : 360 }]}>
          <LinearGradient
            colors={[`${heroAccent}40`, `${heroAccent}10`, colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {hero.logo ? (
            <Image
              source={{ uri: hero.logo }}
              style={[styles.heroLogo, L.compact && { width: 140, height: 90, right: 16, top: 20, opacity: 0.25 }]}
              contentFit="contain"
            />
          ) : null}
          <LinearGradient
            colors={['transparent', 'rgba(28,23,25,0.85)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroBody}>
            <View style={styles.heroTags}>
              <LiveBadge />
              <Text style={styles.overline}>{recentRow[0] ? 'CONTINUE WATCHING' : 'SPOTLIGHT'}</Text>
            </View>
            <Text style={[styles.heroTitle, L.compact && { fontSize: 34, lineHeight: 38 }]} numberOfLines={2}>
              {hero.name}
            </Text>
            <View style={styles.heroMeta}>
              <CountryTag country={hero.country} />
              <QualityBadge label={qualityLabel(hero.bestHeight)} />
              <Text style={styles.metaText}>
                {hero.streams.length} source{hero.streams.length > 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.heroActions}>
              <Button
                variant="primary"
                label="Watch live"
                icon={<Play size={18} color="#17110A" fill="#17110A" />}
                onPress={() => onPlay(hero, heroRow)}
                preferredFocus
              />
              <Button
                label={favSet.has(hero.id) ? 'In My List' : 'My List'}
                icon={favSet.has(hero.id) ? <Check size={18} color={colors.text} /> : <Plus size={18} color={colors.text} />}
                onPress={() => toggleFavorite(hero.id)}
              />
            </View>
          </View>
        </View>
      )}

      <View style={{ height: 22 }} />

      <Row title="Continue Watching" data={recentRow} keyOf={(c) => c.id} gutter={L.gutter} render={card(recentRow, colors.gold)} />
      <Row title="My List" data={favRow} keyOf={(c) => c.id} gutter={L.gutter} render={card(favRow, colors.gold)} />
      <Row title="Just Added: Channels" subtitle={newChannels.length ? `${newChannels.length} this week` : undefined} accent={colors.ok} data={newChannels} keyOf={(c) => c.id} gutter={L.gutter} render={card(newChannels, colors.ok)} />
      <Row
        title="Just Added: Movies & Series"
        accent={colors.ok}
        data={newTitles}
        keyOf={(x) => `${x.kind}:${x.item.id}`}
        gutter={L.gutter}
        render={(x) =>
          x.kind === 'movie' ? (
            <MovieCard movie={x.item} width={L.posterWidth} onPress={onMovie} />
          ) : (
            <ShowCard show={x.item} width={L.cardWidth} onPress={(sh) => onShow?.(sh)} />
          )
        }
      />

      {hubRows.slice(0, 3).map(({ hub, count, row }) => (
        <Row
          key={hub.id}
          title={hub.title}
          subtitle={`${count}`}
          accent={hub.accent}
          data={row}
          keyOf={(c) => c.id}
          gutter={L.gutter}
          render={card(row, hub.accent)}
          onSeeAll={() => onSeeAll(hub.id)}
        />
      ))}

      {movies.length > 0 && (
        <Row
          title="Free Movies"
          subtitle={`${movies.length}`}
          accent={colors.gold}
          data={movies.slice(0, 24)}
          keyOf={(m) => m.id}
          gutter={L.gutter}
          render={(m) => <MovieCard movie={m} width={L.posterWidth} onPress={onMovie} />}
          onSeeAll={onMovies}
        />
      )}

      {hubRows.slice(3).map(({ hub, count, row }) => (
        <Row
          key={hub.id}
          title={hub.title}
          subtitle={`${count}`}
          accent={hub.accent}
          data={row}
          keyOf={(c) => c.id}
          gutter={L.gutter}
          render={card(row, hub.accent)}
          onSeeAll={() => onSeeAll(hub.id)}
        />
      ))}

      <View style={[styles.footer, { marginHorizontal: L.gutter }]}>
        <Tv size={16} color={colors.textFaint} />
        <Text style={styles.footText}>
          {channels.length.toLocaleString()} free live channels. Dead links are removed every night.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: {
    borderRadius: 22, overflow: 'hidden', justifyContent: 'flex-end', marginTop: 8,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgRaised,
  },
  heroLogo: { position: 'absolute', right: '6%', top: '14%', width: '34%', height: '56%', opacity: 0.9 },
  heroBody: { padding: 32, gap: 12, maxWidth: 720 },
  heroTags: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  overline: { ...type.overline, color: colors.gold },
  heroTitle: { ...type.hero, color: colors.text },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  metaText: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 13 },
  heroActions: { flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 24, opacity: 0.9 },
  footText: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 13 },
});
