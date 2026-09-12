import type { SourceType } from '../../domain/entities/source.js';
import type { FetchResult, ExtractedClaim } from './fetchResult.js';

export interface ConnectorCapabilities {
  supportsIncrementalSync: boolean;
  supportsFileInspection: boolean;
  supportedFileTypes: string[];
}

export interface ConnectorMetadata {
  type: SourceType;
  displayName: string;
  description: string;
  authRequirement: 'none' | 'optional' | 'required';
  enabled: boolean;
  capabilities: ConnectorCapabilities;
}

export interface ConnectionTestResult {
  accessible: boolean;
  authenticated: boolean;
  targetFound: boolean;
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt: Date;
  };
  details?: Record<string, unknown>;
  error?: string;
}

export interface Connector<TInput = unknown, TRaw = unknown> {
  readonly type: SourceType;
  readonly metadata: ConnectorMetadata;
  testConnection(input?: TInput): Promise<ConnectionTestResult>;
  fetch(input: TInput): Promise<FetchResult<TRaw>>;
  extractClaims(fetchResult: FetchResult<TRaw>): Promise<ExtractedClaim[]>;
}
