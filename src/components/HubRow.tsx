import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Channel } from '../core/types';
import { colors } from '../ui/theme';
import { ChannelCard } from './ChannelCard';

interface Props {
  title: string;
  subtitle?: string;
  accent: string;
  channels: Channel[];
  cardWidth: number;
  favorites: Set<string>;
  onPlay(c: Channel, row: Channel[]): void;
  preferredFocus?: boolean;
  gutter: number;
}

function HubRowBase({ title, subtitle, accent, channels, cardWidth, favorites, onPlay, preferredFocus, gutter }: Props) {
  const press = useCallback((c: Channel) => onPlay(c, channels), [onPlay, channels]);
  if (!channels.length) return null;
  return (
    <View style={styles.row}>
      <View style={[styles.head, { paddingHorizontal: gutter }]}>
        <View style={[styles.bar, { backgroundColor: accent }]} />
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
      <FlatList
        horizontal
        data={channels}
        keyExtractor={(c) => c.id}
        renderItem={({ item, index }) => (
          <ChannelCard
            channel={item}
            width={cardWidth}
            accent={accent}
            favorite={favorites.has(item.id)}
            onPress={press}
            preferredFocus={preferredFocus && index === 0}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingVertical: 10 }}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
}

export const HubRow = memo(HubRowBase);

const styles = StyleSheet.create({
  row: { marginBottom: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { width: 4, height: 20, borderRadius: 2 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', letterSpacing: 0.3 },
  sub: { color: colors.textFaint, fontSize: 13, marginLeft: 4 },
});
