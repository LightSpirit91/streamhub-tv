import { create } from 'zustand';

/**
 * One shared clock for the whole app (seconds), ticking every 30s, so
 * thousands of guide cells never run thousands of timers.
 */
const useClock = create<{ now: number }>(() => ({ now: Math.floor(Date.now() / 1000) }));
setInterval(() => useClock.setState({ now: Math.floor(Date.now() / 1000) }), 30_000);

export function useNow(): number {
  return useClock((s) => s.now);
}

export function clock(sec: number): string {
  const d = new Date(sec * 1000);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
