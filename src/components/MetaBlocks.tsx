import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { User } from 'lucide-react-native';
import type { CastMember, WatchInfo } from '../core/meta/tmdb';
import { PROVIDER_LABEL } from '../core/meta/tmdb';
import { colors, fonts } from '../ui/theme';

/** Horizontal cast row with photos (TMDB). */
export function CastRow({ cast }: { cast?: CastMember[] }) {
  if (!cast?.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.head}>Cast</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
        {cast.slice(0, 12).map((p) => (
          <View key={`${p.name}-${p.role}`} style={styles.person}>
            <View style={styles.face}>
              {p.photo ? <Image source={{ uri: p.photo }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <User size={26} color={colors.textFaint} />}
            </View>
            <Text style={styles.pName} numberOfLines={2}>{p.name}</Text>
            {p.role ? <Text style={styles.pRole} numberOfLines={1}>{p.role}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** "Where to watch in Canada": provider logos grouped by free / subscription / rent. */
export function WhereToWatch({ watch }: { watch?: WatchInfo }) {
  if (!watch?.providers.length) return null;
  const canOpen = !!watch.link && !Platform.isTV;
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.head}>Also available in Canada</Text>
      <View style={styles.providers}>
        {watch.providers.slice(0, 10).map((p) => (
          <Pressable
            key={`${p.name}-${p.type}`}
            disabled={!canOpen}
            onPress={() => watch.link && Linking.openURL(watch.link)}
            style={styles.provider}
            accessibilityLabel={`${p.name}, ${PROVIDER_LABEL[p.type]}`}
          >
            {p.logo ? <Image source={{ uri: p.logo }} style={styles.pLogo} contentFit="cover" /> : null}
            <View>
              <Text style={styles.provName} numberOfLines={1}>{p.name}</Text>
              <Text style={[styles.provType, (p.type === 'free' || p.type === 'ads') && { color: colors.ok }]}>{PROVIDER_LABEL[p.type]}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function TmdbCredit() {
  return <Text style={styles.credit}>Posters, cast and availability from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>;
}

const styles = StyleSheet.create({
  head: { color: colors.text, fontFamily: fonts.display, fontSize: 17 },
  person: { width: 86, alignItems: 'center', gap: 6 },
  face: {
    width: 72, height: 72, borderRadius: 36, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.lineHi,
  },
  pName: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 12, textAlign: 'center' },
  pRole: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 11, textAlign: 'center' },
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  provider: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 14, paddingLeft: 6, height: 48, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors.line,
  },
  pLogo: { width: 34, height: 34, borderRadius: 8 },
  provName: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13, maxWidth: 140 },
  provType: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 11 },
  credit: { color: colors.textFaint, fontFamily: fonts.body, fontSize: 11, marginTop: 4 },
});
