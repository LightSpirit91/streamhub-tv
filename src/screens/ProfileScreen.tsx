import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart } from 'lucide-react-native';
import { PROFILES, useStreamHub, type Profile } from '../state/useStreamHub';
import { colors, fonts, type } from '../ui/theme';
import { useFocusRing } from '../ui/primitives';
import { Wordmark } from '../components/Wordmark';

export function ProfileScreen() {
  const select = useStreamHub((s) => s.selectProfile);
  const { width } = useWindowDimensions();
  const size = width < 600 ? 112 : 156;
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['rgba(242,193,78,0.10)', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.7 }}
      />
      <Wordmark size={22} />
      <Text style={styles.title}>Who's watching?</Text>
      <View style={styles.row}>
        {PROFILES.map((p, i) => (
          <Avatar key={p.id} profile={p} size={size} onPress={() => select(p.id)} preferredFocus={i === 0} />
        ))}
      </View>
    </View>
  );
}

function Avatar({ profile, size, onPress, preferredFocus }: { profile: Profile; size: number; onPress(): void; preferredFocus?: boolean }) {
  const f = useFocusRing();
  return (
    <Pressable onPress={onPress} {...f.handlers} hasTVPreferredFocus={preferredFocus} style={styles.item} accessibilityLabel={profile.name}>
      <View style={[styles.ring, { width: size + 12, height: size + 12, borderRadius: (size + 12) / 2 }, f.on && styles.ringOn]}>
        <LinearGradient
          colors={profile.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
        >
          {profile.id === 'mylove' ? (
            <Heart size={size * 0.38} color="#fff" fill="#fff" strokeWidth={1.5} />
          ) : (
            <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{profile.name[0]}</Text>
          )}
        </LinearGradient>
      </View>
      <Text style={[styles.name, f.on && { color: colors.text }]}>{profile.name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { ...type.h1, color: colors.text, fontSize: 36, marginTop: 40, marginBottom: 44 },
  row: { flexDirection: 'row', gap: 48, flexWrap: 'wrap', justifyContent: 'center' },
  item: { alignItems: 'center' },
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'transparent' },
  ringOn: { borderColor: colors.focus, transform: [{ scale: 1.06 }] },
  initial: { fontFamily: fonts.displayHeavy, color: '#fff' },
  name: { ...type.title, color: colors.textDim, fontSize: 18, marginTop: 16 },
});
