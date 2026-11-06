import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Channel } from '../core/types';
import { colors, flag, qualityLabel, radius } from '../ui/theme';

interface Props {
  channel: Channel;
  width: number;
  accent: string;
  favorite?: boolean;
  onPress(c: Channel): void;
  preferredFocus?: boolean;
}

function initials(name: string) {
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
  const [active, setActive] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const q = qualityLabel(channel.bestHeight);
  const on = () => setActive(true);
  const off = () => setActive(false);

  return (
    <Pressable
      onPress={() => onPress(channel)}
      onFocus={on}
      onBlur={off}
      onHoverIn={on}
      onHoverOut={off}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={`${channel.name}, ${channel.country ?? 'International'}`}
      style={[styles.card, { width }, active && { transform: [{ scale: 1.06 }], zIndex: 2 }]}
    >
      <View
        style={[
          styles.art,
          { height: Math.round((width * 9) / 16) },
          active && { borderColor: accent, shadowColor: accent, shadowOpacity: 0.7, shadowRadius: 18 },
        ]}
      >
        {channel.logo && !logoFailed ? (
          <Image
            source={{ uri: channel.logo }}
            style={styles.logo}
            contentFit="contain"
            transition={200}
            onError={() => setLogoFailed(true)}
            recyclingKey={channel.id}
          />
        ) : (
          <Text style={[styles.initials, { color: accent }]}>{initials(channel.name)}</Text>
        )}
        <View style={styles.liveDot} />
        {q && (
          <View style={[styles.badge, q === '4K' && { backgroundColor: colors.gold }]}>
            <Text style={[styles.badgeText, q === '4K' && { color: '#1A1300' }]}>{q}</Text>
          </View>
        )}
        {favorite && <Text style={styles.fav}>★</Text>}
      </View>
      <Text numberOfLines={1} style={[styles.name, active && { color: '#fff' }]}>
        {channel.name}
      </Text>
      <Text numberOfLines={1} style={styles.meta}>
        {flag(channel.country)} {channel.country ?? 'INT'}
        {channel.streams.length > 1 ? `  ·  ${channel.streams.length} streams` : ''}
      </Text>
    </Pressable>
  );
}

export const ChannelCard = memo(ChannelCardBase);

const styles = StyleSheet.create({
  card: { marginRight: 14 },
  art: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
  },
  logo: { width: '72%', height: '64%' },
  initials: { fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  liveDot: {
    position: 'absolute', top: 8, left: 8, width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.live,
  },
  badge: {
    position: 'absolute', top: 6, right: 6, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.14)',
  },
  badgeText: { color: colors.text, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  fav: { position: 'absolute', bottom: 4, right: 8, color: colors.gold, fontSize: 16 },
  name: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
