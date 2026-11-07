/**
 * Safe HTTP for the nightly checkers.
 * - http/https only; every redirect hop is re-checked (max 5).
 * - The address is checked AFTER DNS resolution, inside the socket's lookup,
 *   so a name that resolves to a private / loopback / link-local / metadata
 *   address is refused (no DNS-rebinding window).
 * - Byte cap per response, timeout per request, and a shared request budget
 *   and deadline per run (settings: limits.maxRequestsPerRun / maxRunMinutes).
 * - Responses are data only: nothing fetched is ever executed.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import { isPrivateIPv4, isPrivateIPv6, isSafeUrl } from '../../src/core/playback/safeUrl';
import type { GetBytes } from '../../src/core/playback/validate';

export class Budget {
  used = 0;
  constructor(readonly maxRequests: number, readonly deadline: number) {}
  take(): boolean {
    if (this.used >= this.maxRequests || Date.now() > this.deadline) return false;
    this.used++;
    return true;
  }
  get exhausted() {
    return this.used >= this.maxRequests || Date.now() > this.deadline;
  }
}

export class BudgetError extends Error {
  name = 'BudgetError';
}
export class UnsafeAddressError extends Error {
  name = 'UnsafeAddressError';
}

const isPrivate = (ip: string) => (net.isIPv6(ip) ? isPrivateIPv6(ip) : isPrivateIPv4(ip));

export interface SafeGetOptions {
  budget?: Budget;
  timeoutMs?: number;
  maxBytes?: number;
  /** Tests only: allow loopback so a local fixture server can be used. */
  allowPrivate?: boolean;
  userAgent?: string;
}

export interface SafeResponse {
  status: number;
  type: string;
  bytes: Uint8Array;
  finalUrl: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Many servers compress playlists (gzip / deflate / br) even when not asked;
 * players unpack them, so the checker must too. A cut-off body is unpacked as
 * far as it goes.
 */
function decode(buf: Buffer, encoding: string | string[] | undefined, max: number): Uint8Array {
  const enc = String(encoding ?? '').toLowerCase();
  const opts = { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: max * 8 };
  try {
    if (enc.includes('gzip') || (buf[0] === 0x1f && buf[1] === 0x8b)) return new Uint8Array(zlib.gunzipSync(buf, opts));
    if (enc.includes('deflate')) return new Uint8Array(zlib.inflateSync(buf, opts));
    if (enc.includes('br')) return new Uint8Array(zlib.brotliDecompressSync(buf, { maxOutputLength: max * 8 }));
  } catch {
    // not really compressed: use as is
  }
  return new Uint8Array(buf);
}

function once(url: string, headers: Record<string, string>, o: Required<Omit<SafeGetOptions, 'budget'>>): Promise<SafeResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    // Node may ask for one address or for all of them (happy eyeballs); either
    // way every address is checked, and any private one refuses the host.
    const lookup = ((hostname: string, options: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
      dns.lookup(hostname, { ...options, all: true }, (err, list) => {
        if (err) return cb(err);
        const addrs = list as dns.LookupAddress[];
        if (!addrs.length) return cb(Object.assign(new Error(`no address for ${hostname}`), { code: 'ENOTFOUND' }));
        if (!o.allowPrivate && addrs.some((a) => isPrivate(a.address))) return cb(new UnsafeAddressError(`${hostname} resolves to a private address`));
        if (options.all) cb(null, addrs);
        else cb(null, addrs[0].address, addrs[0].family);
      });
    }) as unknown as net.LookupFunction;
    if (!o.allowPrivate && net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivate(u.hostname.replace(/^\[|\]$/g, ''))) {
      return reject(new UnsafeAddressError('private address'));
    }
    const req = lib.request(
      u,
      { method: 'GET', headers: { 'User-Agent': o.userAgent, Accept: '*/*', ...headers }, lookup, timeout: o.timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, type: '', bytes: new Uint8Array(), finalUrl: url, headers: res.headers, location: new URL(res.headers.location, url).toString() });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({ status, type: String(res.headers['content-type'] ?? ''), bytes: decode(Buffer.concat(chunks), res.headers['content-encoding'], o.maxBytes), finalUrl: url, headers: res.headers });
        };
        res.on('data', (c: Buffer) => {
          chunks.push(c);
          size += c.length;
          if (size >= o.maxBytes) {
            res.destroy();
            finish();
          }
        });
        res.on('end', finish);
        res.on('error', (e) => (size ? finish() : reject(e)));
      },
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { name: 'AbortError' })), o.timeoutMs);
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

export async function safeGet(url: string, headers: Record<string, string> = {}, opts: SafeGetOptions = {}): Promise<SafeResponse> {
  const o = { timeoutMs: opts.timeoutMs ?? 10_000, maxBytes: opts.maxBytes ?? 512_000, allowPrivate: !!opts.allowPrivate, userAgent: opts.userAgent ?? 'StreamHub-Check/2.0' };
  let u = url;
  for (let hop = 0; hop < 6; hop++) {
    if (!o.allowPrivate && !isSafeUrl(u)) throw new UnsafeAddressError('address not allowed');
    if (opts.budget && !opts.budget.take()) throw new BudgetError('request budget used up');
    const r = await once(u, headers, o);
    if (!r.location) return { ...r, finalUrl: u };
    u = r.location;
  }
  throw new Error('too many redirects');
}

/** The validator's network: playlists up to 512 KB, media segments only their first 4 KB. */
export function makeGetBytes(opts: SafeGetOptions = {}): GetBytes {
  return async (url, headers) => {
    try {
      const segment = /\.(ts|m4s|mp4|m4v|aac|mp3|webm|cmfv|cmfa)(\?|$)/i.test(url);
      const r = await safeGet(url, headers, { ...opts, maxBytes: segment ? 4096 : 512_000 });
      return { status: r.status, type: r.type, bytes: r.bytes, finalUrl: r.finalUrl, cors: !!r.headers['access-control-allow-origin'] };
    } catch (e) {
      if (e instanceof UnsafeAddressError) return { status: 0, type: 'unsafe', bytes: new Uint8Array(), finalUrl: 'http://0.0.0.0/' };
      throw e;
    }
  };
}
