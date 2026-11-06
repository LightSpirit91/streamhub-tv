import { useEffect, useRef } from 'react';
import type { StreamVideoProps } from './StreamVideo.types';

/** Official YouTube live/video embed (browser). */
export default function YouTubeVideo(p: StreamVideoProps) {
  const cb = useRef(p);
  cb.current = p;
  const src = `${p.stream.url}?autoplay=1&playsinline=1&rel=0&modestbranding=1&mute=${p.muted ? 1 : 0}`;
  useEffect(() => {
    // The iframe hides its errors; treat a load as playing.
    const t = setTimeout(() => cb.current.onPlaying(), 1500);
    return () => clearTimeout(t);
  }, [p.stream.url, p.attempt]);
  return (
    <iframe
      key={`${p.stream.url}-${p.attempt}-${p.muted}`}
      src={src}
      title="YouTube"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, backgroundColor: '#000' }}
    />
  );
}
