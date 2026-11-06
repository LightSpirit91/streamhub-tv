import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type ContentType } from 'expo-video';
import type { StreamVideoProps } from './StreamVideo.types';

/**
 * Native player: ExoPlayer on Android / Fire TV, AVPlayer on iPhone, iPad
 * and Mac. One player instance; streams swap in with replaceAsync.
 */
export default function StreamVideo(p: StreamVideoProps) {
  const view = useRef<VideoView>(null);
  const player = useVideoPlayer(null, (pl) => {
    pl.staysActiveInBackground = true;
    pl.showNowPlayingNotification = true;
  });

  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    const contentType: ContentType =
      p.stream.format === 'hls' ? 'hls' : p.stream.format === 'dash' ? 'dash' : 'progressive';
    let cancelled = false;
    player
      .replaceAsync({ uri: p.stream.url, headers: p.stream.headers, contentType })
      .then(() => {
        if (!cancelled) player.play();
      })
      .catch((e: Error) => !cancelled && cb.current.onError(e.message));
    return () => {
      cancelled = true;
    };
  }, [player, p.stream.url, p.attempt]);

  useEffect(() => {
    player.muted = p.muted;
  }, [player, p.muted]);
  useEffect(() => {
    player.volume = p.volume;
  }, [player, p.volume]);
  useEffect(() => {
    if (p.paused) player.pause();
    else player.play();
  }, [player, p.paused]);
  useEffect(() => {
    if (p.pipRequest) view.current?.startPictureInPicture().catch(() => {});
  }, [p.pipRequest]);

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'error') cb.current.onError(error?.message ?? 'Playback error');
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (isPlaying) cb.current.onPlaying();
  });

  return (
    <VideoView
      ref={view}
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit={p.fit}
      nativeControls={false}
      allowsPictureInPicture
      startsPictureInPictureAutomatically
    />
  );
}
