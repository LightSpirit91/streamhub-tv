import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { CalendarDays, X } from 'lucide-react-native';
import type { UpcomingMovie } from '../core/movies/upcoming';
import { releaseLabel } from '../core/movies/upcoming';
import { Button, useFocusRing } from '../ui/primitives';
import { bgA, colors, fonts, radius, type } from '../ui/theme';
import { useLayout } from '../ui/layout';
import { CastRow, TmdbCredit } from './MetaBlocks';

export function UpcomingCard({ movie, width, onPress }: { movie: UpcomingMovie; width: number; onPress(m: UpcomingMovie): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={() => onPress(movie)} {...f.handlers} style={[{ width, marginRight: 16 }, f.on && { transform: [{ scale: 1.05 }], zIndex: 2 }]} accessibilityLabel={`${movie.title}, ${releaseLabel(movie.releaseDate)}`}>
      <View style={[styles.poster, { height: Math.round(width * 1.48) }, f.on && styles.posterOn]}>
        {movie.posterHi ? <Image source={{ uri: movie.posterHi }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <View style={styles.date}>
          <CalendarDays size={12} color="#1B140C" />
          <Text style={styles.dateText}>{releaseLabel(movie.releaseDate)}</Text>
        </View>
      </View>
      <Text numberOfLines={1} style={styles.title}>{movie.title}</Text>
      <Text numberOfLines={1} style={styles.meta}>{movie.genres.slice(0, 2).join(' · ')}</Text>
    </Pressable>
  );
}

export function UpcomingDetail({ movie, onClose }: { movie: UpcomingMovie; onClose(): void }) {
  const L = useLayout();
  const date = new Date(`${movie.releaseDate}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, L.compact ? styles.sheetPhone : { width: Math.min(900, L.width - 80) }]}>
        {movie.backdrop ? <Image source={{ uri: movie.backdrop }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <LinearGradient colors={[bgA(0.3), bgA(0.93), bgA(0.99)]} style={StyleSheet.absoluteFill} />
        <ScrollView contentContainerStyle={[styles.inner, L.compact && { flexDirection: 'column' }]}>
          {movie.posterHi ? <Image source={{ uri: movie.posterHi }} style={[styles.big, L.compact && { width: 150, height: 222 }]} contentFit="cover" /> : null}
          <View style={{ flex: 1, gap: 12 }}>
            <Text style={styles.overline}>COMING SOON</Text>
            <Text style={styles.h1}>{movie.title}</Text>
            {movie.tagline ? <Text style={styles.tagline}>{movie.tagline}</Text> : null}
            <View style={styles.when}>
              <CalendarDays size={18} color={colors.gold} />
              <Text style={styles.whenText}>Releases {date}</Text>
            </View>
            <Text style={styles.metaLine}>{movie.genres.join(' · ')}</Text>
            {movie.overview ? <Text style={styles.desc}>{movie.overview}</Text> : null}
            <CastRow cast={movie.castPhotos} />
            <Text style={styles.note}>
              New releases open in theaters or on paid services first. StreamHub shows them here so you know what's coming; the details page will list where to watch once it's available.
            </Text>
            <TmdbCredit />
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
  poster: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  posterOn: { borderColor: colors.focus, borderWidth: 2 },
  date: {
    position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, backgroundColor: colors.gold,
  },
  dateText: { color: '#1B140C', fontFamily: fonts.bodyBold, fontSize: 11 },
  title: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13, marginTop: 8 },
  meta: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12, marginTop: 2 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,16,18,0.72)', alignItems: 'center', justifyContent: 'center' },
  sheet: { borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.lineHi, maxHeight: '92%', backgroundColor: colors.bgRaised },
  sheetPhone: { position: 'absolute', left: 0, right: 0, bottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '90%' },
  inner: { flexDirection: 'row', gap: 28, padding: 32 },
  big: { width: 220, height: 326, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHi },
  overline: { ...type.overline, color: colors.coral },
  h1: { ...type.h1, color: colors.text, fontSize: 32 },
  tagline: { color: colors.gold, fontFamily: fonts.bodySemi, fontSize: 15, fontStyle: 'italic' },
  when: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  whenText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 16 },
  metaLine: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 14 },
  desc: { color: colors.text, opacity: 0.9, fontFamily: fonts.body, fontSize: 15, lineHeight: 23 },
  note: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 },
  close: {
    position: 'absolute', top: 14, right: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
});
