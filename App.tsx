import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Outfit_500Medium, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';
import { Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import type { Channel, HubId } from './src/core/types';
import type { Movie } from './src/core/movies/types';
import { useStreamHub } from './src/state/useStreamHub';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveTVScreen } from './src/screens/LiveTVScreen';
import { MoviesScreen } from './src/screens/MoviesScreen';
import { MovieDetail } from './src/screens/MovieDetail';
import { MyListScreen } from './src/screens/MyListScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { PlayerScreen, type PlayItem } from './src/player/PlayerScreen';
import { BottomTabs, TopBar, type Tab } from './src/components/NavBar';
import { Wordmark } from './src/components/Wordmark';
import { colors, fonts } from './src/ui/theme';
import { useLayout } from './src/ui/layout';

export default function App() {
  const [fontsReady] = useFonts({
    Outfit_500Medium, Outfit_700Bold, Outfit_800ExtraBold, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
  });
  const L = useLayout();
  const load = useStreamHub((s) => s.load);
  const status = useStreamHub((s) => s.status);
  const progress = useStreamHub((s) => s.progress);
  const error = useStreamHub((s) => s.error);
  const profile = useStreamHub((s) => s.profile);
  const [tab, setTab] = useState<Tab>('home');
  const [liveHub, setLiveHub] = useState<HubId | null>(null);
  const [playing, setPlaying] = useState<PlayItem | null>(null);
  const [detail, setDetail] = useState<Movie | null>(null);

  useEffect(() => {
    load();
    // Keep the TV guide current while the app stays open.
    const t = setInterval(() => useStreamHub.getState().loadEpg(), 60 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Resume the last channel on the TV and phone apps once a profile is picked.
  useEffect(() => {
    if (status !== 'ready' || !profile || Platform.OS === 'web') return;
    const { lastChannelId, byId, channels } = useStreamHub.getState();
    const last = lastChannelId ? byId.get(lastChannelId) : undefined;
    if (last) setPlaying({ kind: 'live', channel: last, row: channels.filter((c) => c.hubs.some((h) => last.hubs.includes(h))) });
  }, [status === 'ready', profile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTab('home');
    setPlaying(null);
    setDetail(null);
  }, [profile]);

  const playChannel = useCallback((channel: Channel, row: Channel[]) => setPlaying({ kind: 'live', channel, row }), []);
  const playMovie = useCallback((movie: Movie, fromStart?: boolean) => {
    setDetail(null);
    setPlaying({ kind: 'movie', movie, fromStart });
  }, []);

  if (!fontsReady) return <View style={styles.root} />;
  if (!profile) return <ProfileScreen />;

  if (status !== 'ready') {
    return (
      <View style={[styles.root, styles.center]}>
        <Wordmark size={26} />
        {status === 'error' ? (
          <Text style={[styles.dim, { color: colors.live }]}>Couldn't reach the channel lists. {error}</Text>
        ) : (
          <>
            <ActivityIndicator color={colors.gold} style={{ marginTop: 28 }} />
            <Text style={styles.dim}>{progress}</Text>
          </>
        )}
      </View>
    );
  }

  const screen = (() => {
    switch (tab) {
      case 'live':
        return <LiveTVScreen initialHub={liveHub} onFullscreen={playChannel} />;
      case 'movies':
        return <MoviesScreen onOpen={setDetail} onPlay={playMovie} />;
      case 'mylist':
        return <MyListScreen onPlay={playChannel} onMovie={setDetail} />;
      case 'search':
        return <SearchScreen onPlay={playChannel} onMovie={setDetail} />;
      default:
        return (
          <HomeScreen
            onPlay={playChannel}
            onMovie={setDetail}
            onSeeAll={(h) => {
              setLiveHub(h);
              setTab('live');
            }}
            onMovies={() => setTab('movies')}
          />
        );
    }
  })();

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={!!playing} />
      <TopBar tab={tab} onTab={(t) => { setTab(t); if (t !== 'live') setLiveHub(null); }} compact={L.compact} gutter={L.gutter} />
      <View style={{ flex: 1 }}>{screen}</View>
      {L.compact && <BottomTabs tab={tab} onTab={setTab} />}
      {detail && <MovieDetail movie={detail} onPlay={playMovie} onClose={() => setDetail(null)} />}
      {playing && <PlayerScreen item={playing} onChange={setPlaying} onClose={() => setPlaying(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  dim: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14 },
});
