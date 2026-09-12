import dns from 'node:dns/promises';
import net from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(`SSRF Protection: ${message}`);
    this.name = 'SsrfError';
  }
}

/**
 * Validates whether an IP address is considered private, loopback, link-local, or cloud metadata.
 */
export function isPrivateOrRestrictedIp(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; // invalid = restricted
    }

    const [a, b, c, _d] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 10.0.0.0/8 (Private)
    if (a === 10) return true;

    // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 (Link-local & AWS/GCP metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation)
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast)
    if (a >= 224) return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();

    // ::1 (Loopback)
    if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') return true;

    // :: (Unspecified)
    if (lower === '::' || lower === '0000:0000:0000:0000:0000:0000:0000:0000') return true;

    // fc00::/7 (Unique Local Address - ULA)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

    // fe80::/10 (Link-local)
    if (
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    )
      return true;

    return false;
  }

  return true;
}

/**
 * Validates a target URL against SSRF vulnerabilities by resolving DNS and verifying the IP.
 */
export async function validateSafeUrl(rawUrl: string): Promise<URL> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Malformed URL: '${rawUrl}'`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new SsrfError(
      `Forbidden protocol: '${parsedUrl.protocol}'. Only http: and https: are permitted.`,
    );
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Explicit hostnames that are strictly banned
  const bannedHosts = ['localhost', 'metadata.google.internal', 'instance-data', '169.254.169.254'];
  if (
    bannedHosts.includes(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new SsrfError(`Forbidden host: '${hostname}'`);
  }

  // Resolve DNS to verify destination IP addresses
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new SsrfError(`Failed to resolve DNS for hostname '${hostname}'`);
    }

    for (const record of addresses) {
      if (isPrivateOrRestrictedIp(record.address)) {
        throw new SsrfError(
          `Resolved IP '${record.address}' for host '${hostname}' is private/loopback/restricted. Request blocked.`,
        );
      }
    }
  } catch (error) {
    if (error instanceof SsrfError) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new SsrfError(`DNS resolution failure for '${hostname}': ${msg}`);
  }

  return parsedUrl;
}
