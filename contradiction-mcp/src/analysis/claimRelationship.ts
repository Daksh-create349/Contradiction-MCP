export const ClaimRelationshipTypes = [
  'SAME_FACT',
  'COMPATIBLE_FACT',
  'DIFFERENT_SCOPE',
  'DIFFERENT_ENVIRONMENT',
  'HISTORICAL',
  'EXAMPLE',
  'SET_MEMBERSHIP',
  'INCOMPATIBLE_FACT',
  'UNKNOWN',
] as const;

export type ClaimRelationshipType = (typeof ClaimRelationshipTypes)[number];

export interface ClaimRelationship {
  type: ClaimRelationshipType;
  confidence: number;
  explanation: string;
  isContradictionEligible: boolean;
  contextFactors: {
    environmentMatch: boolean;
    scopeMatch: boolean;
    roleMatch: boolean;
    temporalMatch: boolean;
    setMembershipMatch: boolean;
  };
}
