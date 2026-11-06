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
    pl.timeUpdateEventInterval = 1;
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
        if (cancelled) return;
        if (cb.current.startAt) player.currentTime = cb.current.startAt;
        player.play();
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

  useEffect(() => {
    if (p.seek) player.currentTime = Math.max(0, p.seek.to);
  }, [player, p.seek?.n]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    cb.current.onTime?.(currentTime, player.duration || 0);
  });
  useEventListener(player, 'playToEnd', () => cb.current.onEnded?.());

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
