import { useEffect, useState } from 'react';

/**
 * Google Cast (Chromecast / Google TV) from Chrome on Mac, PC and Android.
 * Uses Google's Cast Web Sender SDK and the Default Media Receiver, which
 * plays HLS and MP4 on the TV by itself.
 */
type W = Window & {
  __onGCastApiAvailable?: (ok: boolean) => void;
  cast?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  chrome?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const w = globalThis as unknown as W;
let loading: Promise<boolean> | null = null;

function loadSdk(): Promise<boolean> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    if (!/Chrome|CriOS|Edg/.test(navigator.userAgent) || /Firefox/.test(navigator.userAgent)) return resolve(false);
    w.__onGCastApiAvailable = (ok) => {
      if (ok) {
        w.cast.framework.CastContext.getInstance().setOptions({
          receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
      }
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

export interface CastState {
  /** A Chromecast is on the network. */
  available: boolean;
  /** Name of the TV we're casting to, when connected. */
  device?: string;
}

export function useCast(): CastState {
  const [state, setState] = useState<CastState>({ available: false });
  useEffect(() => {
    let off = () => {};
    loadSdk().then((ok) => {
      if (!ok) return;
      const ctx = w.cast.framework.CastContext.getInstance();
      const update = () => {
        const cs = ctx.getCastState();
        const session = ctx.getCurrentSession();
        setState({
          available: cs !== w.cast.framework.CastState.NO_DEVICES_AVAILABLE,
          device: session ? session.getCastDevice().friendlyName : undefined,
        });
      };
      const E = w.cast.framework.CastContextEventType;
      ctx.addEventListener(E.CAST_STATE_CHANGED, update);
      ctx.addEventListener(E.SESSION_STATE_CHANGED, update);
      update();
      off = () => {
        ctx.removeEventListener(E.CAST_STATE_CHANGED, update);
        ctx.removeEventListener(E.SESSION_STATE_CHANGED, update);
      };
    });
    return () => off();
  }, []);
  return state;
}

export interface CastMedia {
  url: string;
  title: string;
  subtitle?: string;
  image?: string;
  live: boolean;
  format: 'hls' | 'dash' | 'progressive' | 'youtube';
  startAt?: number;
}

/** Opens the device picker if needed, then plays the media on the TV. */
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
  if (m.startAt) req.currentTime = m.startAt;
  await session.loadMedia(req);
}

export function stopCasting() {
  w.cast?.framework.CastContext.getInstance().endCurrentSession(true);
}

/** Safari (Mac, iPhone): AirPlay to Apple TV or an AirPlay 2 TV like Samsung. */
export const airPlaySupported = () => typeof (w as unknown as Record<string, unknown>).WebKitPlaybackTargetAvailabilityEvent !== 'undefined';
