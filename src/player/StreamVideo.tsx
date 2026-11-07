import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type ContentType, type SubtitleTrack } from 'expo-video';
import { normLang } from '../core/subtitles';
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
    pl.timeUpdateEventInterval = 0.5; // also drives subtitle files
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
  // Subtitles / captions carried in the stream.
  const subTracks = useRef<SubtitleTrack[]>([]);
  useEventListener(player, 'availableSubtitleTracksChange', ({ availableSubtitleTracks }) => {
    subTracks.current = availableSubtitleTracks;
    cb.current.onTextTracks?.(
      availableSubtitleTracks.map((t, i) => ({ id: String(i), lang: normLang(t.language) ?? normLang(t.label), label: t.label || t.language || `Track ${i + 1}` })),
    );
  });
  useEffect(() => {
    const t = p.textTrack != null ? subTracks.current[Number(p.textTrack)] : undefined;
    try {
      player.subtitleTrack = t ?? null;
    } catch {
      // track list changed underneath; the next update re-applies
    }
  }, [player, p.textTrack]);

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
