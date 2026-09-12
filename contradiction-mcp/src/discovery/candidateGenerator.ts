import { Claim } from '../domain/entities/claim.js';
import {
  normalizeText,
  calculateCompositeSimilarity,
  arePredicateSynonyms,
} from '../analysis/claimMatcher.js';
import { EntityResolver } from '../intelligence/entityResolver.js';

export interface ClaimPair {
  claimA: Claim;
  claimB: Claim;
  pairKey: string;
}

export function getCanonicalPairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
}

export function getCanonicalSubjectKey(subject: string, entityResolver: EntityResolver): string {
  const clean = (subject || '').trim();
  if (!clean) return '';

  const norm = normalizeText(clean);
  if (!norm) return '';

  // 1. Check if normalized representation matches an industry alias group in EntityResolver (api, frontend, auth, db, etc.)
  const normEntity = entityResolver.normalize(clean);
  const defaultSet = (entityResolver as any).defaultAliases?.get(normEntity);
  if (defaultSet && defaultSet.size > 0) {
    const canonicalAlias = Array.from(defaultSet as Set<string>).sort()[0];
    return `alias:${canonicalAlias}`;
  }

  // 2. Token-sorted canonical key so "Project Alpha" and "alpha-project" produce "alpha project"
  const tokens = norm.split(' ').sort().join(' ');
  return tokens;
}

export class CandidateGenerator {
  private readonly entityResolver: EntityResolver;

  constructor(entityResolver?: EntityResolver) {
    this.entityResolver = entityResolver ?? new EntityResolver();
  }

  public generatePairs(claims: Claim[]): ClaimPair[] {
    if (claims.length < 2) {
      return [];
    }

    const pairsMap = new Map<string, ClaimPair>();

    // 1. Group claims by canonical subject key in O(N) linear time
    const subjectGroups = new Map<string, Claim[]>();
    for (const claim of claims) {
      const key = getCanonicalSubjectKey(claim.subject, this.entityResolver);
      if (!key) continue;

      let list = subjectGroups.get(key);
      if (!list) {
        list = [];
        subjectGroups.set(key, list);
      }
      list.push(claim);
    }

    // 2. Inside each subject group, only pair claims that share compatible predicates
    for (const [, groupClaims] of subjectGroups) {
      if (groupClaims.length < 2) continue;

      // Group further by normalized predicate
      const predGroups = new Map<string, Claim[]>();
      for (const claim of groupClaims) {
        const normPred = normalizeText(claim.predicate);
        let list = predGroups.get(normPred);
        if (!list) {
          list = [];
          predGroups.set(normPred, list);
        }
        list.push(claim);
      }

      // 2a. All claims sharing exact normalized predicate are pairs (including intra-document pairs)
      for (const [, predClaims] of predGroups) {
        if (predClaims.length < 2) continue;
        for (let i = 0; i < predClaims.length; i++) {
          for (let j = i + 1; j < predClaims.length; j++) {
            const a = predClaims[i];
            const b = predClaims[j];
            if (a.id === b.id) continue;

            const key = getCanonicalPairKey(a.id, b.id);
            if (!pairsMap.has(key)) {
              pairsMap.set(key, {
                claimA: a.id < b.id ? a : b,
                claimB: a.id < b.id ? b : a,
                pairKey: key,
              });
            }
          }
        }
      }

      // 2b. Check cross-predicate pairs within the same subject if predicates are synonyms or similar
      const predKeys = Array.from(predGroups.keys());
      for (let i = 0; i < predKeys.length; i++) {
        for (let j = i + 1; j < predKeys.length; j++) {
          const pred1 = predKeys[i];
          const pred2 = predKeys[j];

          const isSynonym = arePredicateSynonyms(pred1, pred2);
          const similarity = isSynonym ? 1.0 : calculateCompositeSimilarity(pred1, pred2);

          if (isSynonym || similarity >= 0.65) {
            const list1 = predGroups.get(pred1)!;
            const list2 = predGroups.get(pred2)!;

            for (const a of list1) {
              for (const b of list2) {
                if (a.id === b.id) continue;
                const key = getCanonicalPairKey(a.id, b.id);
                if (!pairsMap.has(key)) {
                  pairsMap.set(key, {
                    claimA: a.id < b.id ? a : b,
                    claimB: a.id < b.id ? b : a,
                    pairKey: key,
                  });
                }
              }
            }
          }
        }
      }
    }

    return Array.from(pairsMap.values());
  }

  public generatePairsForSingleClaim(claim: Claim, allCandidates: Claim[]): ClaimPair[] {
    const pairs: ClaimPair[] = [];
    const seen = new Set<string>();

    for (const candidate of allCandidates) {
      if (candidate.id === claim.id) continue;

      const key = getCanonicalPairKey(claim.id, candidate.id);
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({
          claimA: claim.id < candidate.id ? claim : candidate,
          claimB: claim.id < candidate.id ? candidate : claim,
          pairKey: key,
        });
      }
    }

    return pairs;
  }
}

export const candidateGenerator = new CandidateGenerator();
