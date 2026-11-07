/**
 * URLs the checkers may request: http(s) only, no credentials, no private,
 * loopback, link-local or internal addresses, no service ports (SSH, mail, databases...). Host names
 * are checked again after DNS resolution on the server (scripts/lib/net.ts).
 */
const PRIVATE_V4 = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xe0000000, 4], [0xf0000000, 4],
] as const;

export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const n = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
}

export function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::' || s === '::1') return true;
  if (/^::ffff:/.test(s)) return isPrivateIPv4(s.replace(/^::ffff:/, ''));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
}

const BLOCKED_HOSTS = /^(localhost|.*\.local|.*\.localhost|.*\.internal|.*\.lan|.*\.home|.*\.corp|metadata\.google\.internal|instance-data)$/i;
// Service ports that never carry video (remote shells, mail, databases, caches, admin APIs).
const BLOCKED_PORTS = new Set(['0', '21', '22', '23', '25', '53', '110', '111', '135', '139', '143', '389', '445', '465', '587', '636', '993', '995', '1433', '1521', '2049', '2375', '2376', '2379', '2380', '3306', '3389', '5432', '5900', '5984', '6379', '6443', '9200', '9300', '10250', '11211', '27017']);

export function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_HOSTS.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIPv4(host)) return false;
  if (host.includes(':') && isPrivateIPv6(host)) return false;
  if (/^\d+$/.test(host) || /^0x/i.test(host)) return false; // numeric / hex host tricks
  return !BLOCKED_PORTS.has(u.port);
}
