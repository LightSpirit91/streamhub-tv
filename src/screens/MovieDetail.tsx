import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ExternalLink, Play, Plus, RotateCcw, Star, X } from 'lucide-react-native';
import { CastRow, FreeOnButtons, TmdbCredit, WhereToWatch } from '../components/MetaBlocks';
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

const fmtMin = (m?: number) => (m ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)}h ` : ''}${m % 60}m` : undefined);
const fmtVotes = (n?: number) => (!n ? '' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));

export function MovieDetail({ movie, onPlay, onClose }: Props) {
  const L = useLayout();
  const inList = useStreamHub((s) => s.movieList.includes(movie.id));
  const toggle = useStreamHub((s) => s.toggleMovie);
  const resumeAt = useStreamHub((s) => s.movieProgress[movie.id] ?? 0);
  const fmt = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}h ` : ''}${Math.floor((s % 3600) / 60)}m`;
  const canOpenLinks = !Platform.isTV;

  const facts: [string, string | undefined][] = [
    ['Director', movie.director?.join(', ')],
    ['Starring', movie.cast?.slice(0, 8).join(', ')],
    ['Genres', movie.genres.join(', ')],
    ['Country', movie.country],
    ['Language', movie.language ?? (movie.country ? undefined : 'English')],
    ['Runtime', fmtMin(movie.minutes) ?? movie.runtime],
    ['Released', movie.releaseDate ? new Date(`${movie.releaseDate}T12:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : undefined],
    ['Video', movie.source === 'free' ? undefined : movie.quality],
  ];

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, L.compact ? styles.sheetPhone : { width: Math.min(960, L.width - 80) }]}>
        <Image source={{ uri: movie.backdrop ?? movie.poster }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={movie.backdrop ? 0 : 50} />
        <LinearGradient colors={movie.backdrop ? ['rgba(28,23,25,0.25)', 'rgba(28,23,25,0.92)', 'rgba(28,23,25,0.99)'] : ['rgba(28,23,25,0.55)', 'rgba(28,23,25,0.97)']} style={StyleSheet.absoluteFill} />
        <ScrollView contentContainerStyle={[styles.inner, L.compact && { flexDirection: 'column' }]}>
          <Image source={{ uri: movie.posterHi ?? movie.poster }} style={[styles.poster, L.compact && { width: 150, height: 222 }]} contentFit="cover" />
          <View style={{ flex: 1, gap: 12 }}>
            <Text style={styles.title}>{movie.title}</Text>
            {movie.tagline ? <Text style={styles.tagline}>{movie.tagline}</Text> : null}

            <View style={styles.badges}>
              {!movie.imdbRating && movie.tmdbRating ? <Text style={styles.pill}>{`TMDB ${movie.tmdbRating.toFixed(1)}`}</Text> : null}
              {movie.imdbRating ? (
                <View style={styles.imdb}>
                  <Text style={styles.imdbLogo}>IMDb</Text>
                  <Star size={14} color="#F5C518" fill="#F5C518" />
                  <Text style={styles.imdbScore}>{movie.imdbRating.toFixed(1)}</Text>
                  <Text style={styles.imdbOf}>/10{movie.imdbVotes ? `  ·  ${fmtVotes(movie.imdbVotes)} votes` : ''}</Text>
                </View>
              ) : null}
              {movie.year ? <Text style={styles.pill}>{movie.year}</Text> : null}
              {fmtMin(movie.minutes) ? <Text style={styles.pill}>{fmtMin(movie.minutes)}</Text> : null}
              {movie.quality ? <Text style={styles.pill}>{movie.quality}</Text> : null}
              {movie.language && movie.language !== 'English' ? <Text style={styles.pill}>{movie.language}</Text> : null}
            </View>

            <View style={styles.actions}>
              {movie.source === 'free' ? <FreeOnButtons links={movie.freeOn} title={movie.title} preferredFocus /> : null}
              {movie.source !== 'free' ? <Button
                variant="primary"
                label={resumeAt > 60 ? `Resume from ${fmt(resumeAt)}` : 'Play'}
                icon={<Play size={18} color="#17110A" fill="#17110A" />}
                onPress={() => onPlay(movie)}
                preferredFocus
              /> : null}
              {resumeAt > 60 && movie.source !== 'free' ? (
                <Button label="Start over" icon={<RotateCcw size={16} color={colors.text} />} onPress={() => onPlay(movie, true)} />
              ) : null}
              <Button
                label={inList ? 'In My Movies' : 'My Movies'}
                icon={inList ? <Check size={18} color={colors.text} /> : <Plus size={18} color={colors.text} />}
                onPress={() => toggle(movie.id)}
              />
            </View>

            {movie.description ? <Text style={styles.desc}>{movie.description}</Text> : null}

            <View style={styles.facts}>
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <View key={k} style={styles.fact}>
                    <Text style={styles.factKey}>{k}</Text>
                    <Text style={styles.factVal}>{v}</Text>
                  </View>
                ))}
            </View>

            <CastRow cast={movie.castPhotos} />
            {movie.source !== 'free' ? <WhereToWatch watch={movie.watch} /> : null}
            {canOpenLinks && (movie.imdbId || movie.wikipedia) ? (
              <View style={styles.links}>
                {movie.imdbId ? (
                  <Button
                    variant="ghost"
                    label="View on IMDb"
                    icon={<ExternalLink size={15} color={colors.textDim} />}
                    textStyle={{ color: colors.textDim }}
                    onPress={() => Linking.openURL(`https://www.imdb.com/title/${movie.imdbId}/`)}
                  />
                ) : null}
                {movie.wikipedia ? (
                  <Button
                    variant="ghost"
                    label="Wikipedia"
                    icon={<ExternalLink size={15} color={colors.textDim} />}
                    textStyle={{ color: colors.textDim }}
                    onPress={() => Linking.openURL(movie.wikipedia!)}
                  />
                ) : null}
              </View>
            ) : null}
            <Text style={styles.source}>
              {movie.source === 'free'
                ? `Streams free${movie.freeOn?.some((l) => l.type === 'ads') ? ' with ads' : ''} in Canada; opens on ${movie.freeOn?.map((l) => l.name).join(' / ') ?? 'the service'}.`
                : 'Free from the Internet Archive.'}{movie.source !== 'free' ? ' Credits from Wikidata' : ''}{movie.imdbRating ? `${movie.source === 'free' ? ' Rating' : ', rating'} from IMDb` : ''}.
            </Text>
            {movie.tmdbId ? <TmdbCredit /> : null}
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
  sheet: { borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.lineHi, maxHeight: '92%' },
  sheetPhone: { position: 'absolute', left: 0, right: 0, bottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '90%' },
  inner: { flexDirection: 'row', gap: 28, padding: 32 },
  poster: { width: 230, height: 340, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHi },
  title: { ...type.h1, color: colors.text, fontSize: 34 },
  tagline: { color: colors.gold, fontFamily: fonts.bodySemi, fontSize: 15, fontStyle: 'italic', marginTop: -4 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  imdb: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 10, height: 28,
    borderRadius: 6, backgroundColor: 'rgba(245,197,24,0.12)', borderWidth: 1, borderColor: 'rgba(245,197,24,0.4)',
  },
  imdbLogo: {
    backgroundColor: '#F5C518', color: '#000', fontFamily: fonts.displayHeavy, fontSize: 12, paddingHorizontal: 5,
    paddingVertical: 1, borderRadius: 3, overflow: 'hidden',
  },
  imdbScore: { color: colors.text, fontFamily: fonts.display, fontSize: 16 },
  imdbOf: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 12 },
  pill: {
    color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 12, paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1, borderColor: colors.lineHi, overflow: 'hidden',
  },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginVertical: 4 },
  desc: { color: colors.text, fontFamily: fonts.body, fontSize: 15, lineHeight: 23, opacity: 0.9 },
  facts: { gap: 8, marginTop: 4 },
  fact: { flexDirection: 'row', gap: 14 },
  factKey: { width: 82, color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 13 },
  factVal: { flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19 },
  links: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginLeft: -12 },
  source: { color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 11.5, marginTop: 2 },
  close: {
    position: 'absolute', top: 14, right: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
});
