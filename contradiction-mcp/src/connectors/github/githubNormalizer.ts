import { ExtractedClaim } from '../types/fetchResult.js';
import { normalizeText } from '../../analysis/claimMatcher.js';
import { ValueComparator } from '../../analysis/valueComparator.js';

export class GitHubNormalizer {
  private readonly comparator: ValueComparator;

  constructor(comparator?: ValueComparator) {
    this.comparator = comparator || new ValueComparator();
  }

  /**
   * Normalizes subject, predicate, and values of extracted claims
   * so they are consistent with the contradiction engine's comparator and matcher.
   */
  public normalizeClaims(claims: ExtractedClaim[]): ExtractedClaim[] {
    return claims.map((claim) => {
      const normPredicate = normalizeText(claim.predicate).replace(/\s+/g, '_');
      const comparison = this.comparator.compare(claim.value, claim.value, claim.valueType);

      return {
        ...claim,
        predicate: normPredicate,
        normalizedValue: comparison.normalizedA || claim.value.trim(),
      };
    });
  }
}
