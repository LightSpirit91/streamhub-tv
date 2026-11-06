import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Heart } from 'lucide-react-native';
import type { Channel } from '../core/types';
import type { Movie } from '../core/movies/types';
import { PROFILES, useStreamHub } from '../state/useStreamHub';
import { ChannelCard } from '../components/ChannelCard';
import { MovieCard } from '../components/MovieCard';
import { Row } from '../components/Row';
import { colors, fonts, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

interface Props {
  onPlay(c: Channel, row: Channel[]): void;
  onMovie(m: Movie): void;
}

export function MyListScreen({ onPlay, onMovie }: Props) {
  const L = useLayout();
  const pid = useStreamHub((s) => s.profile);
  const profile = PROFILES.find((p) => p.id === pid);
  const byId = useStreamHub((s) => s.byId);
  const movieById = useStreamHub((s) => s.movieById);
  const favorites = useStreamHub((s) => s.favorites);
  const recents = useStreamHub((s) => s.recents);
  const movieList = useStreamHub((s) => s.movieList);

  const fav = useMemo(() => favorites.map((id) => byId.get(id)).filter((c): c is Channel => !!c), [favorites, byId]);
  const rec = useMemo(() => recents.map((id) => byId.get(id)).filter((c): c is Channel => !!c), [recents, byId]);
  const mov = useMemo(() => movieList.map((id) => movieById.get(id)).filter((m): m is Movie => !!m), [movieList, movieById]);
  const empty = !fav.length && !rec.length && !mov.length;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 56 }}>
      <Text style={[styles.title, { marginHorizontal: L.gutter }]}>{profile?.name}'s List</Text>
      {empty ? (
        <View style={[styles.empty, { marginHorizontal: L.gutter }]}>
          <Heart size={32} color={colors.textFaint} />
          <Text style={styles.emptyHead}>Your list is empty</Text>
          <Text style={styles.emptyText}>
            Tap the heart while watching a channel, or "My Movies" on any film. Everything you save stays on this profile only.
          </Text>
        </View>
      ) : null}
      <Row
        title="Favorite Channels"
        data={fav}
        keyOf={(c) => c.id}
        gutter={L.gutter}
        render={(c) => <ChannelCard channel={c} width={L.cardWidth} accent={colors.gold} favorite onPress={(x) => onPlay(x, fav)} />}
      />
      <Row
        title="My Movies"
        data={mov}
        keyOf={(m) => m.id}
        gutter={L.gutter}
        render={(m) => <MovieCard movie={m} width={L.posterWidth} onPress={onMovie} />}
      />
      <Row
        title="Recently Watched"
        data={rec}
        keyOf={(c) => c.id}
        gutter={L.gutter}
        render={(c) => <ChannelCard channel={c} width={L.cardWidth} accent={colors.gold} onPress={(x) => onPlay(x, rec)} />}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { ...type.h1, color: colors.text, marginTop: 12, marginBottom: 18 },
  empty: {
    alignItems: 'center', gap: 10, padding: 40, borderRadius: 18, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bgRaised,
  },
  emptyHead: { ...type.h2, color: colors.text },
  emptyText: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14, textAlign: 'center', maxWidth: 440 },
});
