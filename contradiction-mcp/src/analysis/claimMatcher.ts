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

  return Math.max(tokenSim, editSim);
}

export class ClaimMatcher {
  private readonly subjectThreshold: number;
  private readonly predicateThreshold: number;

  constructor(options?: ClaimMatcherOptions) {
    this.subjectThreshold = options?.subjectThreshold ?? 0.75;
    this.predicateThreshold = options?.predicateThreshold ?? 0.8;
  }

  public match(
    claimA: { subject: string; predicate: string },
    claimB: { subject: string; predicate: string },
  ): ClaimMatchResult {
    const normSubA = normalizeText(claimA.subject);
    const normSubB = normalizeText(claimB.subject);
    const normPredA = normalizeText(claimA.predicate);
    const normPredB = normalizeText(claimB.predicate);

    const subjectSimilarity = calculateCompositeSimilarity(claimA.subject, claimB.subject);
    const predicateSimilarity = calculateCompositeSimilarity(claimA.predicate, claimB.predicate);

    const subjectMatches = subjectSimilarity >= this.subjectThreshold;
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
      reason = `Matches same conceptual fact on subject '${normSubA}' and predicate '${normPredA}'`;
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
