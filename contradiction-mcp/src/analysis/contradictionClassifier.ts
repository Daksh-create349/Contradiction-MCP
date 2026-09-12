import { ContradictionSeverity, ContradictionType } from '../domain/entities/contradiction.js';
import { ValueComparisonResult } from './valueComparator.js';

export interface ClassificationResult {
  contradictionType: ContradictionType;
  severity: ContradictionSeverity;
  categoryReason: string;
}

export class ContradictionClassifier {
  public classify(options: {
    predicate: string;
    valueType: string;
    comparison: ValueComparisonResult;
  }): ClassificationResult {
    const { predicate, valueType, comparison } = options;
    const pred = predicate.toLowerCase().trim();
    const type = valueType.toLowerCase().trim();

    // 1. Determine Contradiction Type
    let contradictionType: ContradictionType = 'VALUE_MISMATCH';
    let categoryReason = 'Values represent distinct or incompatible data';

    if (type === 'version' || pred.includes('version') || pred.includes('release')) {
      contradictionType = 'VERSION_MISMATCH';
      categoryReason =
        'Claims specify different version specifications for the same dependency or component';
    } else if (
      type === 'date' ||
      pred.includes('date') ||
      pred.includes('deadline') ||
      pred.includes('expires')
    ) {
      contradictionType = 'DATE_MISMATCH';
      categoryReason = 'Claims report conflicting temporal milestones or dates';
    } else if (
      type === 'status' ||
      pred.includes('status') ||
      pred.includes('state') ||
      pred.includes('phase') ||
      pred.includes('condition')
    ) {
      contradictionType = 'STATUS_MISMATCH';
      categoryReason = 'Claims assert contradictory lifecycle, operational, or execution statuses';
    } else if (
      type === 'quantity' ||
      type === 'number' ||
      pred.includes('count') ||
      pred.includes('quantity') ||
      pred.includes('limit') ||
      pred.includes('capacity') ||
      pred.includes('quota')
    ) {
      contradictionType = 'QUANTITY_MISMATCH';
      categoryReason = 'Claims state differing numeric quantities, counts, or capacity thresholds';
    } else if (
      type === 'policy' ||
      pred.includes('policy') ||
      pred.includes('rule') ||
      pred.includes('permission') ||
      pred.includes('access') ||
      pred.includes('auth') ||
      pred.includes('security')
    ) {
      contradictionType = 'POLICY_MISMATCH';
      categoryReason = 'Claims define mutually incompatible policies, security controls, or rules';
    } else if (
      pred.includes('exists') ||
      pred.includes('deleted') ||
      pred.includes('presence') ||
      pred.includes('available') ||
      comparison.differenceType === 'EMPTY_VS_NONEMPTY'
    ) {
      contradictionType = 'EXISTENCE_MISMATCH';
      categoryReason =
        'One claim asserts the presence or existence of an entity while the other negates or omits it';
    } else if (
      type === 'configuration' ||
      pred.includes('config') ||
      pred.includes('setting') ||
      pred.includes('parameter') ||
      pred.includes('port') ||
      pred.includes('host')
    ) {
      contradictionType = 'CONFIGURATION_MISMATCH';
      categoryReason = 'Claims assert contradictory configuration parameters or runtime settings';
    } else if (
      type === 'requirement' ||
      pred.includes('require') ||
      pred.includes('need') ||
      pred.includes('prerequisite')
    ) {
      contradictionType = 'REQUIREMENT_MISMATCH';
      categoryReason =
        'Claims specify mutually incompatible operational prerequisites or requirements';
    } else if (pred.includes('duration') || pred.includes('interval') || pred.includes('period')) {
      contradictionType = 'TEMPORAL_MISMATCH';
      categoryReason = 'Claims assert inconsistent temporal intervals or durations';
    } else if (
      pred.includes('owner') ||
      pred.includes('assignee') ||
      pred.includes('author') ||
      pred.includes('lead') ||
      pred.includes('entity')
    ) {
      contradictionType = 'ENTITY_MISMATCH';
      categoryReason =
        'Claims associate different entities, identities, or owners with the same role';
    }

    // 2. Determine Severity
    const severity = this.determineSeverity({
      contradictionType,
      predicate: pred,
      valueType: type,
      comparison,
    });

    return {
      contradictionType,
      severity,
      categoryReason,
    };
  }

  private determineSeverity(options: {
    contradictionType: ContradictionType;
    predicate: string;
    valueType: string;
    comparison: ValueComparisonResult;
  }): ContradictionSeverity {
    const { contradictionType, predicate, valueType, comparison } = options;

    // CRITICAL cases: security, authorization, destructive configs
    if (
      contradictionType === 'POLICY_MISMATCH' ||
      predicate.includes('security') ||
      predicate.includes('auth') ||
      predicate.includes('permission')
    ) {
      return 'CRITICAL';
    }

    // HIGH cases: environment conflicts (production vs development/staging), financial/price differences, major version differences
    if (
      predicate.includes('environment') ||
      predicate.includes('env') ||
      (comparison.normalizedA === 'production' && comparison.normalizedB !== 'production') ||
      (comparison.normalizedB === 'production' && comparison.normalizedA !== 'production')
    ) {
      return 'HIGH';
    }

    if (
      valueType === 'price' ||
      predicate.includes('price') ||
      predicate.includes('amount') ||
      predicate.includes('cost')
    ) {
      return 'HIGH';
    }

    if (comparison.differenceType === 'MAJOR_VERSION_MISMATCH') {
      return 'HIGH';
    }

    // MEDIUM cases: standard version, dates, quantities
    if (
      contradictionType === 'VERSION_MISMATCH' ||
      contradictionType === 'DATE_MISMATCH' ||
      contradictionType === 'STATUS_MISMATCH' ||
      contradictionType === 'QUANTITY_MISMATCH'
    ) {
      return 'MEDIUM';
    }

    // LOW cases: minor string variation or weak difference
    if (comparison.differenceStrength < 0.6) {
      return 'LOW';
    }

    return 'MEDIUM';
  }
}

export const contradictionClassifier = new ContradictionClassifier();
