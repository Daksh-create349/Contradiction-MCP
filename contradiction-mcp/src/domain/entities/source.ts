import { z } from 'zod';
import type { Metadata } from '../types/common.js';

export const StandardSourceTypes = [
  'github',
  'document',
  'email',
  'calendar',
  'spreadsheet',
  'database',
  'website',
  'crm',
  'manual',
] as const;

export type StandardSourceType = (typeof StandardSourceTypes)[number];
export type SourceType = StandardSourceType | (string & {});

export interface Source {
  id: string;
  externalId?: string | null;
  type: SourceType;
  name: string;
  uri?: string | null;
  lastFetchedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  trustScore: number;
  metadata: Metadata;
}

export const SourceSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().nullable().optional(),
  type: z.string().min(1),
  name: z.string().min(1),
  uri: z.string().nullable().optional(),
  lastFetchedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  trustScore: z.number().min(0.0).max(1.0).default(1.0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const CreateSourceInputSchema = z.object({
  id: z.string().min(1).optional(),
  externalId: z.string().nullable().optional(),
  type: z.string().min(1),
  name: z.string().min(1),
  uri: z.string().nullable().optional(),
  lastFetchedAt: z.coerce.date().nullable().optional(),
  trustScore: z.number().min(0.0).max(1.0).default(1.0).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}).optional(),
});

export type CreateSourceInput = z.infer<typeof CreateSourceInputSchema>;
export type UpdateSourceInput = Partial<
  Omit<CreateSourceInput, 'id'> & {
    lastFetchedAt?: Date | null;
  }
>;
