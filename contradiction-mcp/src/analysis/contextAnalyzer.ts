import { Claim } from '../domain/entities/claim.js';
import { ClaimRelationship } from './claimRelationship.js';

export interface ContextAnalysisResult {
  relationship: ClaimRelationship;
  isContextCompatible: boolean;
  compatibilityScore: number; // 1.0 = identical contexts, 0.0 = completely disjoint
  reason: string;
  divergenceDimensions: string[];
}

export function normalizeEnvironment(env?: string | null): string {
  if (!env) return 'unknown';
  const clean = env.toLowerCase().trim();
  if (['prod', 'production', 'live', 'prd'].includes(clean)) return 'production';
  if (['dev', 'development', 'local'].includes(clean)) return 'development';
  if (['stage', 'staging', 'stg'].includes(clean)) return 'staging';
  if (['test', 'testing', 'qa', 'uat', 'ci'].includes(clean)) return 'testing';
  if (['doc', 'docs', 'documentation'].includes(clean)) return 'documentation';
  if (['deploy', 'deployment'].includes(clean)) return 'deployment';
  return clean || 'unknown';
}

export class ContextAnalyzer {
  public analyze(claimA: Claim, claimB: Claim): ContextAnalysisResult {
    const divergences: string[] = [];

    // 1. Check Set Membership (e.g., CI matrix items)
    const mvcA = claimA.multiValueContext;
    const mvcB = claimB.multiValueContext;
    const isSetMembership =
      Boolean(mvcA && mvcB) &&
      mvcA === mvcB &&
      (mvcA === 'ci_matrix' || (mvcA ? mvcA.includes('matrix') || mvcA.includes('set') : false));

    if (isSetMembership && mvcA) {
      return {
        relationship: {
          type: 'SET_MEMBERSHIP',
          confidence: 0.95,
          explanation: `Both claims are members of the same multi-value context (${claimA.multiValueContext}), representing parallel configurations or matrix dimensions rather than conflicting assertions.`,
          isContradictionEligible: false,
          contextFactors: {
            environmentMatch: claimA.environment === claimB.environment,
            scopeMatch: claimA.scope === claimB.scope,
            roleMatch: claimA.sourceRole === claimB.sourceRole,
            temporalMatch: true,
            setMembershipMatch: true,
          },
        },
        isContextCompatible: true,
        compatibilityScore: 1.0,
        reason: 'Claims belong to a valid multi-value set/matrix.',
        divergenceDimensions: [],
      };
    }

    // 2. Check Historical / Temporal Disjointness
    const isTemporalDisjoint =
      claimA.isHistorical ||
      claimB.isHistorical ||
      claimA.sourceRole === 'historical' ||
      claimB.sourceRole === 'historical' ||
      (claimA.validUntil && claimB.validFrom && claimA.validUntil <= claimB.validFrom) ||
      (claimB.validUntil && claimA.validFrom && claimB.validUntil <= claimA.validFrom);

    if (isTemporalDisjoint) {
      divergences.push('temporal');
      const historicalClaim =
        claimA.isHistorical || claimA.sourceRole === 'historical' ? 'Claim A' : 'Claim B';
      return {
        relationship: {
          type: 'HISTORICAL',
          confidence: 0.9,
          explanation: `${historicalClaim} describes a historical, previous, or non-overlapping time state. Historical states do not contradict active or subsequent specifications.`,
          isContradictionEligible: false,
          contextFactors: {
            environmentMatch: claimA.environment === claimB.environment,
            scopeMatch: claimA.scope === claimB.scope,
            roleMatch: claimA.sourceRole === claimB.sourceRole,
            temporalMatch: false,
            setMembershipMatch: false,
          },
        },
        isContextCompatible: false,
        compatibilityScore: 0.2,
        reason: 'One or both claims are historical or temporally disjoint.',
        divergenceDimensions: divergences,
      };
    }

    // 3. Check Examples / Illustrative Samples
    const isExample =
      claimA.sourceRole === 'example' ||
      claimB.sourceRole === 'example' ||
      (claimA.metadata &&
        (claimA.metadata.isExample === true ||
          /\b(?:for\s+example|as\s+an\s+example|e\.g\.|sample|tutorial|quickstart)\b|^\s*[-*#]*\s*example\b/i.test(
            String(claimA.metadata.evidence || ''),
          ))) ||
      (claimB.metadata &&
        (claimB.metadata.isExample === true ||
          /\b(?:for\s+example|as\s+an\s+example|e\.g\.|sample|tutorial|quickstart)\b|^\s*[-*#]*\s*example\b/i.test(
            String(claimB.metadata.evidence || ''),
          )));

    if (isExample) {
      divergences.push('sourceRole');
      return {
        relationship: {
          type: 'EXAMPLE',
          confidence: 0.85,
          explanation:
            'At least one claim originates from an illustrative tutorial, sample snippet, or example command rather than a normative production specification.',
          isContradictionEligible: false,
          contextFactors: {
            environmentMatch: claimA.environment === claimB.environment,
            scopeMatch: claimA.scope === claimB.scope,
            roleMatch: false,
            temporalMatch: true,
            setMembershipMatch: false,
          },
        },
        isContextCompatible: false,
        compatibilityScore: 0.3,
        reason: 'Illustrative examples do not contradict canonical configuration.',
        divergenceDimensions: divergences,
      };
    }

    // 4. Check Environment Divergence (e.g. dev vs prod, staging vs prod)
    const envA = normalizeEnvironment(claimA.environment);
    const envB = normalizeEnvironment(claimB.environment);

    const isProdOrDeploy = (e: string) => e === 'production' || e === 'deployment';
    const concreteRuntimeEnvs = [
      'development',
      'staging',
      'testing',
      'production',
      'deployment',
      'ci',
    ];
    const isEnvDisjoint =
      envA !== envB &&
      !(isProdOrDeploy(envA) && isProdOrDeploy(envB)) &&
      concreteRuntimeEnvs.includes(envA) &&
      concreteRuntimeEnvs.includes(envB);

    if (isEnvDisjoint) {
      divergences.push('environment');
      return {
        relationship: {
          type: 'DIFFERENT_ENVIRONMENT',
          confidence: 0.9,
          explanation: `Claims apply to distinct non-overlapping environments ('${envA}' vs '${envB}'). Distinct environments legitimately maintain different parameter values.`,
          isContradictionEligible: false,
          contextFactors: {
            environmentMatch: false,
            scopeMatch: claimA.scope === claimB.scope,
            roleMatch: claimA.sourceRole === claimB.sourceRole,
            temporalMatch: true,
            setMembershipMatch: false,
          },
        },
        isContextCompatible: false,
        compatibilityScore: 0.2,
        reason: `Environment '${envA}' is explicitly separate from '${envB}'.`,
        divergenceDimensions: divergences,
      };
    }

    // 5. Check Scope Divergence
    const scopeA = (claimA.scope || 'unknown').toLowerCase();
    const scopeB = (claimB.scope || 'unknown').toLowerCase();

    // Isolated service vs repository scopes legitimately diverge
    if (
      scopeA !== 'unknown' &&
      scopeB !== 'unknown' &&
      scopeA !== scopeB &&
      ((scopeA === 'service' && scopeB === 'repository') ||
        (scopeA === 'repository' && scopeB === 'service'))
    ) {
      divergences.push('scope');
      return {
        relationship: {
          type: 'DIFFERENT_SCOPE',
          confidence: 0.8,
          explanation: `Claims operate at distinct architectural scopes (${scopeA} vs ${scopeB}).`,
          isContradictionEligible: false,
          contextFactors: {
            environmentMatch: envA === envB,
            scopeMatch: false,
            roleMatch: claimA.sourceRole === claimB.sourceRole,
            temporalMatch: true,
            setMembershipMatch: false,
          },
        },
        isContextCompatible: false,
        compatibilityScore: 0.4,
        reason: `Scopes '${scopeA}' and '${scopeB}' represent distinct structural layers.`,
        divergenceDimensions: divergences,
      };
    }

    // 6. Contexts are compatible / comparable
    const envMatch =
      envA === envB ||
      envA === 'unknown' ||
      envB === 'unknown' ||
      envA === 'documentation' ||
      envB === 'documentation';
    const scopeMatch = scopeA === scopeB || scopeA === 'unknown' || scopeB === 'unknown';
    const roleMatch =
      claimA.sourceRole === claimB.sourceRole ||
      claimA.sourceRole === 'unknown' ||
      claimB.sourceRole === 'unknown';

    return {
      relationship: {
        type: 'SAME_FACT',
        confidence: 0.9,
        explanation:
          'Both claims share compatible operational environments, scopes, and source roles.',
        isContradictionEligible: true,
        contextFactors: {
          environmentMatch: envMatch,
          scopeMatch,
          roleMatch,
          temporalMatch: true,
          setMembershipMatch: false,
        },
      },
      isContextCompatible: true,
      compatibilityScore: 0.95,
      reason: 'Claims share compatible operational context.',
      divergenceDimensions: [],
    };
  }
}

export const contextAnalyzer = new ContextAnalyzer();
