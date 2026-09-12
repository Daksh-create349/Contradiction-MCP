import type {
  ClaimEnvironment,
  ClaimScope,
  ClaimSourceRole,
  ClaimValueType,
} from '../../domain/entities/claim.js';

export interface ClaimProvenance {
  connector: string;
  repository?: string;
  filePath: string;
  url?: string;
  extractionMethod: string;
  lineRange?: [number, number];
  page?: number;
  observedAt: string;
  evidence: string;
}

export interface ExtractedClaim {
  subject: string;
  predicate: string;
  value: string;
  valueType: ClaimValueType;
  normalizedValue?: string | null;
  confidence?: number;
  environment?: ClaimEnvironment | null;
  scope?: ClaimScope | null;
  sourceRole?: ClaimSourceRole | null;
  isHistorical?: boolean;
  validFrom?: Date | null;
  validUntil?: Date | null;
  valueConstraint?: string | null;
  multiValueContext?: string | null;
  observedAt?: Date;
  externalId: string;
  provenance: ClaimProvenance;
}

export interface FetchResult<T = unknown> {
  sourceIdentifier: string;
  sourceName: string;
  sourceUri: string;
  fetchedAt: Date;
  rawData: T;
  metadata: Record<string, unknown>;
}
