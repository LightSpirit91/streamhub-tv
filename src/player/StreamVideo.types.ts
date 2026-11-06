import type { Stream } from '../core/types';

export type Fit = 'contain' | 'cover' | 'fill';

export interface StreamVideoProps {
  stream: Stream;
  /** Bumped by the failover machine to force a fresh load of the same URL. */
  attempt: number;
  muted: boolean;
  /** 0..1 */
  volume: number;
  paused: boolean;
  fit: Fit;
  /** Bump to request Picture-in-Picture. */
  pipRequest: number;
  /** VOD: jump here (seconds). `n` changes on every request. */
  seek?: { to: number; n: number };
  /** VOD: start position in seconds. */
  startAt?: number;
  /** Fires about once per second with position and duration (seconds). */
  onTime?(current: number, duration: number): void;
  onEnded?(): void;
  onPlaying(): void;
  onError(reason: string): void;
  /** Autoplay with sound was blocked (browsers); playing muted instead. */
  onAutoMuted?(): void;
}
