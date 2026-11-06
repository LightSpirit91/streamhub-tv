import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRemote } from '../tv/useRemote';
import { Image } from 'expo-image';
import type { Channel } from '../core/types';
import { FailoverController, zap, type FailoverState } from '../core/health/failover';
import { useStreamHub } from '../state/useStreamHub';
import { colors, flag, qualityLabel } from '../ui/theme';
import StreamVideo from './StreamVideo';
import type { Fit } from './StreamVideo.types';

const FITS: { fit: Fit; label: string }[] = [
  { fit: 'contain', label: 'Fit' },
  { fit: 'fill', label: 'Stretch' },
  { fit: 'cover', label: 'Zoom' },
];
const STALL_MS = 20_000;
const HIDE_MS = 4_000;

interface Props {
  channel: Channel;
  /** The row the channel was opened from: up/down zaps through it. */
  row: Channel[];
  onChange(c: Channel): void;
  onClose(): void;
}

export function PlayerScreen({ channel, row, onChange, onClose }: Props) {
  const reportStream = useStreamHub((s) => s.reportStream);
  const markWatched = useStreamHub((s) => s.markWatched);
  const toggleFavorite = useStreamHub((s) => s.toggleFavorite);
  const isFav = useStreamHub((s) => s.favorites.includes(channel.id));

  const ctrl = useMemo(() => new FailoverController(channel.streams), [channel.id]);
  const [streamIdx, setStreamIdx] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FailoverState | { kind: 'loading' }>({ kind: 'loading' });
  const [muted, setMuted] = useState(false);
  const [autoMuted, setAutoMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [paused, setPaused] = useState(false);
  const [fitIdx, setFitIdx] = useState(0);
  const [pip, setPip] = useState(0);
  const [chrome, setChrome] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stream = channel.streams[streamIdx];

  // New channel: reset everything.
  useEffect(() => {
    setStreamIdx(0);
    setAttempt(0);
    setState({ kind: 'loading' });
    setPaused(false);
    markWatched(channel.id);
  }, [channel.id, markWatched]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const handleError = useCallback(() => {
    if (!stream) return;
    reportStream(stream.url, false);
    const next = ctrl.onError();
    setState(next);
    if (next.kind === 'retrying') later(() => setAttempt((a) => a + 1), next.delayMs);
    else if (next.kind === 'switching') {
      setStreamIdx(next.to);
      setAttempt((a) => a + 1);
    } else if (next.kind === 'offline') {
      later(() => {
        setStreamIdx(ctrl.currentIndex);
        setAttempt((a) => a + 1);
        setState({ kind: 'loading' });
      }, next.nextRoundInMs);
    }
  }, [ctrl, stream, reportStream]);

  const handlePlaying = useCallback(() => {
    if (stream) reportStream(stream.url, true);
    setState(ctrl.onPlaying());
  }, [ctrl, stream, reportStream]);

  // Stall watchdog: a stream that never starts counts as an error.
  useEffect(() => {
    if (state.kind === 'playing' || state.kind === 'offline') return;
    const t = setTimeout(handleError, STALL_MS);
    return () => clearTimeout(t);
  }, [streamIdx, attempt, state.kind, handleError]);

  const showChrome = useCallback(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), HIDE_MS);
  }, []);
  useEffect(() => {
    showChrome();
    return () => clearTimeout(hideTimer.current);
  }, [channel.id, showChrome]);

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = zap(row, channel.id, dir);
      if (next && next.id !== channel.id) onChange(next);
      showChrome();
    },
    [row, channel.id, onChange, showChrome],
  );

  const toggleFullscreen = () => {
    if (Platform.OS !== 'web') return;
    const d = globalThis.document as Document | undefined;
    if (!d) return;
    if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
    else d.documentElement.requestFullscreen().catch(() => {});
  };

  // Keyboard (Mac / PC browsers)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'Escape' || k === 'Backspace') onClose();
      else if (k === 'ArrowUp' || k === 'PageUp') go(-1);
      else if (k === 'ArrowDown' || k === 'PageDown') go(1);
      else if (k === ' ') setPaused((p) => !p);
      else if (k === 'm' || k === 'M') setMuted((m) => !m);
      else if (k === 'f' || k === 'F') toggleFullscreen();
      else if (k === 'a' || k === 'A') setFitIdx((i) => (i + 1) % FITS.length);
      else if (k === 'ArrowRight') setVolume((v) => Math.min(1, +(v + 0.1).toFixed(1)));
      else if (k === 'ArrowLeft') setVolume((v) => Math.max(0, +(v - 0.1).toFixed(1)));
      else return;
      e.preventDefault();
      showChrome();
    };
    const w = globalThis as unknown as Window;
    w.addEventListener('keydown', onKey);
    return () => w.removeEventListener('keydown', onKey);
  }, [go, onClose, showChrome]);

  // TV remote: up/down zap while controls are hidden, any key shows them.
  useRemote((type) => {
    if (!chrome && (type === 'up' || type === 'down')) go(type === 'up' ? -1 : 1);
    else if (type === 'playPause') setPaused((p) => !p);
    else showChrome();
  });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const q = qualityLabel(stream?.height ?? channel.bestHeight);
  const fit = FITS[fitIdx];
  const isWeb = Platform.OS === 'web';

  return (
    <View style={styles.root}>
      {stream && (
        <StreamVideo
          stream={stream}
          attempt={attempt}
          muted={muted}
          volume={volume}
          paused={paused}
          fit={fit.fit}
          pipRequest={pip}
          onPlaying={handlePlaying}
          onError={handleError}
          onAutoMuted={() => setAutoMuted(true)}
        />
      )}

      <Pressable style={StyleSheet.absoluteFill} onPress={showChrome} focusable={false} />

      {state.kind !== 'playing' && <StatusOverlay state={state} channel={channel} />}

      {autoMuted && state.kind === 'playing' && (
        <Pressable style={styles.unmute} onPress={() => { setAutoMuted(false); setMuted(false); }}>
          <Text style={styles.unmuteText}>🔇  Tap to unmute</Text>
        </Pressable>
      )}

      {(chrome || state.kind !== 'playing') && (
        <>
          <View style={styles.top}>
            <Btn label="‹ Back" onPress={onClose} />
            {channel.logo ? <Image source={{ uri: channel.logo }} style={styles.topLogo} contentFit="contain" /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{channel.name}</Text>
              <Text style={styles.meta}>
                <Text style={{ color: colors.live }}>● LIVE</Text>
                {'   '}{flag(channel.country)} {channel.country ?? 'International'}
                {q ? `   ${q}` : ''}
                {channel.streams.length > 1 ? `   Stream ${streamIdx + 1}/${channel.streams.length}` : ''}
              </Text>
            </View>
            <Btn label={isFav ? '★ Saved' : '☆ Save'} onPress={() => toggleFavorite(channel.id)} gold={isFav} />
          </View>

          <View style={styles.bottom}>
            <Btn label="▲ Prev" onPress={() => go(-1)} />
            <Btn label={paused ? '▶ Play' : '❚❚ Pause'} onPress={() => setPaused((p) => !p)} />
            <Btn label="▼ Next" onPress={() => go(1)} />
            <View style={styles.spacer} />
            <Btn label={muted ? '🔇' : '🔊'} onPress={() => { setMuted((m) => !m); setAutoMuted(false); }} />
            <Btn label="−" onPress={() => setVolume((v) => Math.max(0, +(v - 0.1).toFixed(1)))} />
            <View style={styles.vol}>
              <View style={[styles.volFill, { width: `${Math.round((muted ? 0 : volume) * 100)}%` }]} />
            </View>
            <Btn label="+" onPress={() => setVolume((v) => Math.min(1, +(v + 0.1).toFixed(1)))} />
            <View style={styles.spacer} />
            <Btn label={`⤢ ${fit.label}`} onPress={() => setFitIdx((i) => (i + 1) % FITS.length)} />
            <Btn label="⧉ PiP" onPress={() => setPip((n) => n + 1)} />
            {isWeb && <Btn label="⛶ Full" onPress={toggleFullscreen} />}
          </View>
        </>
      )}
    </View>
  );
}

function StatusOverlay({ state, channel }: { state: FailoverState | { kind: 'loading' }; channel: Channel }) {
  let headline = 'Tuning in…';
  let detail = channel.name;
  if (state.kind === 'retrying') {
    headline = 'Channel Offline - Retrying...';
    detail = `Reconnecting (attempt ${state.attempt} of 2)`;
  } else if (state.kind === 'switching') {
    headline = 'Channel Offline - Retrying...';
    detail = `Switching to backup stream ${state.to + 1} of ${channel.streams.length}`;
  } else if (state.kind === 'offline') {
    headline = 'Channel Offline - Retrying...';
    const n = channel.streams.length;
    detail = `${n > 1 ? `All ${n} streams are` : 'The stream is'} down. Trying again in ${Math.round(state.nextRoundInMs / 1000)}s. Press ▼ Next for another channel.`;
  }
  return (
    <View style={styles.status} pointerEvents="none">
      <View style={styles.pulse} />
      <Text style={styles.statusHead}>{headline}</Text>
      <Text style={styles.statusDetail}>{detail}</Text>
    </View>
  );
}

function Btn({ label, onPress, gold }: { label: string; onPress(): void; gold?: boolean }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onHoverIn={() => setF(true)}
      onHoverOut={() => setF(false)}
      style={[styles.btn, f && styles.btnOn]}
    >
      <Text style={[styles.btnText, gold && { color: colors.gold }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },
  top: {
    position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center',
    gap: 14, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 40,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  topLogo: { width: 64, height: 36 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  meta: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  bottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center',
    flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, paddingBottom: 24, paddingTop: 30,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  spacer: { width: 12 },
  btn: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 2, borderColor: 'transparent',
  },
  btnOn: { borderColor: colors.gold, backgroundColor: 'rgba(245,196,81,0.18)' },
  btnText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  vol: { width: 90, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  volFill: { height: '100%', backgroundColor: colors.gold },
  status: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.overlay, paddingHorizontal: 32,
  },
  pulse: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.gold, marginBottom: 18 },
  statusHead: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  statusDetail: { color: colors.textDim, fontSize: 15, marginTop: 8, textAlign: 'center', maxWidth: 520 },
  unmute: {
    position: 'absolute', alignSelf: 'center', top: '45%', paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.75)', borderWidth: 1, borderColor: colors.gold,
  },
  unmuteText: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
