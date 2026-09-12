import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';
import { Contradiction } from '../domain/entities/contradiction.js';
import { AuthorityScorer, AuthorityScoreResult } from './authorityScorer.js';
import { FreshnessScorer, FreshnessScoreResult } from './freshnessScorer.js';
import { EvidenceEvaluator, EvidenceQualityResult } from './evidenceEvaluator.js';

export interface ResolutionAdvice {
  likelyCurrentClaim: 'claimA' | 'claimB' | 'neither' | 'uncertain';
  confidence: number;
  recommendedAction: string;
  reason: string;
  authorityComparison: {
    claimAScore: number;
    claimBScore: number;
    winner: 'claimA' | 'claimB' | 'tie';
    details: AuthorityScoreResult;
  };
  freshnessComparison: {
    claimAScore: number;
    claimBScore: number;
    winner: 'claimA' | 'claimB' | 'tie';
    details: FreshnessScoreResult;
  };
  evidenceComparison: {
    claimAQuality: EvidenceQualityResult;
    claimBQuality: EvidenceQualityResult;
  };
  remainingUncertainty: string[];
}

export class ResolutionAdvisor {
  private readonly authorityScorer: AuthorityScorer;
  private readonly freshnessScorer: FreshnessScorer;
  private readonly evidenceEvaluator: EvidenceEvaluator;

  constructor() {
    this.authorityScorer = new AuthorityScorer();
    this.freshnessScorer = new FreshnessScorer();
    this.evidenceEvaluator = new EvidenceEvaluator();
  }

  /**
   * Generates comprehensive advisory recommendation for resolving a contradiction.
   * Advisory-only; does not mutate external or database state.
   */
  public adviseResolution(
    contradiction: Contradiction,
    claimA: Claim,
    claimB: Claim,
    sourceA?: Source | null,
    sourceB?: Source | null,
  ): ResolutionAdvice {
    const authA = this.authorityScorer.scoreAuthority(claimA, sourceA);
    const authB = this.authorityScorer.scoreAuthority(claimB, sourceB);

    const freshA = this.freshnessScorer.scoreFreshness(claimA, sourceA);
    const freshB = this.freshnessScorer.scoreFreshness(claimB, sourceB);

    const evidA = this.evidenceEvaluator.evaluateEvidence(claimA);
    const evidB = this.evidenceEvaluator.evaluateEvidence(claimB);

    const remainingUncertainty: string[] = [];

    // Authority comparison
    const authDiff = authA.score - authB.score;
    const authWinner: 'claimA' | 'claimB' | 'tie' =
      Math.abs(authDiff) < 0.08 ? 'tie' : authDiff > 0 ? 'claimA' : 'claimB';

    // Freshness comparison
    const freshDiff = freshA.score - freshB.score;
    const freshWinner: 'claimA' | 'claimB' | 'tie' =
      Math.abs(freshDiff) < 0.08 ? 'tie' : freshDiff > 0 ? 'claimA' : 'claimB';

    let likelyCurrentClaim: 'claimA' | 'claimB' | 'neither' | 'uncertain';
    let confidence: number;
    let recommendedAction = 'Review both sources manually before updating.';
    let reason = 'Both claims exhibit similar authority and freshness levels.';

    if (authWinner === 'claimA' && (freshWinner === 'claimA' || freshWinner === 'tie')) {
      likelyCurrentClaim = 'claimA';
      confidence = Math.min(0.95, Number((0.6 + Math.abs(authDiff) * 0.4).toFixed(2)));
      reason = `Claim A represents a higher-confidence candidate for current truth because it carries higher operational authority (${authA.score.toFixed(2)} vs ${authB.score.toFixed(2)}) and is at least as fresh.`;
      recommendedAction = `Accept Claim A ('${claimA.value}') and update the conflicting source '${sourceB?.name || claimB.sourceId}'.`;
    } else if (authWinner === 'claimB' && (freshWinner === 'claimB' || freshWinner === 'tie')) {
      likelyCurrentClaim = 'claimB';
      confidence = Math.min(0.95, Number((0.6 + Math.abs(authDiff) * 0.4).toFixed(2)));
      reason = `Claim B represents a higher-confidence candidate for current truth because it carries higher operational authority (${authB.score.toFixed(2)} vs ${authA.score.toFixed(2)}) and is at least as fresh.`;
      recommendedAction = `Accept Claim B ('${claimB.value}') and update the conflicting source '${sourceA?.name || claimA.sourceId}'.`;
    } else if (authWinner === 'claimA' && freshWinner === 'claimB') {
      // Conflict between authority and recency
      if (
        authA.score >= 0.85 &&
        (claimB.sourceRole === 'documentation' || claimB.sourceRole === 'example')
      ) {
        likelyCurrentClaim = 'claimA';
        confidence = 0.72;
        reason = `Claim A is operational configuration with high authority (${authA.score.toFixed(2)}), outweighing the more recent documentation claim B.`;
        recommendedAction = `Verify whether documentation in '${sourceB?.name || 'source B'}' is outdated or describes a future planned version.`;
      } else {
        likelyCurrentClaim = 'uncertain';
        confidence = 0.45;
        reason = `Trade-off detected: Claim A has higher authority (${authA.score.toFixed(2)}) but Claim B is significantly more recent (${freshB.score.toFixed(2)}).`;
        remainingUncertainty.push('Authority and freshness indicators favor opposing claims.');
        recommendedAction =
          'Investigate git commit history or deploy logs to confirm whether Claim B represents a deliberate recent migration.';
      }
    } else if (authWinner === 'claimB' && freshWinner === 'claimA') {
      if (
        authB.score >= 0.85 &&
        (claimA.sourceRole === 'documentation' || claimA.sourceRole === 'example')
      ) {
        likelyCurrentClaim = 'claimB';
        confidence = 0.72;
        reason = `Claim B is operational configuration with high authority (${authB.score.toFixed(2)}), outweighing the more recent documentation claim A.`;
        recommendedAction = `Verify whether documentation in '${sourceA?.name || 'source A'}' is outdated or describes a future planned version.`;
      } else {
        likelyCurrentClaim = 'uncertain';
        confidence = 0.45;
        reason = `Trade-off detected: Claim B has higher authority (${authB.score.toFixed(2)}) but Claim A is significantly more recent (${freshA.score.toFixed(2)}).`;
        remainingUncertainty.push('Authority and freshness indicators favor opposing claims.');
        recommendedAction =
          'Investigate git commit history or deploy logs to confirm whether Claim A represents a deliberate recent migration.';
      }
    } else {
      likelyCurrentClaim = 'uncertain';
      confidence = 0.5;
      remainingUncertainty.push(
        'Neither claim exhibits decisive authority or freshness dominance.',
      );
    }

    if (evidA.quality === 'WEAK' && evidB.quality === 'STRONG') {
      remainingUncertainty.push('Claim A has weak evidence quality compared to Claim B.');
    } else if (evidB.quality === 'WEAK' && evidA.quality === 'STRONG') {
      remainingUncertainty.push('Claim B has weak evidence quality compared to Claim A.');
    }

    return {
      likelyCurrentClaim,
      confidence,
      recommendedAction,
      reason,
      authorityComparison: {
        claimAScore: authA.score,
        claimBScore: authB.score,
        winner: authWinner,
        details: authA,
      },
      freshnessComparison: {
        claimAScore: freshA.score,
        claimBScore: freshB.score,
        winner: freshWinner,
        details: freshA,
      },
      evidenceComparison: {
        claimAQuality: evidA,
        claimBQuality: evidB,
      },
      remainingUncertainty,
    };
  }
}
