import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import {
  ChevronDown, ChevronLeft, ChevronUp, Heart, Maximize, Minus, Pause, Play, PictureInPicture2, Plus,
  RectangleHorizontal, RotateCcw, RotateCw, Volume2, VolumeX,
} from 'lucide-react-native';
import type { Channel, Stream } from '../core/types';
import type { Movie } from '../core/movies/types';
import { FailoverController, zap, type FailoverState } from '../core/health/failover';
import { useStreamHub } from '../state/useStreamHub';
import { useRemote } from '../tv/useRemote';
import { CountryTag, LiveBadge, QualityBadge } from '../ui/primitives';
import { colors, fonts, qualityLabel, type } from '../ui/theme';
import StreamVideo from './StreamVideo';
import { ProgressLine, progressOf, useProgramme } from '../components/Guide';
import { clock, useNow } from '../hooks/useNow';
import type { Fit } from './StreamVideo.types';

const FITS: { fit: Fit; label: string }[] = [
  { fit: 'contain', label: 'Fit' },
  { fit: 'fill', label: 'Stretch' },
  { fit: 'cover', label: 'Zoom' },
];
const STALL_MS = 20_000;
const HIDE_MS = 4_000;

export type PlayItem =
  | { kind: 'live'; channel: Channel; row: Channel[] }
  | { kind: 'movie'; movie: Movie; fromStart?: boolean };

interface Props {
  item: PlayItem;
  onChange(item: PlayItem): void;
  onClose(): void;
}

function movieStream(m: Movie): Stream {
  return { url: m.url, height: 0, geoBlocked: false, notAlwaysOn: false, trust: 'public', format: 'progressive', source: 'archive', score: 0 };
}

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export function PlayerScreen({ item, onChange, onClose }: Props) {
  const live = item.kind === 'live';
  const channel = live ? item.channel : undefined;
  const movie = !live ? item.movie : undefined;
  const id = live ? item.channel.id : item.movie.id;
  const streams = useMemo(() => (live ? item.channel.streams : [movieStream(item.movie)]), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reportStream = useStreamHub((s) => s.reportStream);
  const markWatched = useStreamHub((s) => s.markWatched);
  const toggleFavorite = useStreamHub((s) => s.toggleFavorite);
  const toggleMovie = useStreamHub((s) => s.toggleMovie);
  const saveProgress = useStreamHub((s) => s.saveMovieProgress);
  const saved = useStreamHub((s) => (live ? s.favorites.includes(id) : s.movieList.includes(id)));
  const resumeAt = useStreamHub((s) => (!live && !(item as { fromStart?: boolean }).fromStart ? s.movieProgress[id] ?? 0 : 0));

  const ctrl = useMemo(() => new FailoverController(streams), [streams]);
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
  const [time, setTime] = useState({ cur: 0, dur: 0 });
  const [seek, setSeek] = useState<{ to: number; n: number } | undefined>(undefined);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSave = useRef(0);

  const stream = streams[streamIdx];

  useEffect(() => {
    setStreamIdx(0);
    setAttempt(0);
    setState({ kind: 'loading' });
    setPaused(false);
    setTime({ cur: 0, dur: 0 });
    if (live) markWatched(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (state.kind === 'playing' || state.kind === 'offline' || paused) return;
    const t = setTimeout(handleError, STALL_MS);
    return () => clearTimeout(t);
  }, [streamIdx, attempt, state.kind, handleError, paused]);

  const onTime = useCallback(
    (cur: number, dur: number) => {
      setTime({ cur, dur });
      if (!live && cur - lastSave.current > 10) {
        lastSave.current = cur;
        saveProgress(id, dur && cur > dur - 120 ? 0 : cur);
      }
    },
    [live, id, saveProgress],
  );

  const showChrome = useCallback(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), HIDE_MS);
  }, []);
  useEffect(() => {
    showChrome();
    return () => clearTimeout(hideTimer.current);
  }, [id, showChrome]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (item.kind !== 'live') return;
      const next = zap(item.row, item.channel.id, dir);
      if (next && next.id !== item.channel.id) onChange({ ...item, channel: next });
      showChrome();
    },
    [item, onChange, showChrome],
  );

  const seekBy = useCallback(
    (d: number) => {
      setSeek({ to: time.cur + d, n: Date.now() });
      showChrome();
    },
    [time.cur, showChrome],
  );

  const toggleFullscreen = () => {
    if (Platform.OS !== 'web') return;
    const d = globalThis.document as Document | undefined;
    if (!d) return;
    if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
    else d.documentElement.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'Escape' || k === 'Backspace') onClose();
      else if (live && (k === 'ArrowUp' || k === 'PageUp')) go(-1);
      else if (live && (k === 'ArrowDown' || k === 'PageDown')) go(1);
      else if (!live && k === 'ArrowRight') seekBy(10);
      else if (!live && k === 'ArrowLeft') seekBy(-10);
      else if (k === ' ' || k === 'k') setPaused((p) => !p);
      else if (k === 'm' || k === 'M') setMuted((m) => !m);
      else if (k === 'f' || k === 'F') toggleFullscreen();
      else if (k === 'a' || k === 'A') setFitIdx((i) => (i + 1) % FITS.length);
      else if (live && k === 'ArrowRight') setVolume((v) => Math.min(1, +(v + 0.1).toFixed(1)));
      else if (live && k === 'ArrowLeft') setVolume((v) => Math.max(0, +(v - 0.1).toFixed(1)));
      else return;
      e.preventDefault();
      showChrome();
    };
    const w = globalThis as unknown as Window;
    w.addEventListener('keydown', onKey);
    return () => w.removeEventListener('keydown', onKey);
  }, [go, onClose, showChrome, seekBy, live]);

  useRemote((t) => {
    if (live && !chrome && (t === 'up' || t === 'down')) go(t === 'up' ? -1 : 1);
    else if (!live && !chrome && (t === 'left' || t === 'right')) seekBy(t === 'right' ? 10 : -10);
    else if (t === 'playPause') setPaused((p) => !p);
    else if (t === 'fastForward') seekBy(30);
    else if (t === 'rewind') seekBy(-30);
    else showChrome();
  });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const fit = FITS[fitIdx];
  const isWeb = Platform.OS === 'web';
  const nowSec = useNow();
  const guide = useProgramme(id, nowSec);
  const title = channel?.name ?? movie?.title ?? '';
  const ic = colors.text;

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
          seek={seek}
          startAt={resumeAt > 60 ? resumeAt : undefined}
          onTime={onTime}
          onEnded={() => !live && saveProgress(id, 0)}
          onPlaying={handlePlaying}
          onError={handleError}
          onAutoMuted={() => setAutoMuted(true)}
        />
      )}

      <Pressable style={StyleSheet.absoluteFill} onPress={showChrome} focusable={false} />

      {state.kind !== 'playing' && <StatusOverlay state={state} title={title} sources={streams.length} live={live} />}

      {autoMuted && state.kind === 'playing' && (
        <Pressable style={styles.unmute} onPress={() => { setAutoMuted(false); setMuted(false); }}>
          <VolumeX size={18} color={colors.text} />
          <Text style={styles.unmuteText}>Tap to unmute</Text>
        </Pressable>
      )}

      {(chrome || state.kind !== 'playing') && (
        <>
          <View style={styles.top}>
            <IconBtn onPress={onClose} label="Back"><ChevronLeft size={24} color={ic} /></IconBtn>
            {channel?.logo ? <Image source={{ uri: channel.logo }} style={styles.topLogo} contentFit="contain" /> : null}
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              <View style={styles.metaRow}>
                {live ? <LiveBadge /> : null}
                {channel ? <CountryTag country={channel.country} /> : null}
                {channel ? <QualityBadge label={qualityLabel(stream?.height ?? channel.bestHeight)} /> : null}
                {movie ? <Text style={styles.meta}>{[movie.year, movie.genres[0]].filter(Boolean).join('  ·  ')}</Text> : null}
                {channel && streams.length > 1 ? <Text style={styles.meta}>Source {streamIdx + 1} of {streams.length}</Text> : null}
                {movie?.imdbRating ? <Text style={styles.imdb}>IMDb {movie.imdbRating.toFixed(1)}</Text> : null}
                {movie?.quality ? <Text style={styles.meta}>{movie.quality}</Text> : null}
              </View>
              {live && guide.now ? (
                <View style={styles.onNow}>
                  <Text style={styles.onNowText} numberOfLines={1}>
                    <Text style={{ color: colors.gold }}>Now </Text>
                    {guide.now[2]}
                    <Text style={styles.meta}>{`   ${clock(guide.now[0])} - ${clock(guide.now[1])}`}</Text>
                    {guide.next[0] ? <Text style={styles.meta}>{`   ·   Next at ${clock(guide.next[0][0])}: ${guide.next[0][2]}`}</Text> : null}
                  </Text>
                  <View style={{ width: 260 }}>
                    <ProgressLine value={progressOf(guide.now, nowSec)} />
                  </View>
                </View>
              ) : live && channel?.tagline ? (
                <Text style={styles.meta}>{channel.tagline}</Text>
              ) : null}
              {movie && (movie.director?.length || movie.cast?.length) ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {[movie.director?.length ? `Directed by ${movie.director.join(', ')}` : '', movie.cast?.length ? `With ${movie.cast.slice(0, 4).join(', ')}` : '']
                    .filter(Boolean)
                    .join('   ·   ')}
                </Text>
              ) : null}
            </View>
            <IconBtn onPress={() => (live ? toggleFavorite(id) : toggleMovie(id))} label={saved ? 'Remove from My List' : 'Add to My List'}>
              <Heart size={22} color={saved ? colors.gold : ic} fill={saved ? colors.gold : 'transparent'} />
            </IconBtn>
          </View>

          <View style={styles.bottom}>
            {!live && (
              <Scrubber cur={time.cur} dur={time.dur} onSeek={(t) => { setSeek({ to: t, n: Date.now() }); showChrome(); }} />
            )}
            <View style={styles.controls}>
              {live ? (
                <>
                  <IconBtn onPress={() => go(-1)} label="Previous channel"><ChevronUp size={22} color={ic} /></IconBtn>
                  <IconBtn onPress={() => setPaused((p) => !p)} label={paused ? 'Play' : 'Pause'} big>
                    {paused ? <Play size={24} color={ic} fill={ic} /> : <Pause size={24} color={ic} fill={ic} />}
                  </IconBtn>
                  <IconBtn onPress={() => go(1)} label="Next channel"><ChevronDown size={22} color={ic} /></IconBtn>
                </>
              ) : (
                <>
                  <IconBtn onPress={() => seekBy(-10)} label="Back 10 seconds"><RotateCcw size={20} color={ic} /></IconBtn>
                  <IconBtn onPress={() => setPaused((p) => !p)} label={paused ? 'Play' : 'Pause'} big>
                    {paused ? <Play size={24} color={ic} fill={ic} /> : <Pause size={24} color={ic} fill={ic} />}
                  </IconBtn>
                  <IconBtn onPress={() => seekBy(10)} label="Forward 10 seconds"><RotateCw size={20} color={ic} /></IconBtn>
                </>
              )}
              <View style={styles.sep} />
              <IconBtn onPress={() => { setMuted((m) => !m); setAutoMuted(false); }} label={muted ? 'Unmute' : 'Mute'}>
                {muted ? <VolumeX size={20} color={ic} /> : <Volume2 size={20} color={ic} />}
              </IconBtn>
              <IconBtn onPress={() => setVolume((v) => Math.max(0, +(v - 0.1).toFixed(1)))} label="Volume down"><Minus size={18} color={ic} /></IconBtn>
              <View style={styles.vol}>
                <View style={[styles.volFill, { width: `${Math.round((muted ? 0 : volume) * 100)}%` }]} />
              </View>
              <IconBtn onPress={() => setVolume((v) => Math.min(1, +(v + 0.1).toFixed(1)))} label="Volume up"><Plus size={18} color={ic} /></IconBtn>
              <View style={{ flex: 1 }} />
              <TextBtn onPress={() => setFitIdx((i) => (i + 1) % FITS.length)} label={fit.label} icon={<RectangleHorizontal size={18} color={ic} />} />
              <IconBtn onPress={() => setPip((n) => n + 1)} label="Picture in picture"><PictureInPicture2 size={20} color={ic} /></IconBtn>
              {isWeb && <IconBtn onPress={toggleFullscreen} label="Fullscreen"><Maximize size={20} color={ic} /></IconBtn>}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

function Scrubber({ cur, dur, onSeek }: { cur: number; dur: number; onSeek(t: number): void }) {
  const [w, setW] = useState(1);
  const pct = dur ? Math.min(1, cur / dur) : 0;
  const pick = (e: GestureResponderEvent) => dur && onSeek((e.nativeEvent.locationX / w) * dur);
  return (
    <View style={styles.scrubRow}>
      <Text style={styles.time}>{fmt(cur)}</Text>
      <Pressable style={styles.scrub} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} onPress={pick}>
        <View style={styles.scrubTrack}>
          <View style={[styles.scrubFill, { width: `${pct * 100}%` }]} />
        </View>
        <View style={[styles.knob, { left: `${pct * 100}%` }]} />
      </Pressable>
      <Text style={styles.time}>{dur ? fmt(dur) : '--:--'}</Text>
    </View>
  );
}

function StatusOverlay({ state, title, sources, live }: { state: FailoverState | { kind: 'loading' }; title: string; sources: number; live: boolean }) {
  let headline = live ? 'Tuning in' : 'Loading';
  let detail = title;
  if (state.kind === 'retrying') {
    headline = live ? 'Channel Offline - Retrying...' : 'Reconnecting...';
    detail = `Reconnecting, attempt ${state.attempt} of 2`;
  } else if (state.kind === 'switching') {
    headline = 'Channel Offline - Retrying...';
    detail = `Switching to backup source ${state.to + 1} of ${sources}`;
  } else if (state.kind === 'offline') {
    headline = live ? 'Channel Offline - Retrying...' : 'This film is unavailable right now';
    detail = `${sources > 1 ? `All ${sources} sources are` : 'The source is'} down. Trying again in ${Math.round(state.nextRoundInMs / 1000)}s.${live ? ' Press the down arrow for the next channel.' : ''}`;
  }
  return (
    <View style={styles.status} pointerEvents="none">
      <View style={styles.spinner} />
      <Text style={styles.statusHead}>{headline}</Text>
      <Text style={styles.statusDetail}>{detail}</Text>
    </View>
  );
}

function IconBtn({ children, onPress, label, big }: { children: React.ReactNode; onPress(): void; label: string; big?: boolean }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onHoverIn={() => setF(true)}
      onHoverOut={() => setF(false)}
      accessibilityLabel={label}
      style={[styles.icon, big && styles.iconBig, f && styles.iconOn]}
    >
      {children}
    </Pressable>
  );
}

function TextBtn({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress(): void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onHoverIn={() => setF(true)}
      onHoverOut={() => setF(false)}
      style={[styles.textBtn, f && styles.iconOn]}
    >
      {icon}
      <Text style={styles.textBtnLabel}>{label}</Text>
    </Pressable>
  );
}

const fill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

const styles = StyleSheet.create({
  root: { ...fill, backgroundColor: '#000' },
  top: {
    position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingHorizontal: 28, paddingTop: 24, paddingBottom: 48, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  topLogo: { width: 72, height: 40 },
  title: { ...type.h1, color: colors.text, fontSize: 26 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  meta: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 13 },
  imdb: {
    color: '#000', backgroundColor: '#F5C518', fontFamily: fonts.bodyBold, fontSize: 12, paddingHorizontal: 6,
    paddingVertical: 1, borderRadius: 4, overflow: 'hidden',
  },
  onNow: { gap: 2, marginTop: 2 },
  onNowText: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 14 },
  bottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 28, paddingBottom: 26, paddingTop: 40,
    backgroundColor: 'rgba(0,0,0,0.5)', gap: 14,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sep: { width: 14 },
  icon: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: 'transparent',
  },
  iconBig: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.16)' },
  iconOn: { borderColor: colors.focus, backgroundColor: 'rgba(255,255,255,0.22)' },
  textBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: 'transparent',
  },
  textBtnLabel: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13 },
  vol: { width: 96, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  volFill: { height: '100%', backgroundColor: colors.text },
  scrubRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  time: { color: colors.textDim, fontFamily: fonts.bodySemi, fontSize: 12, width: 56, textAlign: 'center' },
  scrub: { flex: 1, height: 24, justifyContent: 'center' },
  scrubTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  scrubFill: { height: '100%', backgroundColor: colors.gold },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.text },
  status: { ...fill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay, paddingHorizontal: 32 },
  spinner: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: 'rgba(255,255,255,0.15)',
    borderTopColor: colors.gold, marginBottom: 20,
  },
  statusHead: { ...type.h2, color: colors.text, fontSize: 24, textAlign: 'center' },
  statusDetail: { color: colors.textDim, fontFamily: fonts.body, fontSize: 15, marginTop: 8, textAlign: 'center', maxWidth: 540 },
  unmute: {
    position: 'absolute', alignSelf: 'center', top: '45%', flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1, borderColor: colors.lineHi,
  },
  unmuteText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 15 },
});
