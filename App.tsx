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
import { ShowsScreen } from './src/screens/ShowsScreen';
import { ShowDetail } from './src/screens/ShowDetail';
import { UpcomingDetail } from './src/components/Upcoming';
import type { UpcomingMovie } from './src/core/movies/upcoming';
import type { Show } from './src/core/shows/types';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { PlayerScreen, type PlayItem } from './src/player/PlayerScreen';
import { BottomTabs, TopBar, type Tab } from './src/components/NavBar';
import { Wordmark } from './src/components/Wordmark';
import { QuickSearch } from './src/components/QuickSearch';
import { colors, fonts } from './src/ui/theme';
import { useLayout } from './src/ui/layout';
import { initCast, useCast } from './src/player/cast/useCast';
import { NowOnTvBar } from './src/components/CastControls';
import { APP_VERSION } from './src/version';
import { ReminderBanner } from './src/components/ReminderBanner';
import { WeekGuide } from './src/components/WeekGuide';
import { SourcesSheet } from './src/components/SourcesSheet';
import { useUi } from './src/state/ui';

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
  const [showDetail, setShowDetail] = useState<Show | null>(null);
  const [upcomingDetail, setUpcomingDetail] = useState<UpcomingMovie | null>(null);
  const schedule = useUi((s) => s.schedule);
  const closeSchedule = useUi((s) => s.closeSchedule);
  const sourcesOpen = useUi((s) => s.sources);
  const allChannels = useStreamHub((s) => s.channels);
  // Chromecast: remember what's on the TV so the bar can reopen its remote.
  const castDevice = useCast().device;
  const [castItem, setCastItem] = useState<PlayItem | null>(null);
  useEffect(() => initCast(), []);
  useEffect(() => {
    if (castDevice && playing) setCastItem(playing);
    if (!castDevice) setCastItem(null);
  }, [castDevice, playing]);

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
    setShowDetail(null);
  }, [profile]);

  const playChannel = useCallback((channel: Channel, row: Channel[]) => setPlaying({ kind: 'live', channel, row }), []);
  const playEpisode = useCallback((show: Show, index: number) => {
    if (!show.episodes.length) return setShowDetail(show); // free elsewhere: its page has the links
    setShowDetail(null);
    setPlaying({ kind: 'episode', show, index });
  }, []);
  const playMovie = useCallback((movie: Movie, fromStart?: boolean) => {
    if (movie.source === 'free') return setDetail(movie); // free elsewhere: its page has the links
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
        return <LiveTVScreen initialHub={liveHub} onFullscreen={playChannel} suspended={!!playing} />;
      case 'movies':
        return <MoviesScreen onOpen={setDetail} onPlay={playMovie} onUpcoming={setUpcomingDetail} />;
      case 'shows':
        return <ShowsScreen onOpen={setShowDetail} onPlay={playEpisode} />;
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
            onShow={setShowDetail}
          />
        );
    }
  })();

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={!!playing} />
      <TopBar
        tab={tab}
        onTab={(t) => { setTab(t); if (t !== 'live') setLiveHub(null); }}
        compact={L.compact}
        gutter={L.gutter}
        search={
          tab === 'search' ? null : (
            <QuickSearch
              compact={L.compact}
              onChannel={(c) => playChannel(c, allChannels.filter((x) => x.hubs.some((h) => c.hubs.includes(h))))}
              onMovie={setDetail}
              onShow={setShowDetail}
              onAll={(q) => {
                useUi.getState().setSearchQuery(q);
                setTab('search');
              }}
            />
          )
        }
      />
      <View style={{ flex: 1 }}>{screen}</View>
      {!playing && castItem ? <NowOnTvBar onOpen={() => setPlaying(castItem)} /> : null}
      {!playing ? <ReminderBanner onWatch={(c) => playChannel(c, [c])} /> : null}
      {tab === 'home' && !playing ? (
        <Text style={[styles.version, { bottom: L.compact ? 86 : 10, right: L.compact ? 12 : 18 }]} pointerEvents="none" accessibilityLabel={`Version ${APP_VERSION}`}>
          v{APP_VERSION}
        </Text>
      ) : null}
      {L.compact && <BottomTabs tab={tab} onTab={setTab} />}
      {detail && <MovieDetail movie={detail} onPlay={playMovie} onClose={() => setDetail(null)} />}
      {upcomingDetail && (
        <UpcomingDetail
          movie={upcomingDetail}
          onClose={() => setUpcomingDetail(null)}
        />
      )}
      {showDetail && (
        <ShowDetail
          show={showDetail}
          onPlay={playEpisode}
          onClose={() => setShowDetail(null)}
        />
      )}
      {playing && <PlayerScreen item={playing} onChange={setPlaying} onClose={() => setPlaying(null)} />}
      {sourcesOpen && <SourcesSheet onClose={() => useUi.getState().setSources(false)} />}
      {schedule && (
        <WeekGuide
          channel={schedule}
          onClose={closeSchedule}
          onWatch={(c) => {
            closeSchedule();
            playChannel(c, allChannels.filter((x) => x.hubs.some((h) => c.hubs.includes(h))));
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  dim: { color: colors.textDim, fontFamily: fonts.body, fontSize: 14 },
  version: { position: 'absolute', color: colors.textFaint, fontFamily: fonts.bodySemi, fontSize: 11, opacity: 0.8 },
});
