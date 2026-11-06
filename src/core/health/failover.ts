import type { Channel, Stream, StreamHealth } from '../types';

/**
 * Drives "Channel Offline - Retrying..." and auto-failover. Pure state
 * machine so the player UI stays dumb and the logic is unit tested.
 *
 * On error: retry the same stream with backoff (1s, 3s), then move to the
 * next stream in the ranked list. After every stream fails, wait 15s and
 * start the round again, forever, until the user leaves.
 */
export type FailoverState =
  | { kind: 'playing'; streamIndex: number }
  | { kind: 'retrying'; streamIndex: number; attempt: number; delayMs: number }
  | { kind: 'switching'; from: number; to: number }
  | { kind: 'offline'; nextRoundInMs: number };

export const RETRY_DELAYS = [1_000, 3_000];
export const ROUND_DELAY_MS = 15_000;

export class FailoverController {
  private index = 0;
  private attempt = 0;

  constructor(private readonly streams: Stream[]) {}

  get current(): Stream | undefined {
    return this.streams[this.index];
  }

  get currentIndex() {
    return this.index;
  }

  onPlaying(): FailoverState {
    this.attempt = 0;
    return { kind: 'playing', streamIndex: this.index };
  }

  onError(): FailoverState {
    if (this.attempt < RETRY_DELAYS.length) {
      const delayMs = RETRY_DELAYS[this.attempt++];
      return { kind: 'retrying', streamIndex: this.index, attempt: this.attempt, delayMs };
    }
    this.attempt = 0;
    if (this.index + 1 < this.streams.length) {
      const from = this.index++;
      return { kind: 'switching', from, to: this.index };
    }
    this.index = 0;
    return { kind: 'offline', nextRoundInMs: ROUND_DELAY_MS };
  }
}

export function recordResult(
  health: Record<string, StreamHealth>,
  url: string,
  ok: boolean,
  now = Date.now(),
): Record<string, StreamHealth> {
  const prev = health[url] ?? { consecutiveFails: 0 };
  const next: StreamHealth = ok
    ? { consecutiveFails: 0, lastOkAt: now, lastFailAt: prev.lastFailAt }
    : { ...prev, consecutiveFails: prev.consecutiveFails + 1, lastFailAt: now };
  return { ...health, [url]: next };
}

/** Channel zapping: next/previous channel inside the same row, wrapping around. */
export function zap(list: Channel[], currentId: string, dir: 1 | -1): Channel | undefined {
  if (!list.length) return undefined;
  const i = list.findIndex((c) => c.id === currentId);
  const j = i === -1 ? 0 : (i + dir + list.length) % list.length;
  return list[j];
}

export function pushRecent(recent: string[], id: string, max = 10): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}
