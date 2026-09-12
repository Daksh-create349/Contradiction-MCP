import { Claim } from '../domain/entities/claim.js';
import { normalizeText, calculateCompositeSimilarity } from '../analysis/claimMatcher.js';

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

  public add(claim: Claim): void {
    if (!claim.id) return;
    this.claims.set(claim.id, claim);

    const normSub = normalizeText(claim.subject);
    const normPred = normalizeText(claim.predicate);
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

    // 2. Near-predicate matches within same subject (e.g. "node-version" vs "nodejs version")
    const subjectMatches = this.subjectBucket.get(normSub);
    if (subjectMatches) {
      for (const id of subjectMatches) {
        if (id === claim.id || candidateIds.has(id)) continue;
        const candidate = this.claims.get(id);
        if (candidate) {
          const sim = calculateCompositeSimilarity(claim.predicate, candidate.predicate);
          if (sim >= 0.75) {
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
  }

  public size(): number {
    return this.claims.size;
  }

  public getAllClaims(): Claim[] {
    return Array.from(this.claims.values());
  }
}

export const claimIndex = new InMemoryClaimIndex();
