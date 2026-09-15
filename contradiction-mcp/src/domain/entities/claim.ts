import { z } from 'zod';
import type { Metadata } from '../types/common.js';

export const StandardClaimValueTypes = [
  'date',
  'price',
  'version',
  'name',
  'quantity',
  'status',
  'address',
  'policy',
  'configuration',
  'requirement',
] as const;

export type StandardClaimValueType = (typeof StandardClaimValueTypes)[number];
export type ClaimValueType = StandardClaimValueType | (string & {});

export const StandardClaimEnvironments = [
  'development',
  'testing',
  'staging',
  'production',
  'ci',
  'documentation',
  'deployment',
  'unknown',
] as const;
export type ClaimEnvironment = (typeof StandardClaimEnvironments)[number] | (string & {});

export const StandardClaimScopes = [
  'repository',
  'file',
  'workflow',
  'environment',
  'package',
  'service',
  'deployment',
  'unknown',
] as const;
export type ClaimScope = (typeof StandardClaimScopes)[number] | (string & {});

export const StandardClaimSourceRoles = [
  'authoritative',
  'deployment',
  'configuration',
  'specification',
  'documentation',
  'example',
  'historical',
  'generated',
  'unknown',
] as const;
export type ClaimSourceRole = (typeof StandardClaimSourceRoles)[number] | (string & {});

export interface Claim {
  id: string;
  externalId?: string | null;
  sourceId: string;
  subject: string;
  predicate: string;
  value: string;
  valueType: ClaimValueType;
  normalizedValue?: string | null;
  confidence: number;
  environment?: ClaimEnvironment | null;
  scope?: ClaimScope | null;
  sourceRole?: ClaimSourceRole | null;
  isHistorical: boolean;
  validFrom?: Date | null;
  validUntil?: Date | null;
  valueConstraint?: string | null;
  multiValueContext?: string | null;
  observedAt: Date;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  supersededBy?: string | null;
  createdAt: Date;
  metadata: Metadata;
}

export interface ClaimHistoryEntry {
  id: string;
  claimId: string;
  sourceId: string;
  value: string;
  normalizedValue?: string | null;
  observedAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  supersededAt?: Date | null;
  supersededBy?: string | null;
  metadata: Metadata;
}

export const ClaimSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().nullable().optional(),
  sourceId: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  value: z.string(),
  valueType: z.string().min(1),
  normalizedValue: z.string().nullable().optional(),
  confidence: z.number().min(0.0).max(1.0).default(1.0),
  environment: z.string().nullable().optional().default('unknown'),
  scope: z.string().nullable().optional().default('unknown'),
  sourceRole: z.string().nullable().optional().default('unknown'),
  isHistorical: z.boolean().default(false),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  valueConstraint: z.string().nullable().optional(),
  multiValueContext: z.string().nullable().optional(),
  observedAt: z.coerce.date(),
  firstSeenAt: z.coerce.date().nullable().optional(),
  lastSeenAt: z.coerce.date().nullable().optional(),
  supersededBy: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const CreateClaimInputSchema = z.object({
  id: z.string().min(1).optional(),
  externalId: z.string().nullable().optional(),
  sourceId: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  value: z.string(),
  valueType: z.string().min(1),
  normalizedValue: z.string().nullable().optional(),
  confidence: z.number().min(0.0).max(1.0).default(1.0).optional(),
  environment: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  sourceRole: z.string().nullable().optional(),
  isHistorical: z.boolean().default(false).optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  valueConstraint: z.string().nullable().optional(),
  multiValueContext: z.string().nullable().optional(),
  observedAt: z.coerce.date().optional(),
  firstSeenAt: z.coerce.date().nullable().optional(),
  lastSeenAt: z.coerce.date().nullable().optional(),
  supersededBy: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}).optional(),
});

export type CreateClaimInput = z.infer<typeof CreateClaimInputSchema>;
