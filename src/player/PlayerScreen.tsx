import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import {
  Airplay, CalendarDays, Captions, Cast, ChevronDown, SkipForward, ChevronLeft, ChevronUp, Heart, Maximize, Minus, Pause, Play, PictureInPicture2, Plus,
  RectangleHorizontal, RotateCcw, RotateCw, Volume2, VolumeX,
} from 'lucide-react-native';
import type { Channel, Stream } from '../core/types';
import type { Movie } from '../core/movies/types';
import type { Show } from '../core/shows/types';
import { FailoverController, zap, type FailoverState } from '../core/health/failover';
import { useStreamHub } from '../state/useStreamHub';
import { useRemote } from '../tv/useRemote';
import { overlayOpen, useUi } from '../state/ui';
import { CountryTag, LiveBadge, QualityBadge } from '../ui/primitives';
import { colors, fonts, qualityLabel, type } from '../ui/theme';
import { useLayout } from '../ui/layout';
import { corsBlocked } from '../core/platform/compat';
import { detectDevice } from '../services/device';

const DEVICE = detectDevice();
import StreamVideo from './MediaView';
import { airPlaySupported, castMedia, connectCast, remote, stopCasting, useCast, useCastStore } from './cast/useCast';
import AirPlayNative from './cast/AirPlayNative';
import { ProgressLine, progressOf, useProgramme } from '../components/Guide';
import { clock, useNow } from '../hooks/useNow';
import type { Fit } from './StreamVideo.types';
import { SUB_LANGS, type StreamTrack } from '../core/subtitles';
import { SubtitleMenu, SubtitleOverlay, subOptions, useSubtitleFile } from './Subtitles';

const FITS: { fit: Fit; label: string }[] = [
  { fit: 'contain', label: 'Fit' },
  { fit: 'fill', label: 'Stretch' },
  { fit: 'cover', label: 'Zoom' },
];
const STALL_MS = 20_000;
const HIDE_MS = 4_000;

export type PlayItem =
  | { kind: 'live'; channel: Channel; row: Channel[] }
  | { kind: 'movie'; movie: Movie; fromStart?: boolean }
  | { kind: 'episode'; show: Show; index: number; fromStart?: boolean };

/** Episodes play through the movie path: same scrubber, resume and progress. */
function asMovie(item: Exclude<PlayItem, { kind: 'live' }>): Movie {
  if (item.kind === 'movie') return item.movie;
  const ep = item.show.episodes[item.index];
  const se = ep.season ? `S${ep.season} E${ep.episode ?? item.index + 1}` : `Episode ${ep.episode ?? item.index + 1}`;
  return {
    id: ep.id, title: `${item.show.title}: ${ep.title}`, year: item.show.year, genres: [se, ...item.show.genres.slice(0, 1)],
    description: item.show.description, poster: item.show.poster, url: ep.url, minutes: ep.minutes, source: item.show.source, popularity: 0,
  };
}

interface Props {
  item: PlayItem;
  onChange(item: PlayItem): void;
  onClose(): void;
}

function movieStream(m: Movie): Stream {
  const format = /youtube(-nocookie)?\.com\/embed\//.test(m.url) ? 'youtube' : 'progressive';
  return { url: m.url, height: 0, geoBlocked: false, notAlwaysOn: false, trust: 'public', format, source: m.source, score: 0 };
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
  const movie = item.kind !== 'live' ? asMovie(item) : undefined;
  const id = live ? item.channel.id : movie!.id;
  const streams = useMemo(() => (live ? item.channel.streams : [movieStream(movie!)]), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reportStream = useStreamHub((s) => s.reportStream);
  const markWatched = useStreamHub((s) => s.markWatched);
  const toggleFavorite = useStreamHub((s) => s.toggleFavorite);
  const toggleMovie = useStreamHub((s) => s.toggleMovie);
  const saveProgress = useStreamHub((s) => s.saveMovieProgress);
  const saved = useStreamHub((s) => (live ? s.favorites.includes(id) : s.movieList.includes(item.kind === 'episode' ? item.show.id : id)));
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
  // Subtitles: the profile's language, from the broadcast's own tracks or a subtitle file.
  const subLang = useStreamHub((s) => s.subLang);
  const setSubLang = useStreamHub((s) => s.setSubLang);
  const [inTracks, setInTracks] = useState<StreamTrack[]>([]);
  const [subMenu, setSubMenu] = useState(false);
  const subMenuRef = useRef(false);
  subMenuRef.current = subMenu;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSave = useRef(0);

  const stream = streams[streamIdx];
  const nowSec = useNow();
  // Phones and narrow windows: two-row top bar and two-row controls so nothing overlaps.
  const L = useLayout();
  const narrow = L.width < 820;
  // Landscape phones: little height, so tighter bars and a smaller status message.
  const short = L.height < 500;
  useEffect(() => setInTracks([]), [stream?.url, attempt]);
  const subFiles = item.kind === 'movie' ? item.movie.subs : item.kind === 'episode' ? item.show.episodes[item.index]?.subs : undefined;
  const subOpts = useMemo(() => subOptions(inTracks, subFiles), [inTracks, subFiles]);
  const activeSub = subLang === 'off' ? undefined : subOpts.find((o) => o.code === subLang);
  const textTrack = activeSub?.track?.id ?? null;
  const sideCues = useSubtitleFile(!activeSub?.track ? activeSub?.file?.url : undefined);
  const subOn = !!(activeSub?.track || activeSub?.file);
  const guide = useProgramme(id, nowSec);

  // Chromecast: while a TV is connected, nothing plays here and this screen
  // is the remote. Channel switches and next episodes follow to the TV.
  const cast = useCast();
  // YouTube videos can't be sent with the Cast button (YouTube only allows its own
  // apps to do that), so those keep playing here while a TV stays connected.
  const castConnected = !!cast.device;
  const casting = castConnected && stream?.format !== 'youtube';
  const [airplay, setAirplay] = useState(0);
  const sendToTv = useCallback(async () => {
    if (!stream || stream.format === 'youtube') return;
    try {
      await castMedia({
        url: stream.url,
        format: stream.format,
        live,
        title: channel?.name ?? movie?.title ?? '',
        subtitle: live ? guide.now?.[2] ?? channel?.tagline : movie?.year ? String(movie.year) : undefined,
        image: channel?.logo ?? movie?.posterHi ?? movie?.poster,
        startAt: live ? undefined : (time.cur || resumeAt) > 5 ? time.cur || resumeAt : undefined,
        key: `${item.kind}:${id}`,
      });
    } catch {
      // the store carries a friendly error for the overlay
    }
  }, [stream, live, channel, movie, guide.now, time.cur, resumeAt, item.kind, id]);
  useEffect(() => {
    if (casting && stream && useCastStore.getState().media?.url !== stream.url) sendToTv();
  }, [casting, stream?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  // When the TV session ends, pick up playback here again.
  const wasCasting = useRef(false);
  useEffect(() => {
    if (wasCasting.current && !casting) setPaused(false);
    wasCasting.current = casting;
  }, [casting]);

  // One set of controls for both: local playback or the TV.
  const isPaused = casting ? cast.paused : paused;
  const isMuted = casting ? cast.muted : muted;
  const vol = casting ? cast.volume : volume;
  const cur = casting ? cast.currentTime : time.cur;
  const dur = casting ? cast.duration : time.dur;
  const doPlayPause = () => (casting ? remote.playPause() : setPaused((p) => !p));
  const doMute = () => {
    if (casting) remote.mute();
    else {
      setMuted((m) => !m);
      setAutoMuted(false);
    }
  };
  const doVolume = (d: number) => {
    if (casting) remote.volume(+(cast.volume + d).toFixed(1));
    else setVolume((v) => Math.max(0, Math.min(1, +(v + d).toFixed(1))));
  };
  const doSeek = (t: number) => (casting ? remote.seek(t) : setSeek({ to: t, n: Date.now() }));

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
    if (casting || state.kind === 'playing' || state.kind === 'offline' || paused) return;
    const t = setTimeout(handleError, STALL_MS);
    return () => clearTimeout(t);
  }, [streamIdx, attempt, state.kind, handleError, paused, casting]);

  const onTime = useCallback(
    (cur: number, dur: number) => {
      setTime({ cur, dur });
      if (!live && !id.startsWith('trailer:') && cur - lastSave.current > 10) {
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
      doSeek(cur + d);
      showChrome();
    },
    [cur, showChrome, casting], // eslint-disable-line react-hooks/exhaustive-deps
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
      if (overlayOpen()) return; // the schedule sheet owns the keys
      const k = e.key;
      if (subMenuRef.current && (k === 'Escape' || k === 'Backspace')) {
        e.preventDefault();
        e.stopPropagation();
        setSubMenu(false);
        return;
      }
      if (k === 'c' || k === 'C') {
        setSubMenu((m) => !m);
        showChrome();
        e.preventDefault();
        return;
      }
      if (k === 'Escape' || k === 'Backspace') onClose();
      else if (live && (k === 'ArrowUp' || k === 'PageUp')) go(-1);
      else if (live && (k === 'ArrowDown' || k === 'PageDown')) go(1);
      else if (!live && k === 'ArrowRight') seekBy(10);
      else if (!live && k === 'ArrowLeft') seekBy(-10);
      else if (k === ' ' || k === 'k') doPlayPause();
      else if (k === 'm' || k === 'M') doMute();
      else if (k === 'f' || k === 'F') toggleFullscreen();
      else if (k === 'a' || k === 'A') setFitIdx((i) => (i + 1) % FITS.length);
      else if (live && k === 'ArrowRight') doVolume(0.1);
      else if (live && k === 'ArrowLeft') doVolume(-0.1);
      else return;
      // Handled here: stop the focused button from also reacting (no double toggles).
      e.preventDefault();
      e.stopPropagation();
      showChrome();
    };
    const w = globalThis as unknown as Window;
    w.addEventListener('keydown', onKey, true);
    return () => w.removeEventListener('keydown', onKey, true);
  }, [go, onClose, showChrome, seekBy, live, casting, cast.volume]); // eslint-disable-line react-hooks/exhaustive-deps

  useRemote((t) => {
    if (overlayOpen()) return;
    if (live && !chrome && (t === 'up' || t === 'down')) go(t === 'up' ? -1 : 1);
    else if (!live && !chrome && (t === 'left' || t === 'right')) seekBy(t === 'right' ? 10 : -10);
    else if (t === 'playPause') doPlayPause();
    else if (t === 'fastForward') seekBy(30);
    else if (t === 'rewind') seekBy(-30);
    else showChrome();
  });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (subMenuRef.current) setSubMenu(false);
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const fit = FITS[fitIdx];
  const isWeb = Platform.OS === 'web';
  const title = channel?.name ?? movie?.title ?? '';
  const ic = colors.text;

  const info = (
    <View style={styles.info}>
      <Text style={[styles.title, (narrow || short) && styles.titleNarrow]} numberOfLines={narrow ? 2 : 1}>{title}</Text>
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
          <Text style={styles.onNowText} numberOfLines={narrow ? 2 : 1}>
            <Text style={{ color: colors.gold }}>Now </Text>
            {guide.now[2]}
            <Text style={styles.meta}>{`   ${clock(guide.now[0])} - ${clock(guide.now[1])}`}</Text>
            {!narrow && guide.next[0] ? <Text style={styles.meta}>{`   ·   Next at ${clock(guide.next[0][0])}: ${guide.next[0][2]}`}</Text> : null}
          </Text>
          <View style={{ width: narrow ? '100%' : 260 }}>
            <ProgressLine value={progressOf(guide.now, nowSec)} />
          </View>
        </View>
      ) : live && channel?.tagline ? (
        <Text style={styles.meta} numberOfLines={2}>{channel.tagline}</Text>
      ) : null}
      {movie && (movie.director?.length || movie.cast?.length) ? (
        <Text style={styles.meta} numberOfLines={narrow ? 2 : 1}>
          {[movie.director?.length ? `Directed by ${movie.director.join(', ')}` : '', movie.cast?.length ? `With ${movie.cast.slice(0, 4).join(', ')}` : '']
            .filter(Boolean)
            .join('   ·   ')}
        </Text>
      ) : null}
    </View>
  );
  const actions = (
    <>
      {stream?.format !== 'youtube' && (cast.available || casting) ? (
        <IconBtn onPress={() => (casting ? stopCasting() : connectCast())} label={casting ? 'Stop casting' : 'Cast to TV'}>
          <Cast size={22} color={casting ? colors.gold : ic} />
        </IconBtn>
      ) : null}
      {Platform.OS === 'web' && airPlaySupported() ? (
        <IconBtn onPress={() => setAirplay((n) => n + 1)} label="AirPlay to TV">
          <Airplay size={22} color={ic} />
        </IconBtn>
      ) : null}
      {Platform.OS === 'ios' ? <AirPlayNative /> : null}
      {item.kind === 'episode' && item.index + 1 < item.show.episodes.length ? (
        narrow ? (
          <IconBtn onPress={() => onChange({ ...item, index: item.index + 1, fromStart: true })} label="Next episode"><SkipForward size={20} color={ic} /></IconBtn>
        ) : (
          <TextBtn label="Next episode" icon={<ChevronDown size={18} color={ic} style={{ transform: [{ rotate: '-90deg' }] }} />} onPress={() => onChange({ ...item, index: item.index + 1, fromStart: true })} />
        )
      ) : null}
      {!casting ? (
        <IconBtn onPress={() => { setSubMenu((m) => !m); showChrome(); }} label="Subtitles">
          <Captions size={22} color={subOn ? colors.gold : ic} />
        </IconBtn>
      ) : null}
      {live && channel ? (
        <IconBtn onPress={() => useUi.getState().openSchedule(channel)} label="Full schedule">
          <CalendarDays size={22} color={ic} />
        </IconBtn>
      ) : null}
      <IconBtn onPress={() => (live ? toggleFavorite(id) : toggleMovie(item.kind === 'episode' ? item.show.id : id))} label={saved ? 'Remove from My List' : 'Add to My List'}>
        <Heart size={22} color={saved ? colors.gold : ic} fill={saved ? colors.gold : 'transparent'} />
      </IconBtn>
    </>
  );
  const transport = live ? (
    <>
      <IconBtn onPress={() => go(-1)} label="Previous channel"><ChevronUp size={22} color={ic} /></IconBtn>
      <IconBtn onPress={doPlayPause} label={isPaused ? 'Play' : 'Pause'} big>
        {isPaused ? <Play size={24} color={ic} fill={ic} /> : <Pause size={24} color={ic} fill={ic} />}
      </IconBtn>
      <IconBtn onPress={() => go(1)} label="Next channel"><ChevronDown size={22} color={ic} /></IconBtn>
    </>
  ) : (
    <>
      <IconBtn onPress={() => seekBy(-10)} label="Back 10 seconds"><RotateCcw size={20} color={ic} /></IconBtn>
      <IconBtn onPress={doPlayPause} label={isPaused ? 'Play' : 'Pause'} big>
        {isPaused ? <Play size={24} color={ic} fill={ic} /> : <Pause size={24} color={ic} fill={ic} />}
      </IconBtn>
      <IconBtn onPress={() => seekBy(10)} label="Forward 10 seconds"><RotateCw size={20} color={ic} /></IconBtn>
    </>
  );
  const muteBtn = (
    <IconBtn onPress={doMute} label={isMuted ? 'Unmute' : 'Mute'}>
      {isMuted ? <VolumeX size={20} color={ic} /> : <Volume2 size={20} color={ic} />}
    </IconBtn>
  );
  const screenBtns = (
    <>
      <TextBtn onPress={() => setFitIdx((i) => (i + 1) % FITS.length)} label={fit.label} icon={<RectangleHorizontal size={18} color={ic} />} />
      <IconBtn onPress={() => setPip((n) => n + 1)} label="Picture in picture"><PictureInPicture2 size={20} color={ic} /></IconBtn>
      {isWeb && <IconBtn onPress={toggleFullscreen} label="Fullscreen"><Maximize size={20} color={ic} /></IconBtn>}
    </>
  );

  return (
    <View style={styles.root}>
      {stream && !casting && (
        <StreamVideo
          stream={stream}
          attempt={attempt}
          muted={muted}
          volume={volume}
          paused={paused}
          fit={fit.fit}
          pipRequest={pip}
          airplayRequest={airplay}
          seek={seek}
          startAt={resumeAt > 60 ? resumeAt : undefined}
          onTime={onTime}
          onEnded={() => {
            if (live) return;
            saveProgress(id, 0);
            // Series: roll straight into the next episode.
            if (item.kind === 'episode' && item.index + 1 < item.show.episodes.length) onChange({ ...item, index: item.index + 1, fromStart: true });
          }}
          onPlaying={handlePlaying}
          onError={handleError}
          onAutoMuted={() => setAutoMuted(true)}
          textTrack={textTrack}
          onTextTracks={setInTracks}
        />
      )}

      <Pressable style={StyleSheet.absoluteFill} onPress={showChrome} focusable={false} />

      {casting ? (
        <View style={styles.casting} pointerEvents="box-none">
          <Cast size={46} color={colors.gold} />
          <Text style={styles.castHead}>Playing on {cast.device}</Text>
          <Text style={styles.statusDetail}>
            {cast.error ?? (live ? 'Use channel up and down here to change the channel on the TV.' : 'This screen is your remote: pause, seek and volume control the TV.')}
          </Text>
          <Pressable style={styles.castStop} onPress={() => stopCasting()}>
            <Text style={styles.unmuteText}>Stop casting</Text>
          </Pressable>
        </View>
      ) : state.kind !== 'playing' ? (
        <StatusOverlay state={state} title={title} sources={streams.length} live={live} small={short} safariOnly={streams.length > 0 && streams.every((x) => corsBlocked(x, DEVICE))} />
      ) : null}

      {!casting && sideCues ? <SubtitleOverlay cues={sideCues} time={time.cur} rtl={SUB_LANGS.find((l) => l.code === subLang)?.rtl} raised={chrome} narrow={narrow} /> : null}
      {castConnected && !casting ? (
        <View style={styles.ytHint} pointerEvents="none">
          <Text style={styles.ytHintText}>
            This title is from YouTube, so it plays here. To show it on {cast.device}, use Chrome's menu, then Cast, then Cast tab.
          </Text>
        </View>
      ) : null}
      {(chrome || casting || state.kind !== 'playing') && (
        <>
          <View style={[styles.top, narrow && styles.topNarrow, short && styles.topShort]}>
            {narrow ? (
              <>
                <View style={styles.topRow}>
                  <IconBtn onPress={onClose} label="Back"><ChevronLeft size={24} color={ic} /></IconBtn>
                  <View style={{ flex: 1 }} />
                  {actions}
                </View>
                <View style={styles.topRow}>
                  {channel?.logo ? <Image source={{ uri: channel.logo }} style={styles.topLogoSmall} contentFit="contain" /> : null}
                  {info}
                </View>
              </>
            ) : (
              <>
                <IconBtn onPress={onClose} label="Back"><ChevronLeft size={24} color={ic} /></IconBtn>
                {channel?.logo ? <Image source={{ uri: channel.logo }} style={styles.topLogo} contentFit="contain" /> : null}
                {info}
                {actions}
              </>
            )}
          </View>

          <View style={[styles.bottom, narrow && styles.bottomNarrow, short && styles.bottomShort]}>
            {!live && (
              <Scrubber cur={cur} dur={dur} onSeek={(t) => { doSeek(t); showChrome(); }} />
            )}
            {narrow ? (
              <>
                <View style={styles.transportRow}>{transport}</View>
                <View style={styles.controlsRow}>
                  {muteBtn}
                  <View style={{ flex: 1 }} />
                  {screenBtns}
                </View>
              </>
            ) : (
              <View style={styles.controls}>
                {transport}
                <View style={styles.sep} />
                {muteBtn}
                <IconBtn onPress={() => doVolume(-0.1)} label="Volume down"><Minus size={18} color={ic} /></IconBtn>
                <View style={styles.vol}>
                  <View style={[styles.volFill, { width: `${Math.round((isMuted ? 0 : vol) * 100)}%` }]} />
                </View>
                <IconBtn onPress={() => doVolume(0.1)} label="Volume up"><Plus size={18} color={ic} /></IconBtn>
                <View style={{ flex: 1 }} />
                {screenBtns}
              </View>
            )}
          </View>
        </>
      )}
      {subMenu ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSubMenu(false)} accessibilityLabel="Close subtitles menu" />
          <SubtitleMenu
            narrow={narrow}
            choice={subLang}
            options={subOpts}
            onPick={(c) => {
              setSubLang(c);
              setSubMenu(false);
            }}
          />
        </>
      ) : null}
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

function StatusOverlay({ state, title, sources, live, small, safariOnly }: { state: FailoverState | { kind: 'loading' }; title: string; sources: number; live: boolean; small?: boolean; safariOnly?: boolean }) {
  let headline = live ? 'Tuning in' : 'Loading';
  let detail = title;
  if (state.kind === 'retrying') {
    headline = live ? 'Channel Offline - Retrying...' : 'Reconnecting...';
    detail = `Reconnecting, attempt ${state.attempt} of 2`;
  } else if (state.kind === 'switching') {
    headline = 'Channel Offline - Retrying...';
    detail = `Switching to backup source ${state.to + 1} of ${sources}`;
  }
  if (safariOnly && state.kind !== 'loading') {
    // The channel's own server refuses to play inside other websites in Chrome / Edge / Firefox.
    headline = 'Open this channel in Safari';
    detail = 'This broadcaster only allows its stream inside other websites in Safari. Open StreamHub in Safari on your Mac or iPhone (or use the Fire TV app) to watch it.';
  } else if (state.kind === 'offline') {
    headline = live ? 'Channel Offline - Retrying...' : 'This film is unavailable right now';
    detail = `${sources > 1 ? `All ${sources} sources are` : 'The source is'} down. Trying again in ${Math.round(state.nextRoundInMs / 1000)}s.${live ? ' Press the down arrow for the next channel.' : ''}`;
  }
  return (
    <View style={styles.status} pointerEvents="none">
      {small ? null : <View style={styles.spinner} />}
      <Text style={[styles.statusHead, small && { fontSize: 18 }]}>{headline}</Text>
      <Text style={[styles.statusDetail, small && { fontSize: 13, marginTop: 4 }]} numberOfLines={small ? 2 : undefined}>{detail}</Text>
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
  topNarrow: {
    flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 22,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topShort: { paddingTop: 10, paddingBottom: 14, gap: 12 },
  bottomShort: { paddingTop: 14, paddingBottom: 10, gap: 8 },
  topLogo: { width: 72, height: 40 },
  topLogoSmall: { width: 52, height: 32, alignSelf: 'flex-start', marginTop: 2 },
  info: { flex: 1, minWidth: 0, flexShrink: 1, gap: 6 },
  title: { ...type.h1, color: colors.text, fontSize: 26 },
  titleNarrow: { fontSize: 20, lineHeight: 25 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 6 },
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
  bottomNarrow: { paddingHorizontal: 16, paddingBottom: 20, paddingTop: 28, gap: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  transportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  ytHint: {
    position: 'absolute', top: 110, alignSelf: 'center', maxWidth: 560, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 14, backgroundColor: 'rgba(28,23,25,0.86)', borderWidth: 1, borderColor: colors.lineHi,
  },
  ytHintText: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 13.5, textAlign: 'center' },
  casting: { ...fill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(28,23,25,0.92)', gap: 10, paddingHorizontal: 32 },
  castHead: { ...type.h2, color: colors.text, fontSize: 26, textAlign: 'center' },
  castStop: {
    marginTop: 14, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24, borderWidth: 1.5, borderColor: colors.lineHi,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
