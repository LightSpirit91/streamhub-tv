import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { getCatalog } from './src/core/catalog/cache';
import { loadCatalog } from './src/core/catalog/loader';
import { HUBS } from './src/core/catalog/hubs';
import type { Catalog } from './src/core/types';
import { fileBlobStore } from './src/services/storage';
import { detectDevice } from './src/services/device';
import { channelsForDevice } from './src/core/platform/compat';

const device = detectDevice();
const forDevice = (c: Catalog): Catalog => ({ ...c, channels: channelsForDevice(c.channels, device) });

/**
 * Step 1 boot screen: proves the data engine on a real device (download,
 * parse, cache, hubs). Replaced by the Marquee home screen in Step 2.
 */
export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [progress, setProgress] = useState('Starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCatalog({
      store: fileBlobStore,
      load: () => loadCatalog({ onProgress: (d, t) => setProgress(`Loading sources ${d}/${t}`) }),
      onBackgroundUpdate: (c) => setCatalog(forDevice(c)),
    })
      .then((r) => setCatalog(forDevice(r.catalog)))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.logo}>STREAMHUB</Text>
      {!catalog && !error && (
        <View style={styles.center}>
          <ActivityIndicator color="#F5C451" />
          <Text style={styles.dim}>{progress}</Text>
        </View>
      )}
      {error && <Text style={styles.err}>{error}</Text>}
      {catalog && (
        <ScrollView contentContainerStyle={{ gap: 10 }}>
          <Text style={styles.dim}>{catalog.channels.length} channels ready on this {device.kind} device</Text>
          {HUBS.map((h) => (
            <View key={h.id} style={[styles.row, { borderLeftColor: h.accent }]}>
              <Text style={styles.hub}>{h.title}</Text>
              <Text style={styles.dim}>
                {catalog.channels.filter((c) => c.hubs.includes(h.id)).length}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07070A', padding: 32, paddingTop: 64 },
  logo: { color: '#F5C451', fontSize: 28, fontWeight: '800', letterSpacing: 8, marginBottom: 24 },
  center: { alignItems: 'center', gap: 12, marginTop: 64 },
  dim: { color: '#9A9AA6', fontSize: 16 },
  err: { color: '#FF5A6E', fontSize: 16 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#121218',
    borderLeftWidth: 4, borderRadius: 10, padding: 16,
  },
  hub: { color: '#F2F2F5', fontSize: 18, fontWeight: '600' },
});
