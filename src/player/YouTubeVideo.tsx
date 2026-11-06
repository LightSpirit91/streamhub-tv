import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { StreamVideoProps } from './StreamVideo.types';

/** Official YouTube live/video embed (Fire TV, Android, iPhone, Mac app). */
export default function YouTubeVideo(p: StreamVideoProps) {
  const cb = useRef(p);
  cb.current = p;
  const src = `${p.stream.url}?autoplay=1&playsinline=1&rel=0&modestbranding=1&controls=0&mute=${p.muted ? 1 : 0}`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></body></html>`;
  return (
    <WebView
      key={`${p.stream.url}-${p.attempt}-${p.muted}`}
      source={{ html, baseUrl: 'https://www.youtube-nocookie.com' }}
      style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo
      javaScriptEnabled
      focusable={false}
      onLoadEnd={() => cb.current.onPlaying()}
      onError={() => cb.current.onError('YouTube embed failed')}
    />
  );
}
