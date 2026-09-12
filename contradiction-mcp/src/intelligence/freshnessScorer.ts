import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';

export interface FreshnessScoreResult {
  score: number;
  observedAgeDays: number;
  isHistorical: boolean;
  reasoning: string[];
}

export class FreshnessScorer {
  /**
   * Evaluates the recency and temporal validity of a claim.
   * Employs an exponential decay heuristic calibrated over days.
   */
  public scoreFreshness(
    claim: Claim,
    source?: Source | null,
    referenceDate: Date = new Date(),
  ): FreshnessScoreResult {
    const reasoning: string[] = [];
    const refMs = referenceDate.getTime();

    // 1. Historical flag penalty
    if (claim.isHistorical) {
      reasoning.push('Claim explicitly flagged as historical (freshness penalty: 0.10 baseline)');
      return {
        score: 0.1,
        observedAgeDays: Math.max(0, (refMs - claim.observedAt.getTime()) / (1000 * 60 * 60 * 24)),
        isHistorical: true,
        reasoning,
      };
    }

    // 2. Temporal validity window check
    if (claim.validUntil && claim.validUntil.getTime() < refMs) {
      reasoning.push(
        `Claim validity expired on ${claim.validUntil.toISOString()} (freshness penalty: 0.15 baseline)`,
      );
      return {
        score: 0.15,
        observedAgeDays: Math.max(0, (refMs - claim.observedAt.getTime()) / (1000 * 60 * 60 * 24)),
        isHistorical: false,
        reasoning,
      };
    }

    // 3. Observed Age Decay
    // Compare observation time and source last fetched time
    const effectiveTime = source?.lastFetchedAt
      ? Math.max(claim.observedAt.getTime(), source.lastFetchedAt.getTime())
      : claim.observedAt.getTime();

    const ageMs = Math.max(0, refMs - effectiveTime);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Half-life model: score = exp(-0.693 * ageDays / halfLifeDays)
    // 180 days half-life for technical documentation & runtime assertions
    const halfLifeDays = 180;
    let baseFreshness = Math.exp((-0.693 * ageDays) / halfLifeDays);
    baseFreshness = Math.max(0.2, Math.min(1.0, baseFreshness));

    reasoning.push(
      `Observed age: ${ageDays.toFixed(1)} days ago (base freshness: ${baseFreshness.toFixed(2)})`,
    );

    // 4. Boost if validFrom is explicit and active
    if (claim.validFrom && claim.validFrom.getTime() <= refMs) {
      baseFreshness = Math.min(1.0, baseFreshness + 0.05);
      reasoning.push(`Active validity window starting ${claim.validFrom.toISOString()}`);
    }

    const score = Number(baseFreshness.toFixed(4));
    return {
      score,
      observedAgeDays: Number(ageDays.toFixed(1)),
      isHistorical: false,
      reasoning,
    };
  }

  /**
   * Compares the freshness of two claims directly.
   */
  public compareFreshness(
    claimA: Claim,
    claimB: Claim,
    sourceA?: Source | null,
    sourceB?: Source | null,
    referenceDate: Date = new Date(),
  ): {
    winner: 'claimA' | 'claimB' | 'tie';
    claimAScore: number;
    claimBScore: number;
    differenceDays: number;
    reason: string;
  } {
    const freshA = this.scoreFreshness(claimA, sourceA, referenceDate);
    const freshB = this.scoreFreshness(claimB, sourceB, referenceDate);

    const diffDays = Math.abs(freshA.observedAgeDays - freshB.observedAgeDays);
    const scoreDiff = freshA.score - freshB.score;

    if (Math.abs(scoreDiff) < 0.05) {
      return {
        winner: 'tie',
        claimAScore: freshA.score,
        claimBScore: freshB.score,
        differenceDays: diffDays,
        reason: `Both claims have comparable temporal freshness (scores: ${freshA.score.toFixed(2)} vs ${freshB.score.toFixed(2)})`,
      };
    }

    if (freshA.score > freshB.score) {
      return {
        winner: 'claimA',
        claimAScore: freshA.score,
        claimBScore: freshB.score,
        differenceDays: diffDays,
        reason: `Claim A is fresher (${freshA.observedAgeDays.toFixed(0)}d old vs ${freshB.observedAgeDays.toFixed(0)}d old)`,
      };
    }

    return {
      winner: 'claimB',
      claimAScore: freshA.score,
      claimBScore: freshB.score,
      differenceDays: diffDays,
      reason: `Claim B is fresher (${freshB.observedAgeDays.toFixed(0)}d old vs ${freshA.observedAgeDays.toFixed(0)}d old)`,
    };
  }
}
