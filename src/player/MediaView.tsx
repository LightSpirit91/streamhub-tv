import type { StreamVideoProps } from './StreamVideo.types';
import StreamVideo from './StreamVideo';
import YouTubeVideo from './YouTubeVideo';

/** Picks the right engine per stream. Different component types remount cleanly. */
export default function MediaView(p: StreamVideoProps) {
  return p.stream.format === 'youtube' ? <YouTubeVideo {...p} /> : <StreamVideo {...p} />;
}
