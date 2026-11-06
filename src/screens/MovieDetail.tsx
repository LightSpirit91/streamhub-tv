import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Play, Plus, RotateCcw, X } from 'lucide-react-native';
import type { Movie } from '../core/movies/types';
import { useStreamHub } from '../state/useStreamHub';
import { Button } from '../ui/primitives';
import { colors, fonts, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

interface Props {
  movie: Movie;
  onPlay(m: Movie, fromStart?: boolean): void;
  onClose(): void;
}

export function MovieDetail({ movie, onPlay, onClose }: Props) {
  const L = useLayout();
  const inList = useStreamHub((s) => s.movieList.includes(movie.id));
  const toggle = useStreamHub((s) => s.toggleMovie);
  const resumeAt = useStreamHub((s) => s.movieProgress[movie.id] ?? 0);
  const fmt = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}h ` : ''}${Math.floor((s % 3600) / 60)}m`;

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, L.compact ? styles.sheetPhone : { width: Math.min(900, L.width - 80) }]}>
        <Image source={{ uri: movie.poster }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={50} />
        <LinearGradient colors={['rgba(6,7,11,0.55)', 'rgba(6,7,11,0.97)']} style={StyleSheet.absoluteFill} />
        <ScrollView contentContainerStyle={[styles.inner, L.compact && { flexDirection: 'column' }]}>
          <Image source={{ uri: movie.poster }} style={[styles.poster, L.compact && { width: 150, height: 222 }]} contentFit="cover" />
          <View style={{ flex: 1, gap: 12 }}>
            <Text style={styles.title}>{movie.title}</Text>
            <Text style={styles.meta}>{[movie.year, movie.runtime, movie.genres.join(' · ')].filter(Boolean).join('   ')}</Text>
            <View style={styles.actions}>
              <Button
                variant="primary"
                label={resumeAt > 60 ? `Resume from ${fmt(resumeAt)}` : 'Play'}
                icon={<Play size={18} color="#17110A" fill="#17110A" />}
                onPress={() => onPlay(movie)}
                preferredFocus
              />
              {resumeAt > 60 ? (
                <Button label="Start over" icon={<RotateCcw size={16} color={colors.text} />} onPress={() => onPlay(movie, true)} />
              ) : null}
              <Button
                label={inList ? 'In My Movies' : 'My Movies'}
                icon={inList ? <Check size={18} color={colors.text} /> : <Plus size={18} color={colors.text} />}
                onPress={() => toggle(movie.id)}
              />
            </View>
            {movie.description ? <Text style={styles.desc}>{movie.description}</Text> : null}
            <Text style={styles.source}>Free from the Internet Archive</Text>
          </View>
        </ScrollView>
        <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close">
          <X size={20} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  sheet: { borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.lineHi, maxHeight: '90%' },
  sheetPhone: { position: 'absolute', left: 0, right: 0, bottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '88%' },
  inner: { flexDirection: 'row', gap: 28, padding: 32 },
  poster: { width: 220, height: 326, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHi },
  title: { ...type.h1, color: colors.text, fontSize: 34 },
  meta: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginVertical: 6 },
  desc: { color: colors.textDim, fontFamily: fonts.body, fontSize: 15, lineHeight: 23 },
  source: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12, marginTop: 6 },
  close: {
    position: 'absolute', top: 14, right: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
});
