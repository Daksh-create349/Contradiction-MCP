import crypto from 'node:crypto';

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
