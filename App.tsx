import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Channel } from './src/core/types';
import { useStreamHub } from './src/state/useStreamHub';
import { HomeScreen } from './src/screens/HomeScreen';
import { PlayerScreen } from './src/player/PlayerScreen';
import { colors } from './src/ui/theme';

export default function App() {
  const load = useStreamHub((s) => s.load);
  const status = useStreamHub((s) => s.status);
  const [playing, setPlaying] = useState<{ channel: Channel; row: Channel[] } | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  // Resume on launch (TV and phone apps). Browsers wait for a click,
  // because they block autoplay with sound.
  useEffect(() => {
    if (status !== 'ready' || Platform.OS === 'web') return;
    const { lastChannelId, byId, channels } = useStreamHub.getState();
    const last = lastChannelId ? byId.get(lastChannelId) : undefined;
    if (last) setPlaying({ channel: last, row: channels.filter((c) => c.hubs.some((h) => last.hubs.includes(h))) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === 'ready']);

  const onPlay = useCallback((channel: Channel, row: Channel[]) => setPlaying({ channel, row }), []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={!!playing} />
      <HomeScreen onPlay={onPlay} />
      {playing && (
        <PlayerScreen
          channel={playing.channel}
          row={playing.row}
          onChange={(c) => setPlaying((p) => (p ? { ...p, channel: c } : p))}
          onClose={() => setPlaying(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
