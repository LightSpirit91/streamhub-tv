/**
 * Daily discovery: rules for what a repository found by GitHub search may
 * contribute. Everything read from a repository is untrusted DATA: names,
 * descriptions, README text and playlist lines are never followed as
 * instructions and never executed. A found link only joins StreamHub when:
 *
 * 1. its repository doesn't look like a PPV / pay-TV restream project;
 * 2. the link is a safe public address (no private networks, no service ports);
 * 3. it's served from a broadcaster or free-TV host StreamHub already plays
 *    from its vetted sources (iptv-org, Free-TV, Famelack), or a host you
 *    listed in config/refresh.json "trustedHosts";
 * 4. it needs no faked Referer / User-Agent, carries no account login, and
 *    isn't a short-lived signed link;
 * 5. it passes the real playback check (actual video bytes), every night.
 */
import type { PlaylistEntry } from '../types';
import { isSafeUrl } from '../playback/safeUrl';
import { isBannedStream } from '../catalog/normalize';

export type Rejection =
  | 'repo-ppv' | 'repo-excluded' | 'repo-known-source' | 'unsafe' | 'banned' | 'host-not-trusted' | 'host-excluded'
  | 'other-country' | 'needs-faked-headers' | 'account-link' | 'expiring-link' | 'ppv-name' | 'duplicate' | 'not-a-stream' | `check-${string}`;

/** PPV / pay-TV restream projects and pirate sports sites (names, descriptions, topics, hosts). */
const PPV = /ppv|pay[ -]?per[ -]?view|streamed\.su|streamed[._-]?(su|pk)|crack ?streams?|meth ?streams?|buff ?streams?|sportsurge|totalsportek|daddy ?live|dlhd|thetvapp|tvpass|stream ?east|methstream|xtream|stalker|mac[ _-]?portal|m3u ?premium|premium ?iptv|vip ?iptv|cracked|warez|pirat/i;
const PPV_HOSTS = /(^|\.)(ppv\.(to|st|land|wtf)|streamed\.(su|pk)|crackstreams?\.[a-z]+|methstreams?\.[a-z]+|daddylive[a-z]*\.[a-z]+|thetvapp\.[a-z]+|tvpass\.[a-z]+|streameast[a-z]*\.[a-z]+|sportsurge\.[a-z]+|totalsportek[a-z0-9]*\.[a-z]+|dlhd\.[a-z]+)$/i;
/** Repositories StreamHub already reads directly. */
const KNOWN = /^(iptv-org\/|free-tv\/iptv$|famelack\/)/i;
/** Shared hosting where anyone can publish: only an exact host match counts as trusted. */
const SHARED = /(^|\.)(cloudfront\.net|akamaized\.net|akamaihd\.net|amazonaws\.com|b-cdn\.net|bunnycdn\.com|github\.io|githubusercontent\.com|workers\.dev|pages\.dev|herokuapp\.com|ngrok(-free)?\.(io|app)|duckdns\.org|no-ip\.[a-z]+|ddns\.net|vercel\.app|netlify\.app|glitch\.me|repl\.co|onrender\.com|fly\.dev|azureedge\.net|googleusercontent\.com|cdn77\.org|fastly\.net|edgesuite\.net|llnwd\.net|wowza\.com|livepush\.io|streamlock\.net)$/i;
const SECOND_LEVEL = /^(co|com|net|org|gov|edu|ac|or|ne|go)\.[a-z]{2}$/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** "a.b.example.co.uk" -> "example.co.uk"; shared hosting keeps the full host. */
export function trustKey(host: string): string {
  if (SHARED.test(host)) return host;
  const parts = host.split('.');
  if (parts.length <= 2 || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const last2 = parts.slice(-2).join('.');
  return SECOND_LEVEL.test(last2) ? parts.slice(-3).join('.') : last2;
}

export interface RepoInfo {
  full_name: string;
  description?: string | null;
  topics?: string[];
  fork?: boolean;
  archived?: boolean;
}

export function screenRepo(r: RepoInfo, excluded: string[]): Rejection | undefined {
  const name = r.full_name.toLowerCase();
  if (KNOWN.test(name)) return 'repo-known-source';
  if (excluded.includes(name)) return 'repo-excluded';
  if (PPV.test(`${r.full_name} ${r.description ?? ''} ${(r.topics ?? []).join(' ')}`)) return 'repo-ppv';
  return undefined;
}

export interface ScreenContext {
  trusted: Set<string>;
  /** Countries you watch (PROFILE_COUNTRIES). Links marked for another country are left out. */
  countries?: Set<string>;
  excludedHosts: string[];
  knownUrls: Set<string>;
}

const ACCOUNT = /[?&](username|user|password|pass|pwd|mac)=|\/(live|movie|series)\/[^/]+\/[^/]+\/\d+(\.\w+)?$|get\.php\?|player_api\.php|portal\.php|\/c\/\?/i;
const EXPIRING = /[?&](token|auth|hdnts|hdnea|wmsAuthSign|expires?|e|exp|sig|signature|st|md5|Policy|Key-Pair-Id|validfrom|validto)=/i;

export function screenEntry(e: PlaylistEntry, ctx: ScreenContext): Rejection | undefined {
  const url = e.url.trim();
  if (!/^https?:\/\//i.test(url)) return 'not-a-stream';
  if (!isSafeUrl(url)) return 'unsafe';
  if (isBannedStream({ url, source: 'discovered' })) return 'banned';
  const host = hostOf(url);
  if (PPV_HOSTS.test(host) || PPV.test(e.name)) return PPV_HOSTS.test(host) ? 'repo-ppv' : 'ppv-name';
  if (ctx.excludedHosts.some((h) => host === h || host.endsWith(`.${h}`))) return 'host-excluded';
  if (ctx.countries) {
    const cc = entryCountries(e);
    if (cc.length && !cc.some((c) => ctx.countries!.has(c))) return 'other-country';
  }
  if (e.userAgent || e.referrer || e.attrs['http-referrer'] || e.attrs['http-user-agent']) return 'needs-faked-headers';
  if (ACCOUNT.test(url)) return 'account-link';
  if (EXPIRING.test(url)) return 'expiring-link';
  if (!ctx.trusted.has(trustKey(host)) && !ctx.trusted.has(host)) return 'host-not-trusted';
  if (ctx.knownUrls.has(url)) return 'duplicate';
  return undefined;
}

/** Countries a playlist entry says it is for: tvg-country, or the tvg-id suffix ("CNN.us"). */
export function entryCountries(e: PlaylistEntry): string[] {
  const out = (e.country ?? '').split(/[;,\s]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2,3}$/.test(c));
  const suffix = /\.([a-z]{2})(@[\w-]+)?$/i.exec(e.tvgId ?? '')?.[1];
  if (!out.length && suffix) out.push(suffix.toUpperCase());
  return out.map((c) => (c === 'GB' ? 'UK' : c));
}

/** Trusted hosts: where the vetted catalog already plays from, plus your own list. */
export function trustedHosts(catalogUrls: string[], extra: string[]): Set<string> {
  const out = new Set<string>();
  for (const u of catalogUrls) {
    const h = hostOf(u);
    if (h && !PPV_HOSTS.test(h)) out.add(trustKey(h));
  }
  for (const h of extra) out.add(trustKey(h));
  return out;
}

const clean = (s: string | undefined, max: number) => (s ?? '').replace(/[\u0000-\u001f\u007f"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** One sanitised #EXTINF line + URL for discovered.m3u. */
export function toM3uLine(e: PlaylistEntry, repo: string): string {
  const attrs: string[] = [];
  const id = (e.tvgId ?? '').replace(/[^\w.@-]/g, '').slice(0, 80);
  if (id) attrs.push(`tvg-id="${id}"`);
  if (e.logo && isSafeUrl(e.logo) && e.logo.startsWith('https://')) attrs.push(`tvg-logo="${clean(e.logo, 300)}"`);
  const cc = (e.country ?? '').replace(/[^A-Za-z;]/g, '').slice(0, 20);
  if (cc) attrs.push(`tvg-country="${cc}"`);
  const g = clean(e.groups[0], 40);
  if (g) attrs.push(`group-title="${g}"`);
  attrs.push(`x-found-in="${clean(repo, 100)}"`);
  return `#EXTINF:-1 ${attrs.join(' ')},${clean(e.name, 80) || 'Channel'}\n${e.url.trim()}`;
}
