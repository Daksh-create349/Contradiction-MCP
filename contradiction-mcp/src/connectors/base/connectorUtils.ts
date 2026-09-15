import crypto from 'node:crypto';
import type { ClaimValueType } from '../../domain/entities/claim.js';

/**
 * Sanitizes an error message or string to ensure tokens, secrets,
 * and sensitive authentication headers are never leaked.
 */
export function sanitizeSecrets(text: string): string {
  if (!text) return '';
  return text
    .replace(/(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,255}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [REDACTED]')
    .replace(/token\s+[A-Za-z0-9_.-]+/gi, 'token [REDACTED]')
    .replace(/access_token=[A-Za-z0-9_.-]+/gi, 'access_token=[REDACTED]');
}

/**
 * Formats a clean, sanitized error message from an unknown error.
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeSecrets(error.message);
  }
  return sanitizeSecrets(String(error));
}

/**
 * Generates a stable canonical external identifier for a Source.
 * Example: 'github:octocat/hello-world'
 */
export function createSourceExternalId(type: string, identifier: string): string {
  const normType = type.trim().toLowerCase();
  const normId = identifier
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
  return `${normType}:${normId}`;
}

/**
 * Generates a deterministic external identifier for an extracted Claim.
 * Guarantees that syncing the same file and property repeatedly references
 * the exact same external claim entity.
 *
 * Example: 'github:octocat/hello-world:package.json:node_version'
 */
export function createClaimExternalId(
  sourceExternalId: string,
  filePath: string,
  predicate: string,
  distinctKey?: string,
): string {
  const normSource = sourceExternalId.trim().toLowerCase();
  const normFile = filePath
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
  const normPred = predicate.trim().toLowerCase();
  const base = `${normSource}:${normFile}:${normPred}`;

  if (distinctKey) {
    const normKey = distinctKey.trim().toLowerCase();
    return `${base}:${normKey}`;
  }

  return base;
}

/**
 * Deterministically hashes input data to detect whether content changed.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function isIpOrNetworkAddress(val: string): boolean {
  const s = (val || '').trim();
  // IPv4, IPv4:port, or IPv4 CIDR
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(?:\/\d+)?$/.test(s)) return true;
  // IPv6 or localhost
  if (/^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(s) || /^::1$/.test(s) || s === 'localhost')
    return true;
  return false;
}

/**
 * Heuristically infers the most accurate ClaimValueType from predicate and value
 * (e.g. quantity, version, price, date, status, etc.).
 */
export function inferClaimValueType(predicate: string, value: string): ClaimValueType {
  const pred = (predicate || '').toLowerCase().trim();
  const val = (value || '').toLowerCase().trim();

  // 0. Address / Network / Host
  if (
    isIpOrNetworkAddress(val) ||
    pred.includes('host') ||
    pred.includes('ip_address') ||
    pred.includes('bind_address') ||
    pred.includes('hostname') ||
    pred === 'ip' ||
    pred === 'address' ||
    pred.endsWith('_host') ||
    pred.endsWith('_ip')
  ) {
    return 'address';
  }

  // 1. Version
  if (
    !isIpOrNetworkAddress(val) &&
    (pred.includes('version') ||
      pred.includes('release') ||
      pred.includes('semver') ||
      /^v\d+(?:\.\d+)*(?:-\w+)?$/i.test(val) ||
      /^(?:>=|<=|>|<|=)\s*\d+/i.test(val) ||
      (/^\^?~?[v=]?\d+\.\d+(?:\.\d+)*(?:-\w+)?$/.test(val) &&
        (pred.includes('node') ||
          pred.includes('python') ||
          pred.includes('ruby') ||
          pred.includes('go') ||
          pred.includes('java') ||
          pred.includes('runtime') ||
          pred.includes('ver') ||
          val.startsWith('^') ||
          val.startsWith('~') ||
          val.startsWith('v') ||
          val.startsWith('='))))
  ) {
    return 'version';
  }

  // 2. Price / Currency
  if (
    pred.includes('price') ||
    pred.includes('cost') ||
    pred.includes('fee') ||
    pred.includes('budget') ||
    /[$\u20AC\u00A3\u00A5\u20B9]|(?:\b(?:INR|USD|EUR|GBP|JPY|CAD|AUD)\b)/i.test(val)
  ) {
    return 'price';
  }

  // 3. Date
  if (
    pred.includes('date') ||
    pred.includes('deadline') ||
    pred.includes('expires') ||
    pred.includes('expiry') ||
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(val) ||
    /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}/.test(val)
  ) {
    return 'date';
  }

  // 4. Quantity / Numeric / Resources / Limits
  if (
    pred.includes('port') ||
    pred.includes('ram') ||
    pred.includes('memory') ||
    pred.includes('cpu') ||
    pred.includes('timeout') ||
    pred.includes('ttl') ||
    pred.includes('count') ||
    pred.includes('limit') ||
    pred.includes('capacity') ||
    pred.includes('max_') ||
    pred.includes('min_') ||
    /^[-+]?\d+(?:\.\d+)?\s*(?:b|kb|mb|gb|tb|ms|s|sec|m|min|h|hr|hours)?$/i.test(val)
  ) {
    return 'quantity';
  }

  // 5. Status / Boolean
  if (
    pred.includes('status') ||
    pred.includes('state') ||
    pred.includes('enabled') ||
    pred.includes('disabled') ||
    ['true', 'false', 'yes', 'no', 'enabled', 'disabled', 'on', 'off'].includes(val)
  ) {
    return 'status';
  }

  // 6. Policy / Requirement
  if (pred.includes('policy') || pred.includes('rule')) {
    return 'policy';
  }
  if (pred.includes('requirement') || pred.includes('prerequisite')) {
    return 'requirement';
  }

  return 'configuration';
}
