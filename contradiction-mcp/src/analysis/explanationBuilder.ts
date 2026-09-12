import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';
import { ClaimMatchResult } from './claimMatcher.js';
import { ValueComparisonResult } from './valueComparator.js';
import { ClassificationResult } from './contradictionClassifier.js';

export interface ExplanationContext {
  claimA: Claim;
  claimB: Claim;
  sourceA?: Source | null;
  sourceB?: Source | null;
  match: ClaimMatchResult;
  comparison: ValueComparisonResult;
  classification: ClassificationResult;
  context?: {
    relationship?: { type: string; explanation: string };
    compatibilityScore?: number;
    divergenceDimensions?: string[];
  };
}

export class ExplanationBuilder {
  public build(context: ExplanationContext): string {
    const { claimA, claimB, sourceA, sourceB, match, comparison, classification } = context;

    const sourceAName = sourceA ? sourceA.name : `Source (${claimA.sourceId})`;
    const sourceBName = sourceB ? sourceB.name : `Source (${claimB.sourceId})`;

    // 1. Same fact statement
    const factStatement = `Both claims describe the ${claimA.predicate} for '${claimA.subject}' (${match.reason}).`;

    // 2. Context detail
    let contextStatement = '';
    if (claimA.environment && claimB.environment && claimA.environment !== 'unknown') {
      contextStatement = ` Operational context: ${claimA.environment} vs ${claimB.environment}.`;
    }

    // 3. What each source claims
    const claimAStatement = `${sourceAName} reports '${claimA.value}' (observed on ${claimA.observedAt.toISOString().split('T')[0]}).`;
    const claimBStatement = `${sourceBName} reports '${claimB.value}' (observed on ${claimB.observedAt.toISOString().split('T')[0]}).`;

    // 4. Why the values conflict
    let conflictDetail = '';
    if (comparison.normalizedA !== claimA.value || comparison.normalizedB !== claimB.value) {
      conflictDetail = `Normalized as '${comparison.normalizedA}' vs '${comparison.normalizedB}'.`;
    }

    let conflictReason: string;
    switch (classification.contradictionType) {
      case 'VERSION_MISMATCH':
        conflictReason = `The versions are mutually exclusive. ${conflictDetail}`.trim();
        break;
      case 'DATE_MISMATCH':
        conflictReason =
          `The dates represent conflicting milestones or deadlines. ${conflictDetail}`.trim();
        break;
      case 'QUANTITY_MISMATCH':
        conflictReason =
          `The specified numeric quantities or limits do not match. ${conflictDetail}`.trim();
        break;
      case 'STATUS_MISMATCH':
        conflictReason =
          `The reported lifecycle or operational statuses conflict. ${conflictDetail}`.trim();
        break;
      case 'POLICY_MISMATCH':
        conflictReason =
          `The stated rules or access policies are contradictory. ${conflictDetail}`.trim();
        break;
      case 'EXISTENCE_MISMATCH':
        conflictReason = `One statement asserts presence while the other indicates omission or non-existence.`;
        break;
      default:
        conflictReason =
          `The reported values are incompatible and cannot both hold simultaneously. ${conflictDetail}`.trim();
        break;
    }

    // 5. Classification & severity summary
    const summary = `Classified as ${classification.contradictionType} with ${classification.severity} severity.`;

    return `${factStatement}${contextStatement} However, ${claimAStatement} Meanwhile, ${claimBStatement} ${conflictReason} ${summary}`;
  }

  public buildNonContradictionReason(options: {
    match: ClaimMatchResult;
    comparison: ValueComparisonResult;
    claimA: Claim;
    claimB: Claim;
    contextRelationship?: { type: string; explanation: string };
  }): string {
    const { match, comparison, claimA, claimB, contextRelationship } = options;

    if (
      contextRelationship &&
      contextRelationship.type !== 'SAME_FACT' &&
      contextRelationship.type !== 'INCOMPATIBLE_FACT'
    ) {
      return `No contradiction detected (${contextRelationship.type}): ${contextRelationship.explanation}`;
    }

    if (!match.matches) {
      return `No contradiction detected: Claims refer to distinct subjects or predicates (${match.reason}).`;
    }

    if (comparison.equal) {
      return `No contradiction detected: Both claims specify equivalent values for '${claimA.subject}' ('${comparison.normalizedA}').`;
    }

    if (comparison.compatible) {
      return `No contradiction detected (COMPATIBLE_FACT): Values '${claimA.value}' and '${claimB.value}' are compatible (e.g. version range satisfied or overlapping constraints).`;
    }

    if (!comparison.comparable) {
      return `Inconclusive comparison: Values '${claimA.value}' and '${claimB.value}' cannot be reliably compared under valueType '${claimA.valueType}'.`;
    }

    return `No contradiction detected.`;
  }
}

export const explanationBuilder = new ExplanationBuilder();
