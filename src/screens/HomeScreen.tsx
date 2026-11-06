import { useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  View, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Channel, HubId } from '../core/types';
import { HUBS, HUB_BY_ID } from '../core/catalog/hubs';
import { searchChannels } from '../core/search/search';
import { useStreamHub } from '../state/useStreamHub';
import { formFactor } from '../services/device';
import { HubRow } from '../components/HubRow';
import { ChannelCard } from '../components/ChannelCard';
import { colors, flag } from '../ui/theme';

const ROW_LIMIT = 40;

interface Props {
  onPlay(c: Channel, row: Channel[]): void;
}

export function HomeScreen({ onPlay }: Props) {
  const { width } = useWindowDimensions();
  const ff = formFactor(width);
  const gutter = ff === 'tv' ? Math.round(width * 0.05) : ff === 'phone' ? 16 : 32;
  const cardWidth = ff === 'tv' ? 240 : ff === 'desktop' ? 210 : ff === 'tablet' ? 180 : 148;

  const status = useStreamHub((s) => s.status);
  const progress = useStreamHub((s) => s.progress);
  const error = useStreamHub((s) => s.error);
  const channels = useStreamHub((s) => s.channels);
  const byId = useStreamHub((s) => s.byId);
  const favorites = useStreamHub((s) => s.favorites);
  const recents = useStreamHub((s) => s.recents);
  const load = useStreamHub((s) => s.load);

  const [query, setQuery] = useState('');
  const [hubFilter, setHubFilter] = useState<HubId | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((c): c is Channel => !!c);
  const recentRow = useMemo(() => pick(recents), [recents, byId]);
  const favRow = useMemo(() => pick(favorites), [favorites, byId]);

  const hubRows = useMemo(
    () =>
      HUBS.map((h) => {
        const all = channels.filter((c) => c.hubs.includes(h.id));
        return { hub: h, all, row: all.slice(0, ROW_LIMIT) };
      }).filter((r) => r.all.length),
    [channels],
  );

  const results = useMemo(() => {
    if (query.trim()) return searchChannels(channels, query, 200);
    if (hubFilter) return channels.filter((c) => c.hubs.includes(hubFilter));
    return null;
  }, [query, hubFilter, channels]);

  const hero = hubRows.find((r) => r.hub.id === 'spotlight')?.row[0] ?? channels[0];
  const lastWatched = recentRow[0];

  if (status === 'loading' && !channels.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.logo}>STREAMHUB</Text>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} />
        <Text style={styles.dim}>{progress}</Text>
      </View>
    );
  }
  if (status === 'error' && !channels.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.logo}>STREAMHUB</Text>
        <Text style={[styles.dim, { color: colors.live }]}>Couldn't reach the channel lists. {error}</Text>
        <Pressable style={styles.cta} onPress={() => load(true)}>
          <Text style={styles.ctaText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const columns = Math.max(2, Math.floor((width - gutter * 2) / (cardWidth + 14)));

  const header = (
    <View>
      <View style={[styles.bar, { paddingHorizontal: gutter }]}>
        <Text style={styles.logo}>STREAMHUB</Text>
        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setHubFilter(null);
          }}
          placeholder="Search channels, countries, sports…"
          placeholderTextColor={colors.textFaint}
          style={styles.search}
          autoCorrect={false}
        />
        <Text style={styles.count}>{channels.length.toLocaleString()} live</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: gutter, gap: 8, paddingBottom: 6 }}>
        <Chip label="Home" active={!hubFilter && !query} onPress={() => { setHubFilter(null); setQuery(''); }} color={colors.gold} />
        {hubRows.map(({ hub, all }) => (
          <Chip
            key={hub.id}
            label={`${hub.title} ${all.length}`}
            color={hub.accent}
            active={hubFilter === hub.id}
            onPress={() => { setQuery(''); setHubFilter(hub.id); }}
          />
        ))}
      </ScrollView>
    </View>
  );

  if (results) {
    const accent = hubFilter ? HUB_BY_ID[hubFilter].accent : colors.gold;
    return (
      <FlatList
        key={`grid-${columns}`}
        style={styles.root}
        data={results}
        numColumns={columns}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <View>
            {header}
            <Text style={[styles.dim, { paddingHorizontal: gutter, marginVertical: 10 }]}>
              {results.length} channel{results.length === 1 ? '' : 's'}
              {hubFilter ? ` in ${HUB_BY_ID[hubFilter].title}` : ` for “${query}”`}
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 40 }}
        columnWrapperStyle={{ paddingHorizontal: gutter, marginBottom: 18 }}
        renderItem={({ item }) => (
          <ChannelCard channel={item} width={cardWidth} accent={accent} favorite={favSet.has(item.id)} onPress={(c) => onPlay(c, results)} />
        )}
        initialNumToRender={24}
      />
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.gold}
          onRefresh={async () => {
            setRefreshing(true);
            await load(true);
            setRefreshing(false);
          }}
        />
      }
    >
      {header}

      {hero && (
        <Pressable onPress={() => onPlay(lastWatched ?? hero, lastWatched ? recentRow : hubRows[0].row)} style={{ marginHorizontal: gutter, marginTop: 10, marginBottom: 26 }}>
          <LinearGradient
            colors={[HUB_BY_ID.spotlight.accent2, '#1A1020', colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.hero, { minHeight: ff === 'phone' ? 170 : 240 }]}
          >
            <Text style={styles.heroKicker}>{lastWatched ? 'CONTINUE WATCHING' : 'SPOTLIGHT · LIVE NOW'}</Text>
            <Text style={[styles.heroTitle, ff === 'phone' && { fontSize: 30 }]} numberOfLines={2}>
              {(lastWatched ?? hero).name}
            </Text>
            <Text style={styles.heroMeta}>
              {flag((lastWatched ?? hero).country)} {(lastWatched ?? hero).country ?? 'International'} · {(lastWatched ?? hero).streams.length} stream{(lastWatched ?? hero).streams.length > 1 ? 's' : ''}
            </Text>
            <View style={styles.cta}>
              <Text style={styles.ctaText}>▶  Watch live</Text>
            </View>
          </LinearGradient>
        </Pressable>
      )}

      <HubRow title="Continue Watching" accent={colors.gold} channels={recentRow} cardWidth={cardWidth} favorites={favSet} onPlay={onPlay} gutter={gutter} preferredFocus />
      <HubRow title="My Library" subtitle="Favorites" accent={colors.gold} channels={favRow} cardWidth={cardWidth} favorites={favSet} onPlay={onPlay} gutter={gutter} />
      {hubRows.map(({ hub, all, row }, i) => (
        <HubRow
          key={hub.id}
          title={hub.title}
          subtitle={all.length > ROW_LIMIT ? `${all.length} channels` : undefined}
          accent={hub.accent}
          channels={row}
          cardWidth={cardWidth}
          favorites={favSet}
          onPlay={onPlay}
          gutter={gutter}
          preferredFocus={!recentRow.length && i === 0}
        />
      ))}
      <Text style={[styles.dim, { textAlign: 'center', marginTop: 12 }]}>
        Free public channels from iptv-org and Free-TV. Dead links are removed every night.
      </Text>
    </ScrollView>
  );
}

function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress(): void; color: string }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      style={[styles.chip, (active || f) && { borderColor: color, backgroundColor: `${color}22` }]}
    >
      <Text style={[styles.chipText, active && { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  logo: { color: colors.gold, fontSize: 22, fontWeight: '900', letterSpacing: 6 },
  dim: { color: colors.textDim, fontSize: 14 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 22, paddingBottom: 14, flexWrap: 'wrap' },
  search: {
    flex: 1, minWidth: 200, height: 42, borderRadius: 21, paddingHorizontal: 18, color: colors.text,
    backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.line, fontSize: 15,
  },
  count: { color: colors.textFaint, fontSize: 13 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1.5,
    borderColor: colors.line, backgroundColor: colors.bgRaised,
  },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  hero: { borderRadius: 18, padding: 28, justifyContent: 'flex-end', borderWidth: 1, borderColor: 'rgba(245,196,81,0.25)' },
  heroKicker: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 3 },
  heroTitle: { color: colors.text, fontSize: 44, fontWeight: '900', marginTop: 8 },
  heroMeta: { color: colors.textDim, fontSize: 14, marginTop: 6 },
  cta: { alignSelf: 'flex-start', marginTop: 18, backgroundColor: colors.gold, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 24 },
  ctaText: { color: '#1A1300', fontWeight: '800', fontSize: 15 },
});
