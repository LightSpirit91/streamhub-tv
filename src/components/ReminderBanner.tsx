import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BellRing, Play, X } from 'lucide-react-native';
import type { Channel } from '../core/types';
import { useStreamHub, type Reminder } from '../state/useStreamHub';
import { useNow } from '../hooks/useNow';
import { colors, fonts } from '../ui/theme';

/** Pops up when a show you set a reminder for starts. Tap Watch to tune in. */
export function ReminderBanner({ onWatch }: { onWatch(c: Channel): void }) {
  const now = useNow();
  const reminders = useStreamHub((s) => s.reminders);
  const byId = useStreamHub((s) => s.byId);
  const toggle = useStreamHub((s) => s.toggleReminder);
  const shown = useRef(new Set<string>());
  const [active, setActive] = useState<Reminder | null>(null);

  useEffect(() => {
    const due = reminders.find((r) => r.start <= now + 30 && r.end > now && !shown.current.has(`${r.channelId}:${r.start}`));
    if (!due) return;
    shown.current.add(`${due.channelId}:${due.start}`);
    setActive(due);
    if (Platform.OS === 'web') {
      const N = (globalThis as unknown as { Notification?: new (t: string, o?: { body?: string }) => unknown } & { Notification?: { permission?: string } }).Notification as
        | (((new (t: string, o?: { body?: string }) => unknown) & { permission?: string }))
        | undefined;
      if (N && N.permission === 'granted') new N(`Starting now: ${due.title}`, { body: byId.get(due.channelId)?.name ?? '' });
    }
  }, [now, reminders, byId]);

  if (!active) return null;
  const ch = byId.get(active.channelId);
  const close = () => {
    toggle(active); // remove the reminder once it has fired
    setActive(null);
  };
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <BellRing size={20} color={colors.gold} />
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>STARTING NOW</Text>
          <Text style={styles.title} numberOfLines={1}>{active.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{ch?.name ?? 'Channel'}</Text>
        </View>
        {ch ? (
          <Pressable style={styles.watch} onPress={() => { onWatch(ch); close(); }} accessibilityLabel="Watch now">
            <Play size={16} color="#1B140C" fill="#1B140C" />
            <Text style={styles.watchText}>Watch</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.x} onPress={close} accessibilityLabel="Dismiss">
          <X size={18} color={colors.textDim} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 76, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 12 },
  card: {
    width: '100%', maxWidth: 520, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18,
    backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: 'rgba(244,184,96,0.5)',
  },
  kicker: { color: colors.gold, fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.6 },
  title: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 15 },
  sub: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 12.5 },
  watch: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: 19, backgroundColor: colors.gold },
  watchText: { color: '#1B140C', fontFamily: fonts.bodyBold, fontSize: 14 },
  x: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
