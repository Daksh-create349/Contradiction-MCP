export interface ConfidenceScoreInputs {
  subjectSimilarity: number;
  predicateSimilarity: number;
  valueComparable: boolean;
  valueDifferenceStrength: number;
  claimAConfidence?: number;
  claimBConfidence?: number;
  sourceATrust?: number;
  sourceBTrust?: number;
  isAmbiguous?: boolean;
}

export interface ConfidenceScoreResult {
  confidence: number;
  breakdown: {
    subjectWeight: number;
    predicateWeight: number;
    valueDifferenceWeight: number;
    claimConfidenceWeight: number;
    sourceTrustWeight: number;
    ambiguityPenalty: number;
    rawScore: number;
  };
}

/**
 * Deterministic Heuristic Confidence Scorer
 *
 * Formula:
 * rawConfidence = (subjectSimilarity * 0.30)
 *               + (predicateSimilarity * 0.30)
 *               + (valueDifferenceStrength * 0.20)
 *               + (avgClaimConfidence * 0.10)
 *               + (avgSourceTrust * 0.10)
 *               - ambiguityPenalty (0.25 if ambiguous or unparseable)
 *
 * Final score clamped to [0.0, 1.0] and rounded to 2 decimal places.
 */
export class ConfidenceScorer {
  public calculate(inputs: ConfidenceScoreInputs): ConfidenceScoreResult {
    const subSim = Math.max(0, Math.min(1, inputs.subjectSimilarity));
    const predSim = Math.max(0, Math.min(1, inputs.predicateSimilarity));
    const diffStrength = inputs.valueComparable
      ? Math.max(0, Math.min(1, inputs.valueDifferenceStrength))
      : 0.3;

    const confA = inputs.claimAConfidence ?? 1.0;
    const confB = inputs.claimBConfidence ?? 1.0;
    const avgClaimConfidence = Math.max(0, Math.min(1, (confA + confB) / 2));

    const trustA = inputs.sourceATrust ?? 1.0;
    const trustB = inputs.sourceBTrust ?? 1.0;
    const avgSourceTrust = Math.max(0, Math.min(1, (trustA + trustB) / 2));

    const subjectWeight = subSim * 0.3;
    const predicateWeight = predSim * 0.3;
    const valueDifferenceWeight = diffStrength * 0.2;
    const claimConfidenceWeight = avgClaimConfidence * 0.1;
    const sourceTrustWeight = avgSourceTrust * 0.1;

    let ambiguityPenalty = 0.0;
    if (inputs.isAmbiguous || !inputs.valueComparable) {
      ambiguityPenalty = 0.25;
    }

    const rawScore =
      subjectWeight +
      predicateWeight +
      valueDifferenceWeight +
      claimConfidenceWeight +
      sourceTrustWeight -
      ambiguityPenalty;

    const clampedConfidence = Math.max(0.0, Math.min(1.0, rawScore));
    const roundedConfidence = Number(clampedConfidence.toFixed(2));

    return {
      confidence: roundedConfidence,
      breakdown: {
        subjectWeight: Number(subjectWeight.toFixed(3)),
        predicateWeight: Number(predicateWeight.toFixed(3)),
        valueDifferenceWeight: Number(valueDifferenceWeight.toFixed(3)),
        claimConfidenceWeight: Number(claimConfidenceWeight.toFixed(3)),
        sourceTrustWeight: Number(sourceTrustWeight.toFixed(3)),
        ambiguityPenalty,
        rawScore: Number(rawScore.toFixed(3)),
      },
    };
  }
}

export const confidenceScorer = new ConfidenceScorer();
