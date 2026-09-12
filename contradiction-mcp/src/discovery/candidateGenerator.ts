import { Claim } from '../domain/entities/claim.js';
import {
  normalizeText,
  getCanonicalPredicate,
  isSystemLevelPredicate,
  isGenericOrDocumentSubject,
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
  const canonicalAlias = entityResolver.getCanonicalAlias(clean);
  if (canonicalAlias) {
    return `alias:${canonicalAlias}`;
  }

  // 2. Token-sorted canonical key so "Project Alpha" and "alpha-project" produce "alpha project"
  const tokens = norm.split(' ').sort().join(' ');
  return tokens;
}

export class CandidateGenerator {
  public readonly entityResolver: EntityResolver;

  constructor(entityResolver?: EntityResolver) {
    this.entityResolver = entityResolver ?? new EntityResolver();
  }

  public areSubjectsCompatible(subjectA: string, subjectB: string, predicate?: string): boolean {
    if (subjectA === subjectB) return true;
    const normA = normalizeText(subjectA);
    const normB = normalizeText(subjectB);
    if (normA && normB && normA === normB) return true;

    // 1. Alias match via EntityResolver
    const matchRes = this.entityResolver.resolveEntityMatch(subjectA, subjectB);
    if (matchRes.isMatch) return true;

    // 2. Generic or document-level subject compatibility
    const genA = isGenericOrDocumentSubject(subjectA);
    const genB = isGenericOrDocumentSubject(subjectB);
    if (genA && genB) return true;
    if (predicate && (genA || genB) && isSystemLevelPredicate(predicate)) return true;

    return false;
  }

  public generatePairs(claims: Claim[]): ClaimPair[] {
    if (claims.length < 2) {
      return [];
    }

    const pairsMap = new Map<string, ClaimPair>();

    const addPair = (a: Claim, b: Claim) => {
      if (a.id === b.id) return;
      const key = getCanonicalPairKey(a.id, b.id);
      if (!pairsMap.has(key)) {
        pairsMap.set(key, {
          claimA: a.id < b.id ? a : b,
          claimB: a.id < b.id ? b : a,
          pairKey: key,
        });
      }
    };

    // 1. Partition claims: generic/document-level vs specific entities
    const subjectGroups = new Map<string, Claim[]>();
    const globalClaims: Claim[] = [];

    for (const claim of claims) {
      if (isGenericOrDocumentSubject(claim.subject)) {
        globalClaims.push(claim);
      } else {
        const key = getCanonicalSubjectKey(claim.subject, this.entityResolver);
        let list = subjectGroups.get(key);
        if (!list) {
          list = [];
          subjectGroups.set(key, list);
        }
        list.push(claim);
      }
    }

    // 2. Intra-subject pairs for specific entities
    for (const [, groupClaims] of subjectGroups) {
      if (groupClaims.length < 2) continue;

      const predMap = new Map<string, Claim[]>();
      for (const claim of groupClaims) {
        const canPred = getCanonicalPredicate(claim.predicate);
        let list = predMap.get(canPred);
        if (!list) {
          list = [];
          predMap.set(canPred, list);
        }
        list.push(claim);
      }

      for (const [, pClaims] of predMap) {
        if (pClaims.length < 2) continue;
        for (let i = 0; i < pClaims.length; i++) {
          for (let j = i + 1; j < pClaims.length; j++) {
            addPair(pClaims[i], pClaims[j]);
          }
        }
      }
    }

    // 3. Global / document-level claims pairing:
    if (globalClaims.length > 0) {
      const globalPredMap = new Map<string, Claim[]>();
      for (const claim of globalClaims) {
        const canPred = getCanonicalPredicate(claim.predicate);
        let list = globalPredMap.get(canPred);
        if (!list) {
          list = [];
          globalPredMap.set(canPred, list);
        }
        list.push(claim);
      }

      // Pair global claims with other global claims sharing canonical predicate
      for (const [, pClaims] of globalPredMap) {
        if (pClaims.length < 2) continue;
        for (let i = 0; i < pClaims.length; i++) {
          for (let j = i + 1; j < pClaims.length; j++) {
            addPair(pClaims[i], pClaims[j]);
          }
        }
      }

      // Pair global claims with specific entity claims sharing system-level canonical predicate
      for (const [canPred, gClaims] of globalPredMap) {
        if (!isSystemLevelPredicate(canPred)) continue;
        for (const [, groupClaims] of subjectGroups) {
          for (const entClaim of groupClaims) {
            if (getCanonicalPredicate(entClaim.predicate) === canPred) {
              for (const gClaim of gClaims) {
                addPair(gClaim, entClaim);
              }
            }
          }
        }
      }
    }

    // 4. Cross-subject matching for entity aliases (e.g. "auth" vs "auth-service")
    const subjectKeys = Array.from(subjectGroups.keys());
    if (subjectKeys.length <= 100) {
      for (let i = 0; i < subjectKeys.length; i++) {
        for (let j = i + 1; j < subjectKeys.length; j++) {
          const k1 = subjectKeys[i];
          const k2 = subjectKeys[j];
          const matchRes = this.entityResolver.resolveEntityMatch(k1, k2);
          if (matchRes.isMatch) {
            const list1 = subjectGroups.get(k1)!;
            const list2 = subjectGroups.get(k2)!;
            for (const a of list1) {
              for (const b of list2) {
                const canA = getCanonicalPredicate(a.predicate);
                const canB = getCanonicalPredicate(b.predicate);
                if (canA === canB) {
                  addPair(a, b);
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
