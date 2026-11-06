import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Globe } from 'lucide-react-native';
import { colors, flagUri, fonts, radius } from './theme';

/** Focus/hover state shared by remote, keyboard, mouse and touch. */
export function useFocusRing() {
  const [on, setOn] = useState(false);
  return {
    on,
    handlers: {
      onFocus: () => setOn(true),
      onBlur: () => setOn(false),
      onHoverIn: () => setOn(true),
      onHoverOut: () => setOn(false),
    },
  };
}

export function Flag({ country, size = 14 }: { country?: string; size?: number }) {
  const uri = flagUri(country);
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return <Globe size={size} color={colors.textDim} strokeWidth={2} />;
  return (
    <Image
      source={{ uri }}
      style={{ width: Math.round(size * 1.4), height: size, borderRadius: 2 }}
      contentFit="cover"
      onError={() => setFailed(true)}
    />
  );
}

export function CountryTag({ country }: { country?: string }) {
  return (
    <View style={styles.tag}>
      <Flag country={country} size={11} />
      <Text style={styles.tagText}>{country && country !== 'INT' ? country : 'INTL'}</Text>
    </View>
  );
}

export function LiveBadge() {
  return (
    <View style={styles.live}>
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>LIVE</Text>
    </View>
  );
}

export function QualityBadge({ label }: { label: string | null }) {
  if (!label) return null;
  const k = label === '4K';
  return (
    <View style={[styles.q, k && { backgroundColor: colors.gold, borderColor: colors.gold }]}>
      <Text style={[styles.qText, k && { color: '#1B1400' }]}>{label}</Text>
    </View>
  );
}

interface ButtonProps {
  label?: string;
  icon?: ReactNode;
  onPress(): void;
  variant?: 'primary' | 'ghost' | 'glass';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  preferredFocus?: boolean;
  accessibilityLabel?: string;
}

export function Button({ label, icon, onPress, variant = 'glass', style, textStyle, preferredFocus, accessibilityLabel }: ButtonProps) {
  const f = useFocusRing();
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      {...f.handlers}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.btn,
        primary && styles.btnPrimary,
        variant === 'ghost' && styles.btnGhost,
        !label && styles.btnIcon,
        f.on && (primary ? styles.btnPrimaryOn : styles.btnOn),
        style,
      ]}
    >
      {icon}
      {label ? <Text style={[styles.btnText, primary && { color: '#17110A' }, textStyle]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagText: { color: colors.textDim, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8 },
  live: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.sm, backgroundColor: 'rgba(255,69,69,0.16)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.live },
  liveText: { color: '#FF8A8A', fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.2 },
  q: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(0,0,0,0.35)',
  },
  qText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 42, paddingHorizontal: 18, borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1.5, borderColor: 'transparent',
  },
  btnIcon: { width: 42, paddingHorizontal: 0 },
  btnGhost: { backgroundColor: 'transparent' },
  btnPrimary: { backgroundColor: colors.gold },
  btnOn: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: colors.focus },
  btnPrimaryOn: { backgroundColor: '#FFD36B', borderColor: colors.focus },
  btnText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 },
});
