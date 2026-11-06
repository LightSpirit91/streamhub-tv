import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Cast, Pause, Play, X } from 'lucide-react-native';
import { connectCast, remote, stopCasting, useCast } from '../player/cast/useCast';
import { useFocusRing } from '../ui/primitives';
import { colors, fonts } from '../ui/theme';

/** Top-bar Cast button, on every page (Chrome with a Chromecast on the network). */
export function CastButton({ compact }: { compact?: boolean }) {
  const cast = useCast();
  const f = useFocusRing();
  if (!cast.available && !cast.device) return null;
  const on = !!cast.device;
  return (
    <Pressable
      onPress={() => (on ? stopCasting() : connectCast())}
      {...f.handlers}
      accessibilityLabel={on ? `Casting to ${cast.device}. Stop casting` : 'Cast to TV'}
      style={[styles.btn, on && styles.btnOn, f.on && { borderColor: colors.focus }]}
    >
      <Cast size={18} color={on ? '#17110A' : colors.text} />
      {!compact ? <Text style={[styles.btnText, on && { color: '#17110A' }]} numberOfLines={1}>{on ? cast.device : 'Cast'}</Text> : null}
    </Pressable>
  );
}

/** Persistent "Now on TV" bar while casting, so you can keep browsing. */
export function NowOnTvBar({ onOpen }: { onOpen(): void }) {
  const cast = useCast();
  if (!cast.device || !cast.media) return null;
  return (
    <View style={styles.bar}>
      <Pressable style={styles.barMain} onPress={onOpen} accessibilityLabel="Open remote">
        {cast.media.image ? <Image source={{ uri: cast.media.image }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.barTitle} numberOfLines={1}>{cast.media.title}</Text>
          <Text style={styles.barSub} numberOfLines={1}>
            On {cast.device}{cast.error ? `  ·  ${cast.error}` : ''}
          </Text>
        </View>
      </Pressable>
      <Pressable style={styles.icon} onPress={() => remote.playPause()} accessibilityLabel={cast.paused ? 'Play' : 'Pause'}>
        {cast.paused ? <Play size={20} color={colors.text} fill={colors.text} /> : <Pause size={20} color={colors.text} fill={colors.text} />}
      </Pressable>
      <Pressable style={styles.icon} onPress={() => stopCasting()} accessibilityLabel="Stop casting">
        <X size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1.5, borderColor: 'transparent', maxWidth: 220,
  },
  btnOn: { backgroundColor: colors.gold },
  btnText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 8, paddingVertical: 8,
    marginHorizontal: 12, marginBottom: 10, borderRadius: 16, backgroundColor: colors.surfaceHi,
    borderWidth: 1, borderColor: 'rgba(242,193,78,0.45)',
  },
  barMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 54, height: 34, borderRadius: 6, backgroundColor: colors.surface },
  barTitle: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 },
  barSub: { color: colors.gold, fontFamily: fonts.bodySemi, fontSize: 12 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
});
