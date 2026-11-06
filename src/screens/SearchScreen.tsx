import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';
import type { Channel } from '../core/types';
import type { Movie } from '../core/movies/types';
import { searchChannels } from '../core/search/search';
import { useStreamHub } from '../state/useStreamHub';
import { ChannelCard } from '../components/ChannelCard';
import { MovieCard } from '../components/MovieCard';
import { Row } from '../components/Row';
import { colors, fonts } from '../ui/theme';
import { useLayout } from '../ui/layout';

interface Props {
  onPlay(c: Channel, row: Channel[]): void;
  onMovie(m: Movie): void;
}

export function SearchScreen({ onPlay, onMovie }: Props) {
  const L = useLayout();
  const channels = useStreamHub((s) => s.channels);
  const movies = useStreamHub((s) => s.movies);
  const favorites = useStreamHub((s) => s.favorites);
  const [q, setQ] = useState('');

  const results = useMemo(() => (q.trim() ? searchChannels(channels, q, 240) : []), [q, channels]);
  const movieHits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return movies.filter((m) => m.title.toLowerCase().includes(t) || m.genres.some((g) => g.toLowerCase().includes(t))).slice(0, 40);
  }, [q, movies]);

  const cols = Math.max(2, Math.floor((L.width - L.gutter * 2) / (L.cardWidth + 16)));

  return (
    <FlatList
      key={`s-${cols}`}
      style={styles.root}
      data={results}
      numColumns={cols}
      keyExtractor={(c) => c.id}
      keyboardShouldPersistTaps="handled"
      columnWrapperStyle={{ paddingHorizontal: L.gutter, marginBottom: 20 }}
      contentContainerStyle={{ paddingBottom: 56 }}
      ListHeaderComponent={
        <View>
          <View style={[styles.box, { marginHorizontal: L.gutter }]}>
            <Search size={20} color={colors.textDim} />
            <TextInput
              value={q}
              onChangeText={setQ}
              autoFocus
              placeholder="Channels, countries, sports, movies"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCorrect={false}
            />
          </View>
          {!q.trim() ? (
            <Text style={[styles.hint, { marginHorizontal: L.gutter }]}>
              Try "UFC", "Israel", "Канал", "קשת", "nature", "western" or "noir".
            </Text>
          ) : null}
          <Row title="Movies" data={movieHits} keyOf={(m) => m.id} gutter={L.gutter} render={(m) => <MovieCard movie={m} width={L.posterWidth} onPress={onMovie} />} />
          {q.trim() ? (
            <Text style={[styles.count, { marginHorizontal: L.gutter }]}>
              {results.length} channel{results.length === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <ChannelCard channel={item} width={L.cardWidth} accent={colors.gold} favorite={favorites.includes(item.id)} onPress={(c) => onPlay(c, results)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 12, height: 54, paddingHorizontal: 18, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineHi, marginTop: 8, marginBottom: 14,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.bodySemi, fontSize: 17, height: '100%' },
  hint: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 14, marginBottom: 12 },
  count: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 13, marginBottom: 12 },
});
