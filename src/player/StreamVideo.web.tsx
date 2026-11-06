import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import type { StreamVideoProps } from './StreamVideo.types';

/**
 * Browser player. Safari (Mac, iPhone) plays HLS natively. Chrome, Edge and
 * Firefox play it through hls.js.
 */
export default function StreamVideo(p: StreamVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let hls: Hls | null = null;
    let dead = false;
    const fail = (why: string) => !dead && cb.current.onError(why);
    const onPlaying = () => !dead && cb.current.onPlaying();
    const onError = () => fail(v.error?.message || 'Media error');
    const onTime = () => !dead && cb.current.onTime?.(v.currentTime, Number.isFinite(v.duration) ? v.duration : 0);
    const onEnded = () => !dead && cb.current.onEnded?.();
    const onMeta = () => {
      if (cb.current.startAt) v.currentTime = cb.current.startAt;
    };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onError);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    v.addEventListener('loadedmetadata', onMeta, { once: true });

    const native = v.canPlayType('application/vnd.apple.mpegurl') !== '';
    if (p.stream.format !== 'hls' || native) {
      v.src = p.stream.url;
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) fail(d.details);
      });
      hls.loadSource(p.stream.url);
      hls.attachMedia(v);
    } else {
      fail('This browser cannot play live streams');
    }

    v.muted = cb.current.muted;
    v.play().catch(() => {
      // Autoplay with sound blocked: start muted, the UI offers "Tap to unmute".
      v.muted = true;
      cb.current.onAutoMuted?.();
      v.play().catch(() => {});
    });

    return () => {
      dead = true;
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('error', onError);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      hls?.destroy();
      v.removeAttribute('src');
      v.load();
    };
  }, [p.stream.url, p.attempt, p.stream.format]);

  useEffect(() => {
    if (ref.current && p.seek) ref.current.currentTime = Math.max(0, p.seek.to);
  }, [p.seek?.n]);

  useEffect(() => {
    if (ref.current) ref.current.muted = p.muted;
  }, [p.muted]);
  useEffect(() => {
    if (ref.current) ref.current.volume = p.volume;
  }, [p.volume]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (p.paused) v.pause();
    else v.play().catch(() => {});
  }, [p.paused]);
  useEffect(() => {
    const v = ref.current as (HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }) | null;
    if (p.airplayRequest) v?.webkitShowPlaybackTargetPicker?.();
  }, [p.airplayRequest]);

  useEffect(() => {
    const v = ref.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (p.pipRequest && v?.requestPictureInPicture) v.requestPictureInPicture().catch(() => {});
  }, [p.pipRequest]);

  return (
    <video
      ref={ref}
      playsInline
      autoPlay
      {...({ 'x-webkit-airplay': 'allow' } as Record<string, string>)}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: p.fit, backgroundColor: '#000',
      }}
    />
  );
}
