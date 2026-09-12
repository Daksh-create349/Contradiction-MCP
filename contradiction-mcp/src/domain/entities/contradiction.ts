import { z } from 'zod';
import type { Metadata } from '../types/common.js';

export const ContradictionTypes = [
  'VALUE_MISMATCH',
  'DATE_MISMATCH',
  'VERSION_MISMATCH',
  'STATUS_MISMATCH',
  'QUANTITY_MISMATCH',
  'POLICY_MISMATCH',
  'ENTITY_MISMATCH',
  'EXISTENCE_MISMATCH',
  'CONFIGURATION_MISMATCH',
  'REQUIREMENT_MISMATCH',
  'TEMPORAL_MISMATCH',
  'AUTHORITY_MISMATCH',
  'UNKNOWN',
] as const;

export type ContradictionType = (typeof ContradictionTypes)[number] | (string & {});

export const ContradictionSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type ContradictionSeverity = (typeof ContradictionSeverities)[number];

export const ContradictionStatuses = ['OPEN', 'REVIEWED', 'RESOLVED', 'DISMISSED'] as const;
export type ContradictionStatus = (typeof ContradictionStatuses)[number];

export interface Contradiction {
  id: string;
  claimAId: string;
  claimBId: string;
  contradictionType: ContradictionType;
  severity: ContradictionSeverity;
  confidence: number;
  explanation: string;
  status: ContradictionStatus;
  detectedAt: Date;
  resolvedAt?: Date | null;
  resolutionReason?: string | null;
  resolvedBy?: string | null;
  resolutionSource?: string | null;
  chosenClaimId?: string | null;
  auditNotes?: string | null;
  metadata: Metadata;
}

export interface ContradictionHistoryEntry {
  id: string;
  contradictionId: string;
  action: 'REVIEWED' | 'RESOLVED' | 'DISMISSED' | 'REOPENED';
  previousStatus: ContradictionStatus;
  newStatus: ContradictionStatus;
  performedBy: string;
  performedAt: Date;
  reason?: string | null;
  chosenClaimId?: string | null;
  notes?: string | null;
}

export const ContradictionSchema = z
  .object({
    id: z.string().min(1),
    claimAId: z.string().min(1),
    claimBId: z.string().min(1),
    contradictionType: z.string().min(1),
    severity: z.enum(ContradictionSeverities),
    confidence: z.number().min(0.0).max(1.0).default(1.0),
    explanation: z.string().min(1),
    status: z.enum(ContradictionStatuses).default('OPEN'),
    detectedAt: z.coerce.date(),
    resolvedAt: z.coerce.date().nullable().optional(),
    resolutionReason: z.string().nullable().optional(),
    resolvedBy: z.string().nullable().optional(),
    resolutionSource: z.string().nullable().optional(),
    chosenClaimId: z.string().nullable().optional(),
    auditNotes: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((data) => data.claimAId !== data.claimBId, {
    message: 'claimAId and claimBId must be distinct claims',
    path: ['claimBId'],
  });

export const CreateContradictionInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    claimAId: z.string().min(1),
    claimBId: z.string().min(1),
    contradictionType: z.string().min(1),
    severity: z.enum(ContradictionSeverities).default('MEDIUM'),
    confidence: z.number().min(0.0).max(1.0).default(1.0).optional(),
    explanation: z.string().min(1),
    status: z.enum(ContradictionStatuses).default('OPEN').optional(),
    detectedAt: z.coerce.date().optional(),
    resolvedAt: z.coerce.date().nullable().optional(),
    resolutionReason: z.string().nullable().optional(),
    resolvedBy: z.string().nullable().optional(),
    resolutionSource: z.string().nullable().optional(),
    chosenClaimId: z.string().nullable().optional(),
    auditNotes: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}).optional(),
  })
  .refine((data) => data.claimAId !== data.claimBId, {
    message: 'claimAId and claimBId must be distinct claims',
    path: ['claimBId'],
  });

export type CreateContradictionInput = z.infer<typeof CreateContradictionInputSchema>;

export const UpdateContradictionStatusSchema = z.object({
  status: z.enum(ContradictionStatuses),
  resolvedAt: z.coerce.date().nullable().optional(),
  resolutionReason: z.string().nullable().optional(),
  resolvedBy: z.string().nullable().optional(),
  resolutionSource: z.string().nullable().optional(),
  chosenClaimId: z.string().nullable().optional(),
  auditNotes: z.string().nullable().optional(),
});

export type UpdateContradictionStatusInput = z.infer<typeof UpdateContradictionStatusSchema>;
