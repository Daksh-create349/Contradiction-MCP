import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { DatabaseError, NotFoundError, ValidationError } from '../domain/types/common.js';
import {
  Source,
  SourceSchema,
  CreateSourceInput,
  CreateSourceInputSchema,
  UpdateSourceInput,
} from '../domain/entities/source.js';
import {
  Claim,
  ClaimSchema,
  ClaimHistoryEntry,
  CreateClaimInput,
  CreateClaimInputSchema,
} from '../domain/entities/claim.js';
import {
  Contradiction,
  ContradictionSchema,
  ContradictionHistoryEntry,
  CreateContradictionInput,
  CreateContradictionInputSchema,
  ContradictionStatus,
  ContradictionSeverity,
} from '../domain/entities/contradiction.js';
import { logger } from '../utils/logger.js';

export interface ListContradictionsOptions {
  status?: ContradictionStatus;
  severity?: ContradictionSeverity;
  type?: string;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

export interface DatabaseHealth {
  status: 'connected' | 'unreachable';
  latencyMs: number;
  tablesCount: number;
  error?: string;
}

export class DatabaseManager {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
  }

  public initialize(): void {
    if (this.db && this.db.open) {
      return;
    }

    try {
      if (this.dbPath !== ':memory:') {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      this.db = new Database(this.dbPath);
      // Enforce foreign key constraints
      this.db.pragma('foreign_keys = ON');
      // Set WAL mode for persistent files for concurrency and speed
      if (this.dbPath !== ':memory:') {
        this.db.pragma('journal_mode = WAL');
      }

      this.runMigrations();
      logger.info('Database initialized successfully', { path: this.dbPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to initialize database', { path: this.dbPath, error: message });
      throw new DatabaseError(`Failed to initialize database at ${this.dbPath}: ${message}`, error);
    }
  }

  public getRawDb(): Database.Database {
    if (!this.db || !this.db.open) {
      throw new DatabaseError('Database connection is not open');
    }
    return this.db;
  }

  public runMigrations(): void {
    const rawDb = this.getRawDb();

    // Locate migrations directory relative to current file or src/storage/migrations
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const candidateDirs = [
      path.resolve(__dirname, 'migrations'),
      path.resolve(__dirname, '..', 'src', 'storage', 'migrations'),
      path.resolve(process.cwd(), 'src', 'storage', 'migrations'),
      path.resolve(process.cwd(), 'contradiction-mcp', 'src', 'storage', 'migrations'),
    ];

    let migrationsDir: string | null = null;
    for (const dir of candidateDirs) {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        migrationsDir = dir;
        break;
      }
    }

    if (migrationsDir) {
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);

      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const row = rawDb.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(file);

        if (!row) {
          const filePath = path.join(migrationsDir, file);
          const sql = fs.readFileSync(filePath, 'utf-8');

          try {
            rawDb.exec(sql);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('duplicate column name')) {
              throw err;
            }
          }

          rawDb
            .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, datetime('now'))")
            .run(file);
        }
      }
      return;
    }

    // Fallback DDL in case migration files are not found on disk
    const fallbackSql = `
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY,
          external_id TEXT,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          uri TEXT,
          last_fetched_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          trust_score REAL NOT NULL DEFAULT 1.0 CHECK (trust_score >= 0.0 AND trust_score <= 1.0),
          metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type);
      CREATE INDEX IF NOT EXISTS idx_sources_created_at ON sources(created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_external_id ON sources(external_id);

      CREATE TABLE IF NOT EXISTS claims (
          id TEXT PRIMARY KEY,
          external_id TEXT,
          source_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          value TEXT NOT NULL,
          value_type TEXT NOT NULL,
          normalized_value TEXT,
          confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
          environment TEXT DEFAULT 'unknown',
          scope TEXT DEFAULT 'unknown',
          source_role TEXT DEFAULT 'unknown',
          is_historical INTEGER NOT NULL DEFAULT 0,
          valid_from TEXT,
          valid_until TEXT,
          value_constraint TEXT,
          multi_value_context TEXT,
          first_seen_at TEXT,
          last_seen_at TEXT,
          superseded_by TEXT,
          observed_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_claims_source_id ON claims(source_id);
      CREATE INDEX IF NOT EXISTS idx_claims_subject_predicate ON claims(subject, predicate);
      CREATE INDEX IF NOT EXISTS idx_claims_value_type ON claims(value_type);
      CREATE INDEX IF NOT EXISTS idx_claims_created_at ON claims(created_at);
      CREATE INDEX IF NOT EXISTS idx_claims_context ON claims(environment, scope, source_role);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_external_id ON claims(external_id);

      CREATE TABLE IF NOT EXISTS claim_history (
          id TEXT PRIMARY KEY,
          claim_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          value TEXT NOT NULL,
          normalized_value TEXT,
          observed_at TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          superseded_at TEXT,
          superseded_by TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_claim_history_claim_id ON claim_history(claim_id);
      CREATE INDEX IF NOT EXISTS idx_claim_history_source_id ON claim_history(source_id);

      CREATE TABLE IF NOT EXISTS contradictions (
          id TEXT PRIMARY KEY,
          claim_a_id TEXT NOT NULL,
          claim_b_id TEXT NOT NULL,
          contradiction_type TEXT NOT NULL,
          severity TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
          explanation TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN',
          detected_at TEXT NOT NULL,
          resolved_at TEXT,
          resolution_reason TEXT,
          resolved_by TEXT,
          resolution_source TEXT,
          chosen_claim_id TEXT,
          audit_notes TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          CHECK (claim_a_id != claim_b_id),
          FOREIGN KEY (claim_a_id) REFERENCES claims(id) ON DELETE CASCADE,
          FOREIGN KEY (claim_b_id) REFERENCES claims(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_contradictions_claims ON contradictions(claim_a_id, claim_b_id);
      CREATE INDEX IF NOT EXISTS idx_contradictions_type ON contradictions(contradiction_type);
      CREATE INDEX IF NOT EXISTS idx_contradictions_severity ON contradictions(severity);
      CREATE INDEX IF NOT EXISTS idx_contradictions_status ON contradictions(status);
      CREATE INDEX IF NOT EXISTS idx_contradictions_detected_at ON contradictions(detected_at);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair_unique ON contradictions (
          CASE WHEN claim_a_id < claim_b_id THEN claim_a_id ELSE claim_b_id END,
          CASE WHEN claim_a_id < claim_b_id THEN claim_b_id ELSE claim_a_id END
      );
      CREATE INDEX IF NOT EXISTS idx_contradictions_confidence ON contradictions(confidence);

      CREATE TABLE IF NOT EXISTS contradiction_history (
          id TEXT PRIMARY KEY,
          contradiction_id TEXT NOT NULL,
          action TEXT NOT NULL,
          previous_status TEXT NOT NULL,
          new_status TEXT NOT NULL,
          performed_by TEXT NOT NULL,
          performed_at TEXT NOT NULL,
          reason TEXT,
          chosen_claim_id TEXT,
          notes TEXT,
          FOREIGN KEY (contradiction_id) REFERENCES contradictions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_contradiction_history_contradiction_id ON contradiction_history(contradiction_id);
    `;
    rawDb.exec(fallbackSql);
  }

  public checkHealth(): DatabaseHealth {
    const startTime = performance.now();
    try {
      if (!this.db || !this.db.open) {
        return {
          status: 'unreachable',
          latencyMs: 0,
          tablesCount: 0,
          error: 'Database is closed or not initialized',
        };
      }

      // Execute lightweight query
      const result = this.db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
      if (!result || result.ok !== 1) {
        throw new Error('Database ping query returned unexpected result');
      }

      const tables = this.db
        .prepare(
          "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'",
        )
        .get() as { count: number };

      const latencyMs = Number((performance.now() - startTime).toFixed(2));

      return {
        status: 'connected',
        latencyMs,
        tablesCount: tables?.count ?? 0,
      };
    } catch (error) {
      const latencyMs = Number((performance.now() - startTime).toFixed(2));
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'unreachable',
        latencyMs,
        tablesCount: 0,
        error: message,
      };
    }
  }

  public close(): void {
    if (this.db && this.db.open) {
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }

  // --- SOURCE REPOSITORY ---

  public createSource(input: CreateSourceInput): Source {
    const parsedInput = CreateSourceInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new ValidationError('Invalid source input data', parsedInput.error.format());
    }

    const rawDb = this.getRawDb();
    const now = new Date();
    const id = parsedInput.data.id || crypto.randomUUID();

    const entity: Source = {
      id,
      externalId: parsedInput.data.externalId ?? null,
      type: parsedInput.data.type,
      name: parsedInput.data.name,
      uri: parsedInput.data.uri ?? null,
      lastFetchedAt: parsedInput.data.lastFetchedAt ?? null,
      createdAt: now,
      updatedAt: now,
      trustScore: parsedInput.data.trustScore ?? 1.0,
      metadata: parsedInput.data.metadata ?? {},
    };

    try {
      const stmt = rawDb.prepare(`
        INSERT INTO sources (id, external_id, type, name, uri, last_fetched_at, created_at, updated_at, trust_score, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        entity.id,
        entity.externalId,
        entity.type,
        entity.name,
        entity.uri,
        entity.lastFetchedAt ? entity.lastFetchedAt.toISOString() : null,
        entity.createdAt.toISOString(),
        entity.updatedAt.toISOString(),
        entity.trustScore,
        JSON.stringify(entity.metadata),
      );

      return entity;
    } catch (error) {
      throw new DatabaseError(
        `Failed to create source: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  public getSourceById(id: string): Source | null {
    const rawDb = this.getRawDb();
    const row = rawDb.prepare('SELECT * FROM sources WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.mapRowToSource(row);
  }

  public getSourceByExternalId(externalId: string): Source | null {
    const rawDb = this.getRawDb();
    const row = rawDb.prepare('SELECT * FROM sources WHERE external_id = ?').get(externalId) as
      Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.mapRowToSource(row);
  }

  public upsertSource(input: CreateSourceInput): { source: Source; isNew: boolean } {
    if (input.externalId) {
      const existing = this.getSourceByExternalId(input.externalId);
      if (existing) {
        const updated = this.updateSource(existing.id, {
          name: input.name,
          uri: input.uri,
          lastFetchedAt: input.lastFetchedAt ?? new Date(),
          metadata: input.metadata,
        });
        return { source: updated, isNew: false };
      }
    }

    const created = this.createSource(input);
    return { source: created, isNew: true };
  }

  public listSources(options?: { type?: string; limit?: number }): Source[] {
    const rawDb = this.getRawDb();
    let query = 'SELECT * FROM sources';
    const params: unknown[] = [];

    if (options?.type) {
      query += ' WHERE type = ?';
      params.push(options.type);
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit && options.limit > 0) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = rawDb.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToSource(r));
  }

  public updateSource(id: string, input: UpdateSourceInput): Source {
    const existing = this.getSourceById(id);
    if (!existing) {
      throw new NotFoundError('Source', id);
    }

    const rawDb = this.getRawDb();
    const updatedAt = new Date();
    const updated: Source = {
      ...existing,
      ...input,
      updatedAt,
      metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata,
    };

    try {
      rawDb
        .prepare(
          `
          UPDATE sources
          SET type = ?, name = ?, uri = ?, last_fetched_at = ?, updated_at = ?, trust_score = ?, metadata = ?
          WHERE id = ?
        `,
        )
        .run(
          updated.type,
          updated.name,
          updated.uri,
          updated.lastFetchedAt ? updated.lastFetchedAt.toISOString() : null,
          updated.updatedAt.toISOString(),
          updated.trustScore,
          JSON.stringify(updated.metadata),
          id,
        );

      return updated;
    } catch (error) {
      throw new DatabaseError(
        `Failed to update source ${id}: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  public deleteSource(id: string): boolean {
    const rawDb = this.getRawDb();
    const result = rawDb.prepare('DELETE FROM sources WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- CLAIM REPOSITORY ---

  public createClaim(input: CreateClaimInput): Claim {
    const parsed = CreateClaimInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError('Invalid claim input data', parsed.error.format());
    }

    const rawDb = this.getRawDb();
    const now = new Date();
    const id = parsed.data.id || crypto.randomUUID();

    const entity: Claim = {
      id,
      externalId: parsed.data.externalId ?? null,
      sourceId: parsed.data.sourceId,
      subject: parsed.data.subject,
      predicate: parsed.data.predicate,
      value: parsed.data.value,
      valueType: parsed.data.valueType,
      normalizedValue: parsed.data.normalizedValue ?? null,
      confidence: parsed.data.confidence ?? 1.0,
      environment: parsed.data.environment ?? 'unknown',
      scope: parsed.data.scope ?? 'unknown',
      sourceRole: parsed.data.sourceRole ?? 'unknown',
      isHistorical: parsed.data.isHistorical ?? false,
      validFrom: parsed.data.validFrom ?? null,
      validUntil: parsed.data.validUntil ?? null,
      valueConstraint: parsed.data.valueConstraint ?? null,
      multiValueContext: parsed.data.multiValueContext ?? null,
      observedAt: parsed.data.observedAt ?? now,
      firstSeenAt: parsed.data.firstSeenAt ?? parsed.data.observedAt ?? now,
      lastSeenAt: parsed.data.lastSeenAt ?? parsed.data.observedAt ?? now,
      supersededBy: parsed.data.supersededBy ?? null,
      createdAt: now,
      metadata: parsed.data.metadata ?? {},
    };

    try {
      rawDb
        .prepare(
          `
          INSERT INTO claims (
            id, external_id, source_id, subject, predicate, value, value_type, normalized_value, confidence,
            environment, scope, source_role, is_historical, valid_from, valid_until, value_constraint, multi_value_context,
            first_seen_at, last_seen_at, superseded_by, observed_at, created_at, metadata
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          entity.id,
          entity.externalId,
          entity.sourceId,
          entity.subject,
          entity.predicate,
          entity.value,
          entity.valueType,
          entity.normalizedValue,
          entity.confidence,
          entity.environment,
          entity.scope,
          entity.sourceRole,
          entity.isHistorical ? 1 : 0,
          entity.validFrom ? entity.validFrom.toISOString() : null,
          entity.validUntil ? entity.validUntil.toISOString() : null,
          entity.valueConstraint,
          entity.multiValueContext,
          entity.firstSeenAt ? entity.firstSeenAt.toISOString() : null,
          entity.lastSeenAt ? entity.lastSeenAt.toISOString() : null,
          entity.supersededBy,
          entity.observedAt.toISOString(),
          entity.createdAt.toISOString(),
          JSON.stringify(entity.metadata),
        );

      return entity;
    } catch (error) {
      throw new DatabaseError(
        `Failed to create claim: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  public getClaimById(id: string): Claim | null {
    const rawDb = this.getRawDb();
    const row = rawDb.prepare('SELECT * FROM claims WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.mapRowToClaim(row);
  }

  public getClaimByExternalId(externalId: string): Claim | null {
    const rawDb = this.getRawDb();
    const row = rawDb.prepare('SELECT * FROM claims WHERE external_id = ?').get(externalId) as
      Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.mapRowToClaim(row);
  }

  public updateClaim(
    id: string,
    updates: Partial<{
      value: string;
      valueType: string;
      normalizedValue: string | null;
      confidence: number;
      environment: string | null;
      scope: string | null;
      sourceRole: string | null;
      isHistorical: boolean;
      validFrom: Date | null;
      validUntil: Date | null;
      valueConstraint: string | null;
      multiValueContext: string | null;
      observedAt: Date;
      firstSeenAt: Date | null;
      lastSeenAt: Date | null;
      supersededBy: string | null;
      metadata: Record<string, unknown>;
    }>,
  ): Claim {
    const existing = this.getClaimById(id);
    if (!existing) {
      throw new NotFoundError('Claim', id);
    }

    const rawDb = this.getRawDb();
    const updated: Claim = {
      ...existing,
      ...updates,
      metadata: updates.metadata
        ? { ...existing.metadata, ...updates.metadata }
        : existing.metadata,
    };

    try {
      rawDb
        .prepare(
          `
          UPDATE claims
          SET value = ?, value_type = ?, normalized_value = ?, confidence = ?,
              environment = ?, scope = ?, source_role = ?, is_historical = ?,
              valid_from = ?, valid_until = ?, value_constraint = ?, multi_value_context = ?,
              first_seen_at = ?, last_seen_at = ?, superseded_by = ?,
              observed_at = ?, metadata = ?
          WHERE id = ?
        `,
        )
        .run(
          updated.value,
          updated.valueType,
          updated.normalizedValue,
          updated.confidence,
          updated.environment ?? 'unknown',
          updated.scope ?? 'unknown',
          updated.sourceRole ?? 'unknown',
          updated.isHistorical ? 1 : 0,
          updated.validFrom ? updated.validFrom.toISOString() : null,
          updated.validUntil ? updated.validUntil.toISOString() : null,
          updated.valueConstraint,
          updated.multiValueContext,
          updated.firstSeenAt ? updated.firstSeenAt.toISOString() : null,
          updated.lastSeenAt ? updated.lastSeenAt.toISOString() : null,
          updated.supersededBy ?? null,
          updated.observedAt.toISOString(),
          JSON.stringify(updated.metadata),
          id,
        );

      return updated;
    } catch (error) {
      throw new DatabaseError(
        `Failed to update claim ${id}: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  public upsertClaim(input: CreateClaimInput): { claim: Claim; isNew: boolean; updated: boolean } {
    if (input.externalId) {
      const existing = this.getClaimByExternalId(input.externalId);
      if (existing) {
        const isValueChanged =
          existing.value !== input.value ||
          (input.normalizedValue !== undefined &&
            existing.normalizedValue !== input.normalizedValue);

        if (isValueChanged) {
          // Record historical state transition in claim_history
          this.recordClaimHistory(
            existing.id,
            existing.value,
            existing.normalizedValue ?? null,
            existing.sourceId,
            existing.observedAt,
            existing.firstSeenAt ?? existing.observedAt,
            new Date(),
            new Date(),
            null,
            existing.metadata,
          );

          const updatedClaim = this.updateClaim(existing.id, {
            value: input.value,
            valueType: input.valueType,
            normalizedValue: input.normalizedValue,
            confidence: input.confidence ?? existing.confidence,
            environment: input.environment ?? existing.environment,
            scope: input.scope ?? existing.scope,
            sourceRole: input.sourceRole ?? existing.sourceRole,
            isHistorical: input.isHistorical ?? existing.isHistorical,
            validFrom: input.validFrom !== undefined ? input.validFrom : existing.validFrom,
            validUntil: input.validUntil !== undefined ? input.validUntil : existing.validUntil,
            valueConstraint:
              input.valueConstraint !== undefined
                ? input.valueConstraint
                : existing.valueConstraint,
            multiValueContext:
              input.multiValueContext !== undefined
                ? input.multiValueContext
                : existing.multiValueContext,
            observedAt: input.observedAt ?? new Date(),
            metadata: {
              ...existing.metadata,
              ...input.metadata,
              history: [
                ...((existing.metadata.history as unknown[]) ?? []),
                {
                  previousValue: existing.value,
                  previousNormalizedValue: existing.normalizedValue,
                  changedAt: new Date().toISOString(),
                },
              ],
            },
          });
          return { claim: updatedClaim, isNew: false, updated: true };
        } else {
          const refreshedClaim = this.updateClaim(existing.id, {
            observedAt: input.observedAt ?? new Date(),
            environment: input.environment ?? existing.environment,
            scope: input.scope ?? existing.scope,
            sourceRole: input.sourceRole ?? existing.sourceRole,
            isHistorical: input.isHistorical ?? existing.isHistorical,
            validFrom: input.validFrom !== undefined ? input.validFrom : existing.validFrom,
            validUntil: input.validUntil !== undefined ? input.validUntil : existing.validUntil,
            valueConstraint:
              input.valueConstraint !== undefined
                ? input.valueConstraint
                : existing.valueConstraint,
            multiValueContext:
              input.multiValueContext !== undefined
                ? input.multiValueContext
                : existing.multiValueContext,
            metadata: {
              ...existing.metadata,
              ...input.metadata,
            },
          });
          return { claim: refreshedClaim, isNew: false, updated: false };
        }
      }
    }

    const created = this.createClaim(input);
    return { claim: created, isNew: true, updated: false };
  }

  public listClaims(options?: { sourceId?: string; subject?: string; limit?: number }): Claim[] {
    const rawDb = this.getRawDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.sourceId) {
      conditions.push('source_id = ?');
      params.push(options.sourceId);
    }
    if (options?.subject) {
      conditions.push('subject = ?');
      params.push(options.subject);
    }

    let query = 'SELECT * FROM claims';
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY created_at DESC';

    if (options?.limit && options.limit > 0) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = rawDb.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToClaim(r));
  }

  public deleteClaim(id: string): boolean {
    const rawDb = this.getRawDb();
    const result = rawDb.prepare('DELETE FROM claims WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- CLAIM HISTORY REPOSITORY ---

  public recordClaimHistory(
    claimId: string,
    value: string,
    normalizedValue: string | null,
    sourceId: string,
    observedAt: Date,
    firstSeenAt: Date,
    lastSeenAt: Date,
    supersededAt?: Date | null,
    supersededBy?: string | null,
    metadata: Record<string, unknown> = {},
  ): ClaimHistoryEntry {
    const rawDb = this.getRawDb();
    const id = crypto.randomUUID();
    const entry: ClaimHistoryEntry = {
      id,
      claimId,
      sourceId,
      value,
      normalizedValue,
      observedAt,
      firstSeenAt,
      lastSeenAt,
      supersededAt: supersededAt ?? null,
      supersededBy: supersededBy ?? null,
      metadata,
    };

    try {
      rawDb
        .prepare(
          `
          INSERT INTO claim_history (
            id, claim_id, source_id, value, normalized_value,
            observed_at, first_seen_at, last_seen_at, superseded_at, superseded_by, metadata
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          entry.id,
          entry.claimId,
          entry.sourceId,
          entry.value,
          entry.normalizedValue,
          entry.observedAt.toISOString(),
          entry.firstSeenAt.toISOString(),
          entry.lastSeenAt.toISOString(),
          entry.supersededAt ? entry.supersededAt.toISOString() : null,
          entry.supersededBy,
          JSON.stringify(entry.metadata),
        );

      return entry;
    } catch (error) {
      throw new DatabaseError(
        `Failed to record claim history: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  public getClaimHistory(claimId: string): ClaimHistoryEntry[] {
    const rawDb = this.getRawDb();
    const rows = rawDb
      .prepare(
        'SELECT * FROM claim_history WHERE claim_id = ? ORDER BY observed_at DESC, rowid DESC',
      )
      .all(claimId) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as string,
      claimId: r.claim_id as string,
      sourceId: r.source_id as string,
      value: r.value as string,
      normalizedValue: (r.normalized_value as string) ?? null,
      observedAt: new Date(r.observed_at as string),
      firstSeenAt: new Date(r.first_seen_at as string),
      lastSeenAt: new Date(r.last_seen_at as string),
      supersededAt: r.superseded_at ? new Date(r.superseded_at as string) : null,
      supersededBy: (r.superseded_by as string) ?? null,
      metadata: JSON.parse((r.metadata as string) || '{}'),
    }));
  }

  // --- CONTRADICTION REPOSITORY ---

  public createContradiction(input: CreateContradictionInput): Contradiction {
    const parsed = CreateContradictionInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError('Invalid contradiction input data', parsed.error.format());
    }

    const rawDb = this.getRawDb();
    const now = new Date();
    const id = parsed.data.id || crypto.randomUUID();

    const entity: Contradiction = {
      id,
      claimAId: parsed.data.claimAId,
      claimBId: parsed.data.claimBId,
      contradictionType: parsed.data.contradictionType,
      severity: parsed.data.severity,
      confidence: parsed.data.confidence ?? 1.0,
      explanation: parsed.data.explanation,
      status: parsed.data.status ?? 'OPEN',
      detectedAt: parsed.data.detectedAt ?? now,
      resolvedAt: parsed.data.resolvedAt ?? null,
      metadata: parsed.data.metadata ?? {},
    };

    try {
      rawDb
        .prepare(
          `
          INSERT INTO contradictions (id, claim_a_id, claim_b_id, contradiction_type, severity, confidence, explanation, status, detected_at, resolved_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          entity.id,
          entity.claimAId,
          entity.claimBId,
          entity.contradictionType,
          entity.severity,
          entity.confidence,
          entity.explanation,
          entity.status,
          entity.detectedAt.toISOString(),
          entity.resolvedAt ? entity.resolvedAt.toISOString() : null,
          JSON.stringify(entity.metadata),
        );

      return entity;
    } catch (error) {
      throw new DatabaseError(
        `Failed to create contradiction: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  public getContradictionById(id: string): Contradiction | null {
    const rawDb = this.getRawDb();
    const row = rawDb.prepare('SELECT * FROM contradictions WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.mapRowToContradiction(row);
  }

  public findContradictionByClaimPair(claimAId: string, claimBId: string): Contradiction | null {
    const rawDb = this.getRawDb();
    const row = rawDb
      .prepare(
        `
        SELECT * FROM contradictions
        WHERE (claim_a_id = ? AND claim_b_id = ?)
           OR (claim_a_id = ? AND claim_b_id = ?)
        LIMIT 1
      `,
      )
      .get(claimAId, claimBId, claimBId, claimAId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.mapRowToContradiction(row);
  }

  public saveDiscoveredContradiction(input: CreateContradictionInput): {
    contradiction: Contradiction;
    isNew: boolean;
  } {
    const existing = this.findContradictionByClaimPair(input.claimAId, input.claimBId);
    if (existing) {
      return { contradiction: existing, isNew: false };
    }

    const created = this.createContradiction(input);
    return { contradiction: created, isNew: true };
  }

  public listContradictions(options?: ListContradictionsOptions): Contradiction[] {
    const rawDb = this.getRawDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options?.severity) {
      conditions.push('severity = ?');
      params.push(options.severity);
    }

    if (options?.type) {
      conditions.push('contradiction_type = ?');
      params.push(options.type);
    }

    if (options?.minConfidence !== undefined) {
      conditions.push('confidence >= ?');
      params.push(options.minConfidence);
    }

    let query = 'SELECT * FROM contradictions';
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY detected_at DESC';

    if (options?.limit && options.limit > 0) {
      query += ' LIMIT ?';
      params.push(options.limit);

      if (options?.offset && options.offset > 0) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const rows = rawDb.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToContradiction(r));
  }

  public getContradictionWithDetails(id: string): {
    contradiction: Contradiction;
    claimA: Claim;
    claimB: Claim;
    sourceA: Source | null;
    sourceB: Source | null;
  } | null {
    const contradiction = this.getContradictionById(id);
    if (!contradiction) {
      return null;
    }

    const claimA = this.getClaimById(contradiction.claimAId);
    const claimB = this.getClaimById(contradiction.claimBId);

    if (!claimA || !claimB) {
      throw new DatabaseError(
        `Integrity error: contradiction ${id} references missing claims (${contradiction.claimAId}, ${contradiction.claimBId})`,
      );
    }

    const sourceA = this.getSourceById(claimA.sourceId);
    const sourceB = this.getSourceById(claimB.sourceId);

    return {
      contradiction,
      claimA,
      claimB,
      sourceA,
      sourceB,
    };
  }

  public updateContradictionStatus(
    id: string,
    status: ContradictionStatus,
    details?: {
      reason?: string | null;
      resolvedBy?: string | null;
      resolutionSource?: string | null;
      chosenClaimId?: string | null;
      auditNotes?: string | null;
      resolvedAt?: Date | null;
    },
  ): Contradiction {
    const existing = this.getContradictionById(id);
    if (!existing) {
      throw new NotFoundError('Contradiction', id);
    }

    const rawDb = this.getRawDb();
    const resolvedTimestamp =
      status === 'RESOLVED'
        ? details?.resolvedAt
          ? details.resolvedAt.toISOString()
          : new Date().toISOString()
        : null;

    try {
      rawDb
        .prepare(
          `
          UPDATE contradictions
          SET status = ?, resolved_at = ?, resolution_reason = ?, resolved_by = ?,
              resolution_source = ?, chosen_claim_id = ?, audit_notes = ?
          WHERE id = ?
        `,
        )
        .run(
          status,
          resolvedTimestamp,
          details?.reason ?? existing.resolutionReason ?? null,
          details?.resolvedBy ?? existing.resolvedBy ?? null,
          details?.resolutionSource ?? existing.resolutionSource ?? null,
          details?.chosenClaimId ?? existing.chosenClaimId ?? null,
          details?.auditNotes ?? existing.auditNotes ?? null,
          id,
        );

      // Record audit history entry
      this.recordContradictionAudit({
        contradictionId: id,
        action:
          status === 'RESOLVED'
            ? 'RESOLVED'
            : status === 'REVIEWED'
              ? 'REVIEWED'
              : status === 'DISMISSED'
                ? 'DISMISSED'
                : 'REOPENED',
        previousStatus: existing.status,
        newStatus: status,
        performedBy: details?.resolvedBy ?? 'system',
        reason: details?.reason ?? null,
        chosenClaimId: details?.chosenClaimId ?? null,
        notes: details?.auditNotes ?? null,
      });

      return {
        ...existing,
        status,
        resolvedAt: resolvedTimestamp ? new Date(resolvedTimestamp) : null,
        resolutionReason: details?.reason ?? existing.resolutionReason ?? null,
        resolvedBy: details?.resolvedBy ?? existing.resolvedBy ?? null,
        resolutionSource: details?.resolutionSource ?? existing.resolutionSource ?? null,
        chosenClaimId: details?.chosenClaimId ?? existing.chosenClaimId ?? null,
        auditNotes: details?.auditNotes ?? existing.auditNotes ?? null,
      };
    } catch (error) {
      throw new DatabaseError(
        `Failed to update contradiction ${id}: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  public recordContradictionAudit(input: {
    contradictionId: string;
    action: 'REVIEWED' | 'RESOLVED' | 'DISMISSED' | 'REOPENED';
    previousStatus: ContradictionStatus;
    newStatus: ContradictionStatus;
    performedBy: string;
    reason?: string | null;
    chosenClaimId?: string | null;
    notes?: string | null;
  }): ContradictionHistoryEntry {
    const rawDb = this.getRawDb();
    const id = crypto.randomUUID();
    const now = new Date();
    const entry: ContradictionHistoryEntry = {
      id,
      contradictionId: input.contradictionId,
      action: input.action,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      performedBy: input.performedBy,
      performedAt: now,
      reason: input.reason ?? null,
      chosenClaimId: input.chosenClaimId ?? null,
      notes: input.notes ?? null,
    };

    try {
      rawDb
        .prepare(
          `
          INSERT INTO contradiction_history (
            id, contradiction_id, action, previous_status, new_status,
            performed_by, performed_at, reason, chosen_claim_id, notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          entry.id,
          entry.contradictionId,
          entry.action,
          entry.previousStatus,
          entry.newStatus,
          entry.performedBy,
          entry.performedAt.toISOString(),
          entry.reason,
          entry.chosenClaimId,
          entry.notes,
        );

      return entry;
    } catch (error) {
      throw new DatabaseError(
        `Failed to record contradiction audit history: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  public getContradictionHistory(contradictionId: string): ContradictionHistoryEntry[] {
    const rawDb = this.getRawDb();
    const rows = rawDb
      .prepare(
        'SELECT * FROM contradiction_history WHERE contradiction_id = ? ORDER BY performed_at DESC, rowid DESC',
      )
      .all(contradictionId) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as string,
      contradictionId: r.contradiction_id as string,
      action: r.action as 'REVIEWED' | 'RESOLVED' | 'DISMISSED' | 'REOPENED',
      previousStatus: r.previous_status as ContradictionStatus,
      newStatus: r.new_status as ContradictionStatus,
      performedBy: r.performed_by as string,
      performedAt: new Date(r.performed_at as string),
      reason: (r.reason as string) ?? null,
      chosenClaimId: (r.chosen_claim_id as string) ?? null,
      notes: (r.notes as string) ?? null,
    }));
  }

  public async backup(targetPath: string): Promise<void> {
    const rawDb = this.getRawDb();
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await rawDb.backup(targetPath);
  }

  public checkIntegrity(): { ok: boolean; details: string[] } {
    const rawDb = this.getRawDb();
    const rows = rawDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const ok = rows.length === 1 && rows[0].integrity_check === 'ok';
    return {
      ok,
      details: rows.map((r) => r.integrity_check),
    };
  }

  public deleteContradiction(id: string): boolean {
    const rawDb = this.getRawDb();
    const result = rawDb.prepare('DELETE FROM contradictions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- MAPPING HELPERS ---

  private mapRowToSource(row: Record<string, unknown>): Source {
    return SourceSchema.parse({
      id: row.id,
      externalId: (row.external_id as string) ?? null,
      type: row.type,
      name: row.name,
      uri: row.uri,
      lastFetchedAt: row.last_fetched_at ? new Date(row.last_fetched_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      trustScore: Number(row.trust_score),
      metadata: JSON.parse((row.metadata as string) || '{}'),
    });
  }

  private mapRowToClaim(row: Record<string, unknown>): Claim {
    return ClaimSchema.parse({
      id: row.id,
      externalId: (row.external_id as string) ?? null,
      sourceId: row.source_id,
      subject: row.subject,
      predicate: row.predicate,
      value: row.value,
      valueType: row.value_type,
      normalizedValue: row.normalized_value,
      confidence: Number(row.confidence),
      environment: (row.environment as string) ?? 'unknown',
      scope: (row.scope as string) ?? 'unknown',
      sourceRole: (row.source_role as string) ?? 'unknown',
      isHistorical: Boolean(row.is_historical),
      validFrom: row.valid_from ? new Date(row.valid_from as string) : null,
      validUntil: row.valid_until ? new Date(row.valid_until as string) : null,
      valueConstraint: (row.value_constraint as string) ?? null,
      multiValueContext: (row.multi_value_context as string) ?? null,
      firstSeenAt: row.first_seen_at ? new Date(row.first_seen_at as string) : null,
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as string) : null,
      supersededBy: (row.superseded_by as string) ?? null,
      observedAt: new Date(row.observed_at as string),
      createdAt: new Date(row.created_at as string),
      metadata: JSON.parse((row.metadata as string) || '{}'),
    });
  }

  private mapRowToContradiction(row: Record<string, unknown>): Contradiction {
    return ContradictionSchema.parse({
      id: row.id,
      claimAId: row.claim_a_id,
      claimBId: row.claim_b_id,
      contradictionType: row.contradiction_type,
      severity: row.severity,
      confidence: Number(row.confidence),
      explanation: row.explanation,
      status: row.status,
      detectedAt: new Date(row.detected_at as string),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
      resolutionReason: (row.resolution_reason as string) ?? null,
      resolvedBy: (row.resolved_by as string) ?? null,
      resolutionSource: (row.resolution_source as string) ?? null,
      chosenClaimId: (row.chosen_claim_id as string) ?? null,
      auditNotes: (row.audit_notes as string) ?? null,
      metadata: JSON.parse((row.metadata as string) || '{}'),
    });
  }
}
