import { DatabaseManager } from '../storage/database.js';
import { candidateGenerator } from './candidateGenerator.js';
import { InMemoryClaimIndex } from './similarityIndex.js';
import { contradictionScanner, DiscoveredContradiction } from './contradictionScanner.js';
import { Source } from '../domain/entities/source.js';
import { NotFoundError } from '../domain/types/common.js';

export interface ScanAllOptions {
  limit?: number;
  minConfidence?: number;
  includeDismissed?: boolean;
}

export interface ScanAllSummary {
  status: 'completed';
  claimsScanned: number;
  candidatePairs: number;
  pairsAnalyzed: number;
  contradictionsFound: number;
  newContradictions: number;
  existingContradictions: number;
  durationMs: number;
  contradictions: DiscoveredContradiction[];
}

export interface ScanClaimSummary {
  status: 'completed';
  claimId: string;
  candidatePairs: number;
  pairsAnalyzed: number;
  contradictionsFound: number;
  newContradictions: number;
  existingContradictions: number;
  durationMs: number;
  results: DiscoveredContradiction[];
}

export class DiscoveryService {
  private readonly dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public scanAllClaims(options?: ScanAllOptions): ScanAllSummary {
    const startTime = performance.now();
    const limit = options?.limit ?? 50;
    const minConfidence = options?.minConfidence ?? 0.5;
    const includeDismissed = options?.includeDismissed ?? false;

    // 1. Load all claims and sources
    const claims = this.dbManager.listClaims();
    const sources = this.dbManager.listSources();
    const sourcesMap = new Map<string, Source>(sources.map((s) => [s.id, s]));

    // 2. Generate candidate pairs
    const pairs = candidateGenerator.generatePairs(claims);

    // 3. Scan candidate pairs
    const { pairsAnalyzed, contradictions } = contradictionScanner.scanPairs(pairs, sourcesMap, {
      minConfidence,
    });

    // 4. Persist contradictions and handle duplicate prevention
    let newCount = 0;
    let existingCount = 0;
    const persistedContradictions: DiscoveredContradiction[] = [];

    for (const item of contradictions) {
      const { contradiction: record, isNew } = this.dbManager.saveDiscoveredContradiction({
        claimAId: item.claimA.id,
        claimBId: item.claimB.id,
        contradictionType: item.contradictionType,
        severity: item.severity,
        confidence: item.confidence,
        explanation: item.explanation,
        status: 'OPEN',
        metadata: {
          evidence: item.evidence,
          priorityScore: item.priorityScore,
        },
      });

      if (isNew) {
        newCount++;
      } else {
        existingCount++;
      }

      if (!includeDismissed && record.status === 'DISMISSED') {
        continue;
      }

      persistedContradictions.push({
        ...item,
        contradictionId: record.id,
      });
    }

    const durationMs = Number((performance.now() - startTime).toFixed(2));
    const finalResults = persistedContradictions.slice(0, limit);

    return {
      status: 'completed',
      claimsScanned: claims.length,
      candidatePairs: pairs.length,
      pairsAnalyzed,
      contradictionsFound: contradictions.length,
      newContradictions: newCount,
      existingContradictions: existingCount,
      durationMs,
      contradictions: finalResults,
    };
  }

  public scanClaim(claimId: string, options?: { minConfidence?: number }): ScanClaimSummary {
    const startTime = performance.now();
    const minConfidence = options?.minConfidence ?? 0.5;

    const targetClaim = this.dbManager.getClaimById(claimId);
    if (!targetClaim) {
      throw new NotFoundError('Claim', claimId);
    }

    const allClaims = this.dbManager.listClaims();
    const sources = this.dbManager.listSources();
    const sourcesMap = new Map<string, Source>(sources.map((s) => [s.id, s]));

    // Build index for candidate search
    const index = new InMemoryClaimIndex();
    index.addMany(allClaims);

    const candidates = index.findCandidates(targetClaim);
    const pairs = candidateGenerator.generatePairsForSingleClaim(targetClaim, candidates);

    const { pairsAnalyzed, contradictions } = contradictionScanner.scanPairs(pairs, sourcesMap, {
      minConfidence,
    });

    let newCount = 0;
    let existingCount = 0;
    const persistedResults: DiscoveredContradiction[] = [];

    for (const item of contradictions) {
      const { contradiction: record, isNew } = this.dbManager.saveDiscoveredContradiction({
        claimAId: item.claimA.id,
        claimBId: item.claimB.id,
        contradictionType: item.contradictionType,
        severity: item.severity,
        confidence: item.confidence,
        explanation: item.explanation,
        status: 'OPEN',
        metadata: {
          evidence: item.evidence,
          priorityScore: item.priorityScore,
        },
      });

      if (isNew) {
        newCount++;
      } else {
        existingCount++;
      }

      persistedResults.push({
        ...item,
        contradictionId: record.id,
      });
    }

    const durationMs = Number((performance.now() - startTime).toFixed(2));

    return {
      status: 'completed',
      claimId,
      candidatePairs: pairs.length,
      pairsAnalyzed,
      contradictionsFound: contradictions.length,
      newContradictions: newCount,
      existingContradictions: existingCount,
      durationMs,
      results: persistedResults,
    };
  }
}
