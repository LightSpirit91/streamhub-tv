import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Movie } from '../core/movies/types';
import { colors, fonts, radius } from '../ui/theme';
import { useFocusRing } from '../ui/primitives';

interface Props {
  movie: Movie;
  width: number;
  /** 0..1 watched fraction, shows a progress line. */
  progress?: number;
  onPress(m: Movie): void;
}

function MovieCardBase({ movie, width, progress, onPress }: Props) {
  const f = useFocusRing();
  return (
    <Pressable
      onPress={() => onPress(movie)}
      {...f.handlers}
      accessibilityRole="button"
      accessibilityLabel={movie.title}
      style={[styles.card, { width }, f.on && { transform: [{ scale: 1.05 }], zIndex: 2 }]}
    >
      <View style={[styles.poster, { height: Math.round(width * 1.48) }, f.on && styles.posterOn]}>
        <Image source={{ uri: movie.posterHi ?? movie.poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={movie.id} />
        {movie.source === 'free' && movie.freeOn?.[0] ? <Text style={styles.tag} numberOfLines={1}>{movie.freeOn[0].name}</Text> : null}
        {progress ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, Math.round(progress * 100))}%` }]} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.title}>{movie.title}</Text>
      <Text numberOfLines={1} style={styles.meta}>
        {[movie.imdbRating ? `★ ${movie.imdbRating.toFixed(1)}` : null, movie.year, movie.genres[0]].filter(Boolean).join('  ·  ')}
      </Text>
    </Pressable>
  );
}

export const MovieCard = memo(MovieCardBase);

const styles = StyleSheet.create({
  card: { marginRight: 16 },
  poster: {
    borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.line,
  },
  posterOn: { borderColor: colors.focus, borderWidth: 2 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.5)' },
  fill: { height: '100%', backgroundColor: colors.gold },
  title: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13, marginTop: 8 },
  tag: {
    position: 'absolute', top: 8, left: 8, maxWidth: '85%', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden',
    backgroundColor: 'rgba(28,23,25,0.82)', color: colors.ok, fontFamily: fonts.bodyBold, fontSize: 10.5,
  },
  meta: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12, marginTop: 2 },
});
