/**
 * Is a video file still there? A cheap request for its first byte (no
 * download). 'gone' only for clear answers (404 / 410 / 403 / 451), so a slow
 * or busy server never removes a title.
 */
export type FileCheck = 'ok' | 'gone' | 'unknown';

export async function checkFile(url: string, timeoutMs = 15_000): Promise<FileCheck> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0', 'User-Agent': 'StreamHub-Check/1.0' }, redirect: 'follow', signal: ctrl.signal });
    res.body?.cancel().catch(() => {});
    if (res.ok || res.status === 206) return 'ok';
    if ([403, 404, 410, 451].includes(res.status)) return 'gone';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(t);
  }
}

/** Runs checks with limited concurrency; returns a verdict per url. */
export async function checkFiles(urls: string[], concurrency = 24): Promise<Map<string, FileCheck>> {
  const out = new Map<string, FileCheck>();
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < urls.length) {
        const u = urls[i++];
        out.set(u, await checkFile(u));
      }
    }),
  );
  return out;
}
