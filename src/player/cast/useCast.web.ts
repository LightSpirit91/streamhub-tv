import { create } from 'zustand';

/**
 * Google Cast (Chromecast / Google TV) for the whole app, from Chrome on
 * Mac, PC and Android. One global session: connect once from the top bar,
 * then everything you open (channels, movies, episodes) plays on the TV
 * and this device becomes the remote.
 * Uses Google's Cast Web Sender SDK and the Default Media Receiver.
 */
type W = Window & {
  __onGCastApiAvailable?: (ok: boolean) => void;
  cast?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  chrome?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const w = globalThis as unknown as W;

export interface CastMedia {
  url: string;
  title: string;
  subtitle?: string;
  image?: string;
  live: boolean;
  format: 'hls' | 'dash' | 'progressive' | 'youtube';
  startAt?: number;
  /** Which app item this is, so the remote screen can be reopened. */
  key?: string;
}

export interface CastStore {
  available: boolean;
  device?: string;
  media?: CastMedia;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  error?: string;
}

export const useCastStore = create<CastStore>(() => ({ available: false, paused: false, currentTime: 0, duration: 0, volume: 1, muted: false }));
export const useCast = () => useCastStore();

let loading: Promise<boolean> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let player: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let controller: any = null;

function loadSdk(): Promise<boolean> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    if (!/Chrome|CriOS|Edg/.test(ua) || /Firefox|FxiOS/.test(ua)) return resolve(false);
    w.__onGCastApiAvailable = (ok) => {
      if (ok) wire();
      resolve(ok);
    };
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    s.async = true;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return loading;
}

function wire() {
  const F = w.cast.framework;
  const ctx = F.CastContext.getInstance();
  ctx.setOptions({
    receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  const sync = () => {
    const session = ctx.getCurrentSession();
    useCastStore.setState({
      available: ctx.getCastState() !== F.CastState.NO_DEVICES_AVAILABLE,
      device: session ? session.getCastDevice().friendlyName : undefined,
      ...(session ? {} : { media: undefined, paused: false, currentTime: 0, duration: 0 }),
    });
  };
  ctx.addEventListener(F.CastContextEventType.CAST_STATE_CHANGED, sync);
  ctx.addEventListener(F.CastContextEventType.SESSION_STATE_CHANGED, sync);
  sync();

  player = new F.RemotePlayer();
  controller = new F.RemotePlayerController(player);
  const E = F.RemotePlayerEventType;
  const read = () =>
    useCastStore.setState({
      paused: !!player.isPaused,
      currentTime: player.currentTime || 0,
      duration: player.duration || 0,
      volume: typeof player.volumeLevel === 'number' ? player.volumeLevel : 1,
      muted: !!player.isMuted,
    });
  for (const e of [E.IS_PAUSED_CHANGED, E.CURRENT_TIME_CHANGED, E.DURATION_CHANGED, E.VOLUME_LEVEL_CHANGED, E.IS_MUTED_CHANGED]) {
    controller.addEventListener(e, read);
  }
}

/** Starts the SDK early (call once at app start) so the Cast button can appear. */
export function initCast() {
  loadSdk();
}

/** Opens Chrome's device picker. */
export async function connectCast(): Promise<boolean> {
  if (!(await loadSdk())) return false;
  try {
    await w.cast.framework.CastContext.getInstance().requestSession();
    return true;
  } catch {
    return false; // user closed the picker
  }
}

/** Plays the media on the connected TV (connects first if needed). */
export async function castMedia(m: CastMedia): Promise<void> {
  if (!(await loadSdk())) throw new Error('Chromecast needs Chrome');
  const ctx = w.cast.framework.CastContext.getInstance();
  if (!ctx.getCurrentSession()) await ctx.requestSession();
  const session = ctx.getCurrentSession();
  if (!session) return;
  const M = w.chrome.cast.media;
  const type = m.format === 'hls' ? 'application/x-mpegURL' : m.format === 'dash' ? 'application/dash+xml' : 'video/mp4';
  const info = new M.MediaInfo(m.url, type);
  info.streamType = m.live ? M.StreamType.LIVE : M.StreamType.BUFFERED;
  if (m.format === 'hls' && M.HlsVideoSegmentFormat) info.hlsVideoSegmentFormat = M.HlsVideoSegmentFormat.MPEG2_TS;
  const meta = new M.GenericMediaMetadata();
  meta.title = m.title;
  if (m.subtitle) meta.subtitle = m.subtitle;
  if (m.image) meta.images = [new w.chrome.cast.Image(m.image)];
  info.metadata = meta;
  const req = new M.LoadRequest(info);
  req.autoplay = true;
  if (m.startAt) req.currentTime = m.startAt;
  useCastStore.setState({ media: m, error: undefined, paused: false });
  try {
    await session.loadMedia(req);
  } catch {
    useCastStore.setState({ error: 'This one could not start on the TV. Try another source or channel.' });
    throw new Error('load failed');
  }
}

export function stopCasting() {
  w.cast?.framework.CastContext.getInstance().endCurrentSession(true);
  useCastStore.setState({ device: undefined, media: undefined });
}

export const remote = {
  playPause: () => controller?.playOrPause(),
  seek: (t: number) => {
    if (!player || !controller) return;
    player.currentTime = Math.max(0, t);
    controller.seek();
  },
  volume: (v: number) => {
    if (!player || !controller) return;
    player.volumeLevel = Math.max(0, Math.min(1, v));
    controller.setVolumeLevel();
  },
  mute: () => controller?.muteOrUnmute(),
};

/** Safari (Mac, iPhone): AirPlay to Apple TV or an AirPlay 2 TV like Samsung. */
export const airPlaySupported = () => typeof (w as unknown as Record<string, unknown>).WebKitPlaybackTargetAvailabilityEvent !== 'undefined';
