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

function once(url: string, headers: Record<string, string>, o: Required<Omit<SafeGetOptions, 'budget'>>): Promise<SafeResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const lookup: net.LookupFunction = (hostname, options, cb) => {
      dns.lookup(hostname, { ...options, all: false }, (err, address, family) => {
        if (err) return cb(err, '', 0);
        if (!o.allowPrivate && isPrivate(String(address))) return cb(new UnsafeAddressError(`${hostname} resolves to a private address`), '', 0);
        cb(null, address as string, family as number);
      });
    };
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
        const finish = () => resolve({ status, type: String(res.headers['content-type'] ?? ''), bytes: new Uint8Array(Buffer.concat(chunks)), finalUrl: url, headers: res.headers });
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
