import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Film, Play, Plus, X } from 'lucide-react-native';
import { CastRow, TmdbCredit, WhereToWatch } from '../components/MetaBlocks';
import type { Show } from '../core/shows/types';
import { useStreamHub } from '../state/useStreamHub';
import { Button, useFocusRing } from '../ui/primitives';
import { colors, fonts, type } from '../ui/theme';
import { useLayout } from '../ui/layout';

interface Props {
  show: Show;
  onPlay(s: Show, index: number): void;
  onTrailer?(url: string, title: string): void;
  onClose(): void;
}

export function ShowDetail({ show, onPlay, onTrailer, onClose }: Props) {
  const L = useLayout();
  const progress = useStreamHub((s) => s.movieProgress);
  const inList = useStreamHub((s) => s.movieList.includes(show.id));
  const toggle = useStreamHub((s) => s.toggleMovie);
  const seasons = useMemo(() => [...new Set(show.episodes.map((e) => e.season ?? 0))].sort((a, b) => a - b), [show]);
  const [season, setSeason] = useState(seasons[0]);
  const list = show.episodes.map((e, i) => ({ e, i })).filter(({ e }) => (e.season ?? 0) === season);
  const resume = show.episodes.findIndex((e) => (progress[e.id] ?? 0) > 60);

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, L.compact ? styles.sheetPhone : { width: Math.min(960, L.width - 80) }]}>
        <Image source={{ uri: show.backdrop ?? show.poster }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={show.backdrop ? 0 : 40} />
        <LinearGradient colors={['rgba(6,7,11,0.6)', 'rgba(6,7,11,0.98)']} style={StyleSheet.absoluteFill} />
        <FlatList
          data={list}
          keyExtractor={({ e }) => e.id}
          contentContainerStyle={{ padding: 28, paddingBottom: 40 }}
          ListHeaderComponent={
            <View style={{ gap: 12, marginBottom: 14 }}>
              <Text style={styles.title}>{show.title}</Text>
              {show.tagline ? <Text style={styles.tagline}>{show.tagline}</Text> : null}
              {show.imdbRating ? (
                <View style={styles.imdb}>
                  <Text style={styles.imdbLogo}>IMDb</Text>
                  <Text style={styles.imdbScore}>{show.imdbRating.toFixed(1)}</Text>
                  <Text style={styles.meta}>/10{show.imdbVotes ? `  ·  ${show.imdbVotes.toLocaleString()} votes` : ''}</Text>
                </View>
              ) : null}
              <Text style={styles.meta}>
                {[show.year, `${show.episodes.length} episodes`, show.genres.join(' · '), show.language, show.country].filter(Boolean).join('   ')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  label={resume >= 0 ? `Resume episode ${resume + 1}` : 'Play episode 1'}
                  icon={<Play size={18} color="#17110A" fill="#17110A" />}
                  onPress={() => onPlay(show, Math.max(0, resume))}
                  preferredFocus
                />
                {show.trailer && onTrailer ? (
                  <Button label="Trailer" icon={<Film size={16} color={colors.text} />} onPress={() => onTrailer(show.trailer!, show.title)} />
                ) : null}
                <Button
                  label={inList ? 'In My List' : 'My List'}
                  icon={inList ? <Check size={18} color={colors.text} /> : <Plus size={18} color={colors.text} />}
                  onPress={() => toggle(show.id)}
                />
              </View>
              {show.description ? <Text style={styles.desc} numberOfLines={4}>{show.description}</Text> : null}
              {show.castPhotos?.length ? <CastRow cast={show.castPhotos} /> : show.cast?.length ? <Text style={styles.meta}>Starring {show.cast.slice(0, 5).join(', ')}</Text> : null}
              <WhereToWatch watch={show.watch} />
              {show.tmdbId ? <TmdbCredit /> : null}
              {seasons.length > 1 ? (
                <View style={styles.seasons}>
                  {seasons.map((s) => (
                    <SeasonChip key={s} label={s ? `Season ${s}` : 'Episodes'} active={s === season} onPress={() => setSeason(s)} />
                  ))}
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item: { e, i } }) => (
            <EpisodeRow
              n={e.episode ?? i + 1}
              title={e.title}
              minutes={e.minutes}
              watched={(progress[e.id] ?? 0) / Math.max(60, (e.minutes ?? 30) * 60)}
              onPress={() => onPlay(show, i)}
            />
          )}
        />
        <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close">
          <X size={20} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

function SeasonChip({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} style={[styles.chip, active && styles.chipOn, f.on && { borderColor: colors.focus }]}>
      <Text style={[styles.chipText, active && { color: '#17110A' }]}>{label}</Text>
    </Pressable>
  );
}

function EpisodeRow({ n, title, minutes, watched, onPress }: { n: number; title: string; minutes?: number; watched: number; onPress(): void }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} style={[styles.ep, f.on && styles.epOn]}>
      <Text style={styles.epNum}>{n}</Text>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.epTitle} numberOfLines={1}>{title}</Text>
        {watched > 0.02 ? (
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, watched * 100)}%` }]} /></View>
        ) : null}
      </View>
      {minutes ? <Text style={styles.epMin}>{minutes} min</Text> : null}
      <Play size={16} color={f.on ? colors.text : colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  sheet: { borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.lineHi, height: '88%' },
  sheetPhone: { position: 'absolute', left: 0, right: 0, bottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, height: '90%' },
  title: { ...type.h1, color: colors.text, fontSize: 34, paddingRight: 40 },
  meta: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 14 },
  tagline: { color: colors.gold, fontFamily: fonts.bodySemi, fontSize: 15, fontStyle: 'italic', marginTop: -4 },
  imdb: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  imdbLogo: {
    backgroundColor: '#F5C518', color: '#000', fontFamily: fonts.displayHeavy, fontSize: 12, paddingHorizontal: 5,
    paddingVertical: 1, borderRadius: 3, overflow: 'hidden',
  },
  imdbScore: { color: colors.text, fontFamily: fonts.display, fontSize: 16 },
  desc: { color: colors.text, opacity: 0.88, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 22 },
  seasons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
  chip: { paddingHorizontal: 14, height: 34, justifyContent: 'center', borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.bgRaised },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 13 },
  ep: {
    flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'transparent', marginBottom: 4,
  },
  epOn: { backgroundColor: colors.surfaceHi, borderColor: colors.focus },
  epNum: { width: 30, color: colors.textFaint, fontFamily: fonts.display, fontSize: 18, textAlign: 'right' },
  epTitle: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 15 },
  epMin: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 12.5 },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', maxWidth: 240 },
  fill: { height: '100%', backgroundColor: colors.gold },
  close: {
    position: 'absolute', top: 14, right: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
});
