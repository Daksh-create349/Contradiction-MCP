import { SemanticMatcher } from '../intelligence/semanticMatcher.js';
import { EntityResolver } from '../intelligence/entityResolver.js';

export interface ClaimMatchResult {
  matches: boolean;
  subjectSimilarity: number;
  predicateSimilarity: number;
  normalizedSubjectA: string;
  normalizedSubjectB: string;
  normalizedPredicateA: string;
  normalizedPredicateB: string;
  reason: string;
}

export interface ClaimMatcherOptions {
  subjectThreshold?: number;
  predicateThreshold?: number;
  enableSemanticMatching?: boolean;
}

/**
 * Normalizes text for deterministic entity/property matching:
 * - Lowercase & trim
 * - Replaces separators (hyphens, underscores, slashes, dots) with spaces
 * - Removes non-alphanumeric characters (except spaces)
 * - Collapses consecutive whitespace
 */
export function normalizeText(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/[_\-./\\:]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates Token Jaccard Similarity between two normalized strings.
 * Returns a value between 0.0 and 1.0.
 */
export function calculateTokenSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersectionCount++;
    }
  }

  const unionCount = tokensA.size + tokensB.size - intersectionCount;
  return unionCount === 0 ? 0.0 : intersectionCount / unionCount;
}

/**
 * Levenshtein distance-based string similarity for single-token or exact variations.
 */
export function calculateLevenshteinSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const l1 = s1.length;
  const l2 = s2.length;
  const maxLen = Math.max(l1, l2);
  if (maxLen === 0) return 1.0;

  const dp: number[][] = Array.from({ length: l1 + 1 }, () => Array(l2 + 1).fill(0));

  for (let i = 0; i <= l1; i++) dp[i][0] = i;
  for (let j = 0; j <= l2; j++) dp[0][j] = j;

  for (let i = 1; i <= l1; i++) {
    for (let j = 1; j <= l2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  const distance = dp[l1][l2];
  return 1 - distance / maxLen;
}

/**
 * Combined similarity score leveraging token overlap and string distance.
 */
export function calculateCompositeSimilarity(strA: string, strB: string): number {
  const normA = normalizeText(strA);
  const normB = normalizeText(strB);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  const tokenSim = calculateTokenSimilarity(normA, normB);
  const editSim = calculateLevenshteinSimilarity(normA, normB);

  // If one contains the other as substring (e.g. "api server" and "api server cluster")
  if (normA.includes(normB) || normB.includes(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    const inclusionScore = minLen / maxLen;
    return Math.max(tokenSim, editSim, inclusionScore * 0.9);
  }

  // For multi-token phrases, edit distance can be misleading if tokens differ:
  // e.g. 'node version' vs 'cache version' has editSim 0.69 even though 'node' != 'cache'.
  // Only use editSim if token overlap is already substantial (>= 0.5).
  if (tokenSim >= 0.5) {
    const editSim = calculateLevenshteinSimilarity(normA, normB);
    return Math.max(tokenSim, editSim);
  }

  return tokenSim;
}

const PREDICATE_SYNONYM_GROUPS: Array<Set<string>> = [
  new Set(['port', 'listen_port', 'server_port', 'http_port', 'service_port']),
  new Set(['max_users', 'concurrent_users', 'max_connections', 'user_limit', 'capacity']),
  new Set([
    'jwt_ttl',
    'token_expiry',
    'token_ttl',
    'token_expiration',
    'session_timeout',
    'timeout',
    'timeout_ms',
  ]),
  new Set(['db_engine', 'database_type', 'database_engine', 'db_type', 'database', 'db_backend']),
  new Set(['db_version', 'database_version', 'database_db_version', 'db_ver']),
  new Set(['node_version', 'node', 'nodejs_version', 'node_ver', 'runtime_node_version']),
  new Set(['python_version', 'python', 'python_ver', 'runtime_python_version']),
  new Set(['memory', 'ram', 'min_ram', 'minimum_ram', 'min_memory', 'memory_limit']),
  new Set(['cpu', 'cores', 'min_cpu', 'cpu_cores']),
];

export function stripWrapperPrefix(pred: string): string {
  const norm = pred.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return norm.replace(
    /^(runtime|spec|config|configuration|settings|env|metadata|properties|parameters)_+/,
    '',
  );
}

export function arePredicateSynonyms(predA: string, predB: string): boolean {
  const a = predA.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const b = predB.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (a === b) return true;

  const strippedA = stripWrapperPrefix(a);
  const strippedB = stripWrapperPrefix(b);
  if (strippedA === strippedB && strippedA.length > 0) return true;

  for (const group of PREDICATE_SYNONYM_GROUPS) {
    const hasA = group.has(a) || group.has(strippedA);
    const hasB = group.has(b) || group.has(strippedB);
    if (hasA && hasB) return true;
  }
  return false;
}

export function getCanonicalPredicate(predicate: string): string {
  const norm = predicate.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  for (const group of PREDICATE_SYNONYM_GROUPS) {
    if (group.has(norm)) {
      return Array.from(group).sort()[0];
    }
  }
  return norm;
}

export const SYSTEM_LEVEL_PREDICATES = new Set([
  'port',
  'listen_port',
  'server_port',
  'http_port',
  'service_port',
  'node_version',
  'node',
  'nodejs_version',
  'node_ver',
  'python_version',
  'python',
  'python_ver',
  'memory',
  'ram',
  'min_ram',
  'minimum_ram',
  'min_memory',
  'memory_limit',
  'cpu',
  'cores',
  'min_cpu',
  'cpu_cores',
  'db_engine',
  'database_type',
  'database_engine',
  'db_type',
  'database',
  'db_backend',
  'jwt_ttl',
  'token_expiry',
  'session_timeout',
  'timeout',
  'timeout_ms',
  'max_connections',
  'max_users',
  'concurrent_users',
  'tls_enabled',
  'ssl_enabled',
  'cluster_region',
  'environment',
  'version',
  'license',
]);

export function isSystemLevelPredicate(pred: string): boolean {
  const norm = pred.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return SYSTEM_LEVEL_PREDICATES.has(norm);
}

export function isGenericOrDocumentSubject(subject: string): boolean {
  if (!subject) return true;
  const s = subject.toLowerCase().trim();
  const genericWords = new Set([
    'default',
    'system',
    'app',
    'application',
    'service',
    'workspace',
    'spec',
    'unknown',
    'website',
    'global',
    'infrastructure',
  ]);
  if (genericWords.has(s)) return true;
  if (/\.(md|txt|json|yaml|yml|docx|csv|pdf|ts|js|html|eml)$/i.test(s)) return true;
  if (/^(file|doc|email|cto)[a-z0-9_]*$/i.test(s)) return true;
  if (
    /^[a-z0-9_-]+[_.](spec|specification|manifest|architecture|blueprint|directive|guide|config|configuration|readme|deployment)$/i.test(
      s,
    )
  ) {
    return true;
  }
  if (
    /^(spec|specification|manifest|architecture|blueprint|directive|guide|config|configuration|readme|deployment)$/i.test(
      s,
    )
  ) {
    return true;
  }
  return false;
}

export class ClaimMatcher {
  private readonly subjectThreshold: number;
  private readonly predicateThreshold: number;
  private readonly semanticMatcher: SemanticMatcher;
  private readonly entityResolver: EntityResolver;

  constructor(options?: ClaimMatcherOptions) {
    this.subjectThreshold = options?.subjectThreshold ?? 0.75;
    this.predicateThreshold = options?.predicateThreshold ?? 0.65;
    this.semanticMatcher = new SemanticMatcher({
      threshold: this.predicateThreshold,
    });
    this.entityResolver = new EntityResolver();
  }

  public match(
    claimA: { subject: string; predicate: string },
    claimB: { subject: string; predicate: string },
  ): ClaimMatchResult {
    const normSubA = normalizeText(claimA.subject);
    const normSubB = normalizeText(claimB.subject);
    const normPredA = normalizeText(claimA.predicate);
    const normPredB = normalizeText(claimB.predicate);

    const entityMatch = this.entityResolver.resolveEntityMatch(claimA.subject, claimB.subject);
    let subjectSimilarity = calculateCompositeSimilarity(claimA.subject, claimB.subject);
    if (entityMatch.isMatch) {
      subjectSimilarity = Math.max(subjectSimilarity, entityMatch.confidence);
    }

    const tokensA = normPredA.split(' ').filter(Boolean);
    const tokensB = normPredB.split(' ').filter(Boolean);
    const leafA = tokensA[tokensA.length - 1] || normPredA;
    const leafB = tokensB[tokensB.length - 1] || normPredB;

    const isSynonym = arePredicateSynonyms(claimA.predicate, claimB.predicate);

    let predicateSimilarity = calculateCompositeSimilarity(claimA.predicate, claimB.predicate);

    // Guard against cross-subsystem false matches where two predicates share only
    // a generic leaf (e.g. 'port', 'version') but have different subsystem prefixes
    // (e.g. 'api_gateway_port' vs 'cache_port', 'node_version' vs 'cache_version').
    if (!isSynonym) {
      const prefixA = tokensA.slice(0, -1).join(' ');
      const prefixB = tokensB.slice(0, -1).join(' ');

      if (prefixA && prefixB && prefixA !== prefixB && leafA === leafB) {
        predicateSimilarity = 0;
      }
    }

    let matchDetail = '';
    if (isSynonym) {
      predicateSimilarity = Math.max(predicateSimilarity, 0.95);
      matchDetail = ' (matched via predicate synonym dictionary)';
    } else if (predicateSimilarity < this.predicateThreshold && this.semanticMatcher.isEnabled()) {
      const semRes = this.semanticMatcher.match(normPredA, normPredB);
      if (semRes.matched) {
        predicateSimilarity = Math.max(predicateSimilarity, semRes.confidence);
        matchDetail = ` (matched via semantic matcher, score: ${semRes.confidence.toFixed(2)})`;
      }
    }

    const isSysPred =
      isSystemLevelPredicate(claimA.predicate) ||
      isSystemLevelPredicate(claimB.predicate) ||
      isSystemLevelPredicate(leafA) ||
      isSystemLevelPredicate(leafB);
    const isGenericSubjectA = isGenericOrDocumentSubject(claimA.subject);
    const isGenericSubjectB = isGenericOrDocumentSubject(claimB.subject);

    let subjectMatches = subjectSimilarity >= this.subjectThreshold;
    if (!subjectMatches && isSysPred && (isGenericSubjectA || isGenericSubjectB)) {
      subjectMatches = true;
      subjectSimilarity = Math.max(subjectSimilarity, 0.85);
      matchDetail += ' (cross-document system specification)';
    }

    const predicateMatches = predicateSimilarity >= this.predicateThreshold;
    const matches = subjectMatches && predicateMatches;

    let reason: string;
    if (!subjectMatches && !predicateMatches) {
      reason = `Both subject ('${normSubA}' vs '${normSubB}') and predicate ('${normPredA}' vs '${normPredB}') refer to different concepts`;
    } else if (!subjectMatches) {
      reason = `Subjects '${normSubA}' and '${normSubB}' do not match (similarity: ${subjectSimilarity.toFixed(2)})`;
    } else if (!predicateMatches) {
      reason = `Predicates '${normPredA}' and '${normPredB}' do not match (similarity: ${predicateSimilarity.toFixed(2)})`;
    } else {
      reason = `Matches same conceptual fact on subject '${normSubA}' and predicate '${normPredA}'${matchDetail}`;
    }

    return {
      matches,
      subjectSimilarity,
      predicateSimilarity,
      normalizedSubjectA: normSubA,
      normalizedSubjectB: normSubB,
      normalizedPredicateA: normPredA,
      normalizedPredicateB: normPredB,
      reason,
    };
  }
}

export const claimMatcher = new ClaimMatcher();
