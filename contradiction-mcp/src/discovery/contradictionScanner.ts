import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';
import { ContradictionSeverity, ContradictionType } from '../domain/entities/contradiction.js';
import { contradictionEngine, ContradictionAnalysis } from '../analysis/contradictionEngine.js';
import { ClaimPair, getCanonicalPairKey } from './candidateGenerator.js';
import { rankingService, RankableContradiction } from './rankingService.js';

export interface DiscoveredContradiction extends RankableContradiction {
  contradictionId?: string;
  claimA: Claim;
  claimB: Claim;
  sourceA: Source | null;
  sourceB: Source | null;
  contradictionType: ContradictionType;
  severity: ContradictionSeverity;
  confidence: number;
  explanation: string;
  detectedAt: Date;
  evidence: ContradictionAnalysis['evidence'];
  priorityScore: number;
}

export interface ScannerOptions {
  minConfidence?: number;
}

export class ContradictionScanner {
  public scanPairs(
    pairs: ClaimPair[],
    sourcesMap: Map<string, Source>,
    options?: ScannerOptions,
  ): { pairsAnalyzed: number; contradictions: DiscoveredContradiction[] } {
    const minConfidence = options?.minConfidence ?? 0.0;
    const seenPairs = new Set<string>();
    const unrankedContradictions: DiscoveredContradiction[] = [];
    let pairsAnalyzed = 0;

    for (const pair of pairs) {
      if (pair.claimA.id === pair.claimB.id) continue;

      const key = pair.pairKey || getCanonicalPairKey(pair.claimA.id, pair.claimB.id);
      if (seenPairs.has(key)) {
        continue;
      }
      seenPairs.add(key);
      pairsAnalyzed++;

      const sourceA = sourcesMap.get(pair.claimA.sourceId) ?? null;
      const sourceB = sourcesMap.get(pair.claimB.sourceId) ?? null;

      const analysis = contradictionEngine.analyzePair(pair.claimA, pair.claimB, sourceA, sourceB);

      if (
        analysis.analysisStatus === 'CONFIRMED_CONTRADICTION' &&
        analysis.confidence >= minConfidence
      ) {
        unrankedContradictions.push({
          claimA: pair.claimA,
          claimB: pair.claimB,
          sourceA,
          sourceB,
          contradictionType: analysis.contradictionType,
          severity: analysis.severity,
          confidence: analysis.confidence,
          explanation: analysis.explanation,
          detectedAt: new Date(),
          evidence: analysis.evidence,
          priorityScore: 0, // Assigned by rankingService below
        });
      }
    }

    const ranked = rankingService.rank(unrankedContradictions);

    return {
      pairsAnalyzed,
      contradictions: ranked as DiscoveredContradiction[],
    };
  }
}

export const contradictionScanner = new ContradictionScanner();
