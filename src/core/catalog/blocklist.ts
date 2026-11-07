/**
 * iptv-org's official blocklist: channels removed after a copyright claim
 * (DMCA) or for adult content. StreamHub drops them too.
 * Format (iptv-org/api blocklist.json): [{ channel: "Id.cc", reason: "dmca" | "nsfw", ref: "..." }]
 */
export interface BlockEntry {
  channel: string;
  reason?: string;
}

/** Lower-cased channel ids to remove. Bad or missing data blocks nothing. */
export function blockedIds(data: unknown): Set<string> {
  if (!Array.isArray(data)) return new Set();
  return new Set(
    data
      .filter((e): e is BlockEntry => !!e && typeof e === 'object' && typeof (e as BlockEntry).channel === 'string')
      .map((e) => e.channel.toLowerCase()),
  );
}

/** Our channel id is the iptv-org id lower-cased without the feed ("kan11.il@sd" -> "kan11.il"). */
export const baseId = (id: string) => id.toLowerCase().split('@')[0];
