import { Claim } from '../domain/entities/claim.js';
import { normalizeText, calculateCompositeSimilarity } from '../analysis/claimMatcher.js';

export interface ClaimPair {
  claimA: Claim;
  claimB: Claim;
  pairKey: string;
}

export function getCanonicalPairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
}

export class CandidateGenerator {
  public generatePairs(claims: Claim[]): ClaimPair[] {
    if (claims.length < 2) {
      return [];
    }

    const pairsMap = new Map<string, ClaimPair>();

    // 1. Group claims by normalized subject
    const subjectGroups = new Map<string, Claim[]>();
    for (const claim of claims) {
      const normSub = normalizeText(claim.subject);
      if (!normSub) continue;

      let group = subjectGroups.get(normSub);
      if (!group) {
        group = [];
        subjectGroups.set(normSub, group);
      }
      group.push(claim);
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

      // 2a. All claims sharing exact normalized predicate are pairs
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

      // 2b. Check cross-predicate pairs within the same subject if predicates are similar
      const predKeys = Array.from(predGroups.keys());
      for (let i = 0; i < predKeys.length; i++) {
        for (let j = i + 1; j < predKeys.length; j++) {
          const pred1 = predKeys[i];
          const pred2 = predKeys[j];

          const similarity = calculateCompositeSimilarity(pred1, pred2);
          if (similarity >= 0.75) {
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
