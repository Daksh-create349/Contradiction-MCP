import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';
import { ContradictionSeverity, ContradictionType } from '../domain/entities/contradiction.js';
import { claimMatcher, ClaimMatchResult } from './claimMatcher.js';
import { valueComparator, ValueComparisonResult } from './valueComparator.js';
import { contradictionClassifier } from './contradictionClassifier.js';
import { confidenceScorer } from './confidenceScorer.js';
import { explanationBuilder } from './explanationBuilder.js';
import { contextAnalyzer, ContextAnalysisResult } from './contextAnalyzer.js';
import { ClaimRelationship } from './claimRelationship.js';

export type ContradictionAnalysisStatus =
  'CONFIRMED_CONTRADICTION' | 'NOT_A_CONTRADICTION' | 'UNCERTAIN';

export interface ContradictionAnalysis {
  isContradiction: boolean;
  analysisStatus: ContradictionAnalysisStatus;
  relationship: ClaimRelationship;
  contradictionType: ContradictionType;
  severity: ContradictionSeverity;
  confidence: number;
  explanation: string;
  evidence: {
    claimA: Claim;
    claimB: Claim;
    match: ClaimMatchResult;
    comparison: ValueComparisonResult;
    context?: ContextAnalysisResult;
    confidenceBreakdown?: Record<string, unknown>;
  };
}

export class ContradictionEngine {
  public analyzePair(
    claimA: Claim,
    claimB: Claim,
    sourceA?: Source | null,
    sourceB?: Source | null,
  ): ContradictionAnalysis {
    // 1. Same claim identity check
    if (claimA.id && claimB.id && claimA.id === claimB.id) {
      const emptyMatch: ClaimMatchResult = {
        matches: true,
        subjectSimilarity: 1.0,
        predicateSimilarity: 1.0,
        normalizedSubjectA: claimA.subject,
        normalizedSubjectB: claimB.subject,
        normalizedPredicateA: claimA.predicate,
        normalizedPredicateB: claimB.predicate,
        reason: 'Identical claim comparison',
      };
      const emptyComp: ValueComparisonResult = {
        comparable: true,
        equal: true,
        compatible: true,
        normalizedA: claimA.value,
        normalizedB: claimB.value,
        valueType: claimA.valueType,
        differenceStrength: 0.0,
      };
      const relationship: ClaimRelationship = {
        type: 'SAME_FACT',
        confidence: 1.0,
        explanation: 'A claim cannot contradict itself.',
        isContradictionEligible: false,
        contextFactors: {
          environmentMatch: true,
          scopeMatch: true,
          roleMatch: true,
          temporalMatch: true,
          setMembershipMatch: false,
        },
      };

      return {
        isContradiction: false,
        analysisStatus: 'NOT_A_CONTRADICTION',
        relationship,
        contradictionType: 'UNKNOWN',
        severity: 'LOW',
        confidence: 0.0,
        explanation: 'A claim cannot contradict itself.',
        evidence: {
          claimA,
          claimB,
          match: emptyMatch,
          comparison: emptyComp,
        },
      };
    }

    // 2. Claim matching (Do they refer to the same conceptual fact?)
    const match = claimMatcher.match(
      { subject: claimA.subject, predicate: claimA.predicate },
      { subject: claimB.subject, predicate: claimB.predicate },
    );

    if (!match.matches) {
      const fallbackComp = valueComparator.compare(claimA.value, claimB.value, claimA.valueType);
      const relationship: ClaimRelationship = {
        type: 'UNKNOWN',
        confidence: 0.0,
        explanation: `Claims describe distinct subjects or properties (${match.reason}).`,
        isContradictionEligible: false,
        contextFactors: {
          environmentMatch: claimA.environment === claimB.environment,
          scopeMatch: claimA.scope === claimB.scope,
          roleMatch: claimA.sourceRole === claimB.sourceRole,
          temporalMatch: true,
          setMembershipMatch: false,
        },
      };

      return {
        isContradiction: false,
        analysisStatus: 'NOT_A_CONTRADICTION',
        relationship,
        contradictionType: 'UNKNOWN',
        severity: 'LOW',
        confidence: 0.0,
        explanation: explanationBuilder.buildNonContradictionReason({
          match,
          comparison: fallbackComp,
          claimA,
          claimB,
          contextRelationship: relationship,
        }),
        evidence: {
          claimA,
          claimB,
          match,
          comparison: fallbackComp,
        },
      };
    }

    // 3. Context Analysis (Dimensional context evaluation)
    const contextResult = contextAnalyzer.analyze(claimA, claimB);

    if (!contextResult.relationship.isContradictionEligible) {
      const fallbackComp = valueComparator.compare(claimA.value, claimB.value, claimA.valueType);
      return {
        isContradiction: false,
        analysisStatus: 'NOT_A_CONTRADICTION',
        relationship: contextResult.relationship,
        contradictionType: 'UNKNOWN',
        severity: 'LOW',
        confidence: contextResult.relationship.confidence,
        explanation: explanationBuilder.buildNonContradictionReason({
          match,
          comparison: fallbackComp,
          claimA,
          claimB,
          contextRelationship: contextResult.relationship,
        }),
        evidence: {
          claimA,
          claimB,
          match,
          comparison: fallbackComp,
          context: contextResult,
        },
      };
    }

    // 4. Value comparison
    const resolvedValueType =
      claimA.valueType === claimB.valueType
        ? claimA.valueType
        : claimA.valueType && !['configuration', 'string'].includes(claimA.valueType)
          ? claimA.valueType
          : claimB.valueType && !['configuration', 'string'].includes(claimB.valueType)
            ? claimB.valueType
            : claimA.predicate.includes('version') || claimB.predicate.includes('version')
              ? 'version'
              : undefined;
    const comparison = valueComparator.compare(claimA.value, claimB.value, resolvedValueType);

    // If values are equivalent after normalization
    if (comparison.equal) {
      const relationship: ClaimRelationship = {
        type: 'SAME_FACT',
        confidence: 1.0,
        explanation: `Both claims assert equivalent normalized values ('${comparison.normalizedA}').`,
        isContradictionEligible: false,
        contextFactors: contextResult.relationship.contextFactors,
      };

      return {
        isContradiction: false,
        analysisStatus: 'NOT_A_CONTRADICTION',
        relationship,
        contradictionType: 'UNKNOWN',
        severity: 'LOW',
        confidence: 0.0,
        explanation: explanationBuilder.buildNonContradictionReason({
          match,
          comparison,
          claimA,
          claimB,
          contextRelationship: relationship,
        }),
        evidence: {
          claimA,
          claimB,
          match,
          comparison,
          context: contextResult,
        },
      };
    }

    // If values are compatible (e.g. SemVer range satisfaction or overlapping range)
    if (comparison.compatible) {
      const relationship: ClaimRelationship = {
        type: 'COMPATIBLE_FACT',
        confidence: 0.9,
        explanation: `Values '${claimA.value}' and '${claimB.value}' are compatible (${comparison.differenceType || 'COMPATIBLE'}).`,
        isContradictionEligible: false,
        contextFactors: contextResult.relationship.contextFactors,
      };

      return {
        isContradiction: false,
        analysisStatus: 'NOT_A_CONTRADICTION',
        relationship,
        contradictionType: 'UNKNOWN',
        severity: 'LOW',
        confidence: 0.1,
        explanation: explanationBuilder.buildNonContradictionReason({
          match,
          comparison,
          claimA,
          claimB,
          contextRelationship: relationship,
        }),
        evidence: {
          claimA,
          claimB,
          match,
          comparison,
          context: contextResult,
        },
      };
    }

    // Inconclusive / uncomparable check
    if (!comparison.comparable) {
      const relationship: ClaimRelationship = {
        type: 'UNKNOWN',
        confidence: 0.2,
        explanation: `Values cannot be reliably compared under valueType '${claimA.valueType}'.`,
        isContradictionEligible: false,
        contextFactors: contextResult.relationship.contextFactors,
      };

      return {
        isContradiction: false,
        analysisStatus: 'UNCERTAIN',
        relationship,
        contradictionType: 'UNKNOWN',
        severity: 'LOW',
        confidence: 0.2,
        explanation: explanationBuilder.buildNonContradictionReason({
          match,
          comparison,
          claimA,
          claimB,
          contextRelationship: relationship,
        }),
        evidence: {
          claimA,
          claimB,
          match,
          comparison,
          context: contextResult,
        },
      };
    }

    // 5. Contradiction classification & severity
    const classification = contradictionClassifier.classify({
      predicate: claimA.predicate,
      valueType: comparison.valueType,
      comparison,
    });

    // 6. Confidence scoring
    const confidenceResult = confidenceScorer.calculate({
      subjectSimilarity: match.subjectSimilarity,
      predicateSimilarity: match.predicateSimilarity,
      valueComparable: comparison.comparable,
      valueDifferenceStrength: comparison.differenceStrength,
      claimAConfidence: claimA.confidence,
      claimBConfidence: claimB.confidence,
      sourceATrust: sourceA ? sourceA.trustScore : 1.0,
      sourceBTrust: sourceB ? sourceB.trustScore : 1.0,
      isAmbiguous: !comparison.comparable || comparison.differenceStrength < 0.3,
    });

    // 7. Explanation generation
    const explanation = explanationBuilder.build({
      claimA,
      claimB,
      sourceA,
      sourceB,
      match,
      comparison,
      classification,
      context: {
        relationship: contextResult.relationship,
        compatibilityScore: contextResult.compatibilityScore,
        divergenceDimensions: contextResult.divergenceDimensions,
      },
    });

    const relationship: ClaimRelationship = {
      type: 'INCOMPATIBLE_FACT',
      confidence: confidenceResult.confidence,
      explanation,
      isContradictionEligible: true,
      contextFactors: contextResult.relationship.contextFactors,
    };

    return {
      isContradiction: true,
      analysisStatus: 'CONFIRMED_CONTRADICTION',
      relationship,
      contradictionType: classification.contradictionType,
      severity: classification.severity,
      confidence: confidenceResult.confidence,
      explanation,
      evidence: {
        claimA,
        claimB,
        match,
        comparison,
        context: contextResult,
        confidenceBreakdown: confidenceResult.breakdown,
      },
    };
  }
}

export const contradictionEngine = new ContradictionEngine();
