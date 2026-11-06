import type { Channel } from '../types';

/**
 * Memory of channels that went offline. A channel lands here when every
 * stream failed or its source stopped listing it. It is revived the moment
 * any source lists a working link for the same channel id again.
 */
export interface GraveEntry {
  id: string;
  name: string;
  logo?: string;
  country?: string;
  hubs: string[];
  diedAt: number;
  reason: 'dead' | 'delisted';
}

export interface Graveyard {
  version: 1;
  updatedAt: number;
  entries: Record<string, GraveEntry>;
}

export const GRAVE_TTL_MS = 180 * 86_400_000;

export function updateGraveyard(
  prev: Graveyard | undefined,
  before: Pick<Channel, 'id' | 'name' | 'logo' | 'country' | 'hubs'>[],
  listedTonight: Set<string>,
  aliveTonight: Channel[],
  now = Date.now(),
): { graveyard: Graveyard; died: string[]; revived: string[] } {
  const entries: Record<string, GraveEntry> = { ...(prev?.entries ?? {}) };
  const alive = new Set(aliveTonight.map((c) => c.id));
  const revived: string[] = [];
  const died: string[] = [];

  for (const id of Object.keys(entries)) {
    if (alive.has(id)) {
      revived.push(id);
      delete entries[id];
    } else if (now - entries[id].diedAt > GRAVE_TTL_MS) delete entries[id];
  }
  for (const c of before) {
    if (alive.has(c.id) || entries[c.id]) continue;
    entries[c.id] = {
      id: c.id, name: c.name, logo: c.logo, country: c.country, hubs: c.hubs,
      diedAt: now, reason: listedTonight.has(c.id) ? 'dead' : 'delisted',
    };
    died.push(c.id);
  }
  return { graveyard: { version: 1, updatedAt: now, entries }, died, revived };
}
