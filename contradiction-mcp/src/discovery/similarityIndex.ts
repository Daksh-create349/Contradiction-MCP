import { Claim } from '../domain/entities/claim.js';
import {
  normalizeText,
  calculateCompositeSimilarity,
  arePredicateSynonyms,
  getCanonicalPredicate,
} from '../analysis/claimMatcher.js';
import { candidateGenerator } from './candidateGenerator.js';

export interface ClaimIndex {
  add(claim: Claim): void;
  addMany(claims: Claim[]): void;
  findCandidates(claim: Claim): Claim[];
  clear(): void;
  size(): number;
}

export class InMemoryClaimIndex implements ClaimIndex {
  private readonly claims = new Map<string, Claim>();
  // Bucket by normalizedSubject::normalizedPredicate for fast O(1) group lookup
  private readonly exactBucket = new Map<string, Set<string>>();
  // Bucket by normalizedSubject for fuzzy predicate matching
  private readonly subjectBucket = new Map<string, Set<string>>();
  // Bucket by canonicalPredicate for cross-source and synonym lookup
  private readonly canonicalPredBucket = new Map<string, Set<string>>();

  public add(claim: Claim): void {
    if (!claim.id) return;
    this.claims.set(claim.id, claim);

    const normSub = normalizeText(claim.subject);
    const normPred = normalizeText(claim.predicate);
    const canonPred = getCanonicalPredicate(claim.predicate);
    const exactKey = `${normSub}::${normPred}`;

    // Add to exact bucket
    let exactSet = this.exactBucket.get(exactKey);
    if (!exactSet) {
      exactSet = new Set<string>();
      this.exactBucket.set(exactKey, exactSet);
    }
    exactSet.add(claim.id);

    // Add to subject bucket
    let subjectSet = this.subjectBucket.get(normSub);
    if (!subjectSet) {
      subjectSet = new Set<string>();
      this.subjectBucket.set(normSub, subjectSet);
    }
    subjectSet.add(claim.id);

    // Add to canonical predicate bucket
    let canonSet = this.canonicalPredBucket.get(canonPred);
    if (!canonSet) {
      canonSet = new Set<string>();
      this.canonicalPredBucket.set(canonPred, canonSet);
    }
    canonSet.add(claim.id);
  }

  public addMany(claims: Claim[]): void {
    for (const claim of claims) {
      this.add(claim);
    }
  }

  public findCandidates(claim: Claim): Claim[] {
    if (!claim.id && !claim.subject) return [];

    const normSub = normalizeText(claim.subject);
    const normPred = normalizeText(claim.predicate);
    const canonPred = getCanonicalPredicate(claim.predicate);
    const exactKey = `${normSub}::${normPred}`;

    const candidateIds = new Set<string>();

    // 1. Direct exact bucket matches
    const exactMatches = this.exactBucket.get(exactKey);
    if (exactMatches) {
      for (const id of exactMatches) {
        if (id !== claim.id) {
          candidateIds.add(id);
        }
      }
    }

    // 2. Canonical predicate bucket matches across compatible subjects (including synonyms)
    const canonMatches = this.canonicalPredBucket.get(canonPred);
    if (canonMatches) {
      for (const id of canonMatches) {
        if (id !== claim.id && !candidateIds.has(id)) {
          const candidate = this.claims.get(id);
          if (
            candidate &&
            candidateGenerator.areSubjectsCompatible(
              claim.subject,
              candidate.subject,
              claim.predicate,
            )
          ) {
            candidateIds.add(id);
          }
        }
      }
    }

    // 3. Near-predicate matches within same subject (e.g. "node-version" vs "nodejs version")
    const subjectMatches = this.subjectBucket.get(normSub);
    if (subjectMatches) {
      for (const id of subjectMatches) {
        if (id === claim.id || candidateIds.has(id)) continue;
        const candidate = this.claims.get(id);
        if (candidate) {
          const leafA = claim.predicate.split('_').pop() || claim.predicate;
          const leafB = candidate.predicate.split('_').pop() || candidate.predicate;
          const isSyn =
            arePredicateSynonyms(claim.predicate, candidate.predicate) ||
            arePredicateSynonyms(leafA, leafB);
          const sim = isSyn
            ? 1.0
            : leafA !== leafB &&
                (claim.predicate.includes('_') || candidate.predicate.includes('_'))
              ? 0
              : calculateCompositeSimilarity(claim.predicate, candidate.predicate);
          if (isSyn || sim >= 0.65) {
            candidateIds.add(id);
          }
        }
      }
    }

    // Convert candidate IDs to Claim objects
    const results: Claim[] = [];
    for (const id of candidateIds) {
      const c = this.claims.get(id);
      if (c) {
        results.push(c);
      }
    }

    return results;
  }

  public clear(): void {
    this.claims.clear();
    this.exactBucket.clear();
    this.subjectBucket.clear();
    this.canonicalPredBucket.clear();
  }

  public size(): number {
    return this.claims.size;
  }

  public getAllClaims(): Claim[] {
    return Array.from(this.claims.values());
  }
}

export const claimIndex = new InMemoryClaimIndex();
