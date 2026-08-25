import { isIP } from 'node:net';
import { promises as dns } from 'node:dns';

export class UnsafeTargetError extends Error {
  readonly code = 'UNSAFE_TARGET';

  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google.com',
  'metadata',
  'instance-data',
  '0.0.0.0',
]);

const ALWAYS_BLOCKED_IPS = new Set(['169.254.169.254', 'fd00:ec2::254', '100.100.100.200']);

export interface SafeTargetOptions {
  allowPrivate?: boolean;
  resolver?: (hostname: string) => Promise<string[]>;
}

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

export function isBlockedHostname(hostname: string): boolean {
  const host = stripBrackets(hostname);
  if (BLOCKED_HOSTNAMES.has(host)) {
    return true;
  }
  return host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local');
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet < 0 || octet > 255) {
      return null;
    }
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  if (!range || !bitsRaw) {
    return false;
  }
  const ipValue = ipv4ToInt(ip);
  const rangeValue = ipv4ToInt(range);
  const bits = Number(bitsRaw);
  if (ipValue === null || rangeValue === null || Number.isNaN(bits)) {
    return false;
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipValue & mask) === (rangeValue & mask);
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = stripBrackets(ip);
  if (ALWAYS_BLOCKED_IPS.has(normalized)) {
    return true;
  }

  if (normalized.includes(':')) {
    const compact = normalized.replace(/^::ffff:/i, '');
    if (isIP(compact) === 4) {
      return isPrivateOrReservedIp(compact);
    }
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('ff')
    );
  }

  if (isIP(normalized) !== 4) {
    return false;
  }

  return (
    inCidr(normalized, '0.0.0.0/8') ||
    inCidr(normalized, '10.0.0.0/8') ||
    inCidr(normalized, '127.0.0.0/8') ||
    inCidr(normalized, '169.254.0.0/16') ||
    inCidr(normalized, '172.16.0.0/12') ||
    inCidr(normalized, '192.168.0.0/16') ||
    inCidr(normalized, '224.0.0.0/4') ||
    inCidr(normalized, '240.0.0.0/4')
  );
}

export function parseHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeTargetError('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeTargetError('Only http and https URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeTargetError('URLs with embedded credentials are not allowed');
  }
  return parsed;
}

export function assertHostnameAllowed(hostname: string, allowPrivate = false): void {
  const host = stripBrackets(hostname);
  if (ALWAYS_BLOCKED_IPS.has(host) || host === '169.254.169.254') {
    throw new UnsafeTargetError('Metadata endpoints are not allowed');
  }
  if (isBlockedHostname(host) && !allowPrivate) {
    throw new UnsafeTargetError(`Blocked hostname: ${host}`);
  }
  if (isIP(host) && isPrivateOrReservedIp(host) && !allowPrivate) {
    throw new UnsafeTargetError(`Private or reserved IP addresses are not allowed: ${host}`);
  }
}

async function defaultResolver(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function assertSafeNavigationTarget(
  rawUrl: string,
  options: SafeTargetOptions = {},
): Promise<URL> {
  const allowPrivate = options.allowPrivate ?? false;
  const parsed = parseHttpUrl(rawUrl);
  const hostname = stripBrackets(parsed.hostname);
  assertHostnameAllowed(hostname, allowPrivate);

  if (isIP(hostname)) {
    if (!allowPrivate && isPrivateOrReservedIp(hostname)) {
      throw new UnsafeTargetError(`Private or reserved IP addresses are not allowed: ${hostname}`);
    }
    if (ALWAYS_BLOCKED_IPS.has(hostname)) {
      throw new UnsafeTargetError('Metadata endpoints are not allowed');
    }
    return parsed;
  }

  const resolver = options.resolver ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new UnsafeTargetError(`Could not resolve hostname: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new UnsafeTargetError(`Could not resolve hostname: ${hostname}`);
  }

  for (const address of addresses) {
    if (ALWAYS_BLOCKED_IPS.has(address) || address === '169.254.169.254') {
      throw new UnsafeTargetError('Resolved address points at a metadata endpoint');
    }
    if (!allowPrivate && isPrivateOrReservedIp(address)) {
      throw new UnsafeTargetError(
        `Hostname ${hostname} resolved to a private or reserved address (${address})`,
      );
    }
  }

  return parsed;
}
