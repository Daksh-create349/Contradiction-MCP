import { ContradictionSeverity, ContradictionType } from '../domain/entities/contradiction.js';
import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';

export interface RankableContradiction {
  contradictionId?: string;
  claimA: Claim;
  claimB: Claim;
  sourceA?: Source | null;
  sourceB?: Source | null;
  contradictionType: ContradictionType;
  severity: ContradictionSeverity;
  confidence: number;
  explanation: string;
  detectedAt?: Date;
  priorityScore?: number;
}

const SEVERITY_WEIGHTS: Record<ContradictionSeverity, number> = {
  CRITICAL: 1.0,
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.2,
};

/**
 * Deterministic Heuristic Ranking Service
 *
 * Computes a priority score (0.0 to 1.0) using:
 * - Severity weight (35%)
 * - Contradiction confidence (35%)
 * - Source trust score (15%)
 * - Claim confidence (10%)
 * - Recency score (5%)
 *
 * NOTE: This is a deterministic heuristic score for triage ranking,
 * not a statistical probability distribution.
 */
export class RankingService {
  public computePriorityScore(item: RankableContradiction): number {
    const sevWeight = SEVERITY_WEIGHTS[item.severity] ?? 0.5;
    const conf = Math.max(0, Math.min(1, item.confidence));

    const trustA = item.sourceA?.trustScore ?? 1.0;
    const trustB = item.sourceB?.trustScore ?? 1.0;
    const avgSourceTrust = (trustA + trustB) / 2;

    const claimConfA = item.claimA.confidence ?? 1.0;
    const claimConfB = item.claimB.confidence ?? 1.0;
    const avgClaimConfidence = (claimConfA + claimConfB) / 2;

    // Recency boost: 1.0 if within last 7 days, fading to 0.0 after 90 days
    const now = Date.now();
    const detected = item.detectedAt ? item.detectedAt.getTime() : now;
    const ageDays = Math.max(0, (now - detected) / (1000 * 60 * 60 * 24));
    const recency = Math.max(0, 1 - ageDays / 90);

    const rawScore =
      sevWeight * 0.35 +
      conf * 0.35 +
      avgSourceTrust * 0.15 +
      avgClaimConfidence * 0.1 +
      recency * 0.05;

    const clamped = Math.max(0.0, Math.min(1.0, rawScore));
    return Number(clamped.toFixed(3));
  }

  public rank<T extends RankableContradiction>(items: T[]): T[] {
    const scored = items.map((item) => ({
      ...item,
      priorityScore: this.computePriorityScore(item),
    }));

    return scored.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  }
}

export const rankingService = new RankingService();
