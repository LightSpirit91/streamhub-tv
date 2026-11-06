import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart } from 'lucide-react-native';
import type { Channel } from '../core/types';
import { colors, fonts, qualityLabel, radius } from '../ui/theme';
import { CountryTag, QualityBadge, useFocusRing } from '../ui/primitives';

interface Props {
  channel: Channel;
  width: number;
  accent: string;
  favorite?: boolean;
  onPress(c: Channel): void;
  preferredFocus?: boolean;
}

export function initials(name: string) {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function ChannelCardBase({ channel, width, accent, favorite, onPress, preferredFocus }: Props) {
  const f = useFocusRing();
  const [logoFailed, setLogoFailed] = useState(false);
  const h = Math.round((width * 9) / 16);

  return (
    <Pressable
      onPress={() => onPress(channel)}
      {...f.handlers}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={`${channel.name}, ${channel.country ?? 'International'}`}
      style={[styles.card, { width }, f.on && styles.cardOn]}
    >
      <View style={[styles.art, { height: h }, f.on && styles.artOn]}>
        <LinearGradient
          colors={[`${accent}26`, 'rgba(255,255,255,0.02)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {channel.logo && !logoFailed ? (
          <Image
            source={{ uri: channel.logo }}
            style={styles.logo}
            contentFit="contain"
            transition={180}
            onError={() => setLogoFailed(true)}
            recyclingKey={channel.id}
          />
        ) : (
          <Text style={[styles.initials, { fontSize: Math.round(h * 0.3) }]}>{initials(channel.name)}</Text>
        )}
        <View style={styles.badges}>
          <QualityBadge label={qualityLabel(channel.bestHeight)} />
        </View>
        {favorite && (
          <View style={styles.fav}>
            <Heart size={14} color={colors.gold} fill={colors.gold} />
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={[styles.name, f.on && { color: '#fff' }]}>
        {channel.name}
      </Text>
      <CountryTag country={channel.country} />
    </Pressable>
  );
}

export const ChannelCard = memo(ChannelCardBase);

const styles = StyleSheet.create({
  card: { marginRight: 16, gap: 6 },
  cardOn: { transform: [{ scale: 1.05 }], zIndex: 2 },
  art: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 4,
  },
  artOn: { borderColor: colors.focus, borderWidth: 2 },
  logo: { width: '66%', height: '58%' },
  initials: { fontFamily: fonts.displayHeavy, color: 'rgba(255,255,255,0.85)', letterSpacing: 1 },
  badges: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', gap: 6 },
  fav: { position: 'absolute', right: 8, top: 8 },
  name: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 },
});
