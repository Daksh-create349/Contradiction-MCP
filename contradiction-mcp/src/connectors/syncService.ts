import { DatabaseManager } from '../storage/database.js';
import { ConnectorRegistry } from './connectorRegistry.js';
import { DiscoveryService } from '../discovery/discoveryService.js';
import { logger } from '../utils/logger.js';

export interface SyncOptions {
  runDiscoveryAfterSync?: boolean;
  minConfidence?: number;
}

export interface SyncSummary {
  status: 'completed' | 'failed';
  source: {
    id: string;
    type: string;
    name: string;
    externalId: string;
  };
  repository?: string;
  filesInspected: number;
  claimsExtracted: number;
  claimsCreated: number;
  claimsUpdated: number;
  durationMs: number;
  contradictionsFound?: number;
  newContradictions?: number;
  error?: string;
}

export class SyncService {
  private readonly dbManager: DatabaseManager;
  private readonly registry: ConnectorRegistry;
  private readonly discoveryService?: DiscoveryService;

  constructor(
    dbManager: DatabaseManager,
    registry: ConnectorRegistry,
    discoveryService?: DiscoveryService,
  ) {
    this.dbManager = dbManager;
    this.registry = registry;
    this.discoveryService = discoveryService;
  }

  /**
   * Synchronizes an external source using its registered connector,
   * extracts and normalizes claims, idempotently upserts them in SQLite,
   * and optionally runs incremental contradiction discovery.
   */
  public async syncSource(
    connectorType: string,
    input: unknown,
    options?: SyncOptions,
  ): Promise<SyncSummary> {
    const startTime = performance.now();
    logger.info('Starting external source synchronization', {
      connector: connectorType,
      input,
    });

    const connector = this.registry.getOrThrow(connectorType);

    // 1. Fetch raw data from external source
    const fetchResult = await connector.fetch(input);

    // 2. Extract and normalize claims
    const extractedClaims = await connector.extractClaims(fetchResult);

    // 3. Upsert Source entity
    const { source } = this.dbManager.upsertSource({
      externalId: fetchResult.sourceIdentifier,
      type: connector.type,
      name: fetchResult.sourceName,
      uri: fetchResult.sourceUri,
      lastFetchedAt: fetchResult.fetchedAt,
      trustScore: 1.0,
      metadata: fetchResult.metadata,
    });

    // 4. Idempotently upsert claims without creating duplicates
    let claimsCreated = 0;
    let claimsUpdated = 0;
    const touchedClaimIds: string[] = [];

    for (const claim of extractedClaims) {
      const res = this.dbManager.upsertClaim({
        externalId: claim.externalId,
        sourceId: source.id,
        subject: claim.subject,
        predicate: claim.predicate,
        value: claim.value,
        valueType: claim.valueType,
        normalizedValue: claim.normalizedValue,
        confidence: claim.confidence ?? 1.0,
        environment: claim.environment,
        scope: claim.scope,
        sourceRole: claim.sourceRole,
        isHistorical: claim.isHistorical ?? false,
        validFrom: claim.validFrom,
        validUntil: claim.validUntil,
        valueConstraint: claim.valueConstraint,
        multiValueContext: claim.multiValueContext,
        observedAt: claim.observedAt ?? new Date(),
        metadata: {
          ...claim.provenance,
        },
      });

      if (res.isNew) {
        claimsCreated++;
        touchedClaimIds.push(res.claim.id);
      } else if (res.updated) {
        claimsUpdated++;
        touchedClaimIds.push(res.claim.id);
      }
    }

    // 5. Run incremental contradiction discovery for touched claims
    let contradictionsFound = 0;
    let newContradictions = 0;

    const runDiscovery = options?.runDiscoveryAfterSync ?? true;
    if (runDiscovery && this.discoveryService && touchedClaimIds.length > 0) {
      logger.info('Executing incremental contradiction discovery for synced claims', {
        touchedCount: touchedClaimIds.length,
      });

      for (const claimId of touchedClaimIds) {
        try {
          const scanRes = this.discoveryService.scanClaim(claimId, {
            minConfidence: options?.minConfidence ?? 0.5,
          });
          contradictionsFound += scanRes.contradictionsFound;
          newContradictions += scanRes.newContradictions;
        } catch (err) {
          logger.warn('Failed incremental scan for claim', { claimId, error: String(err) });
        }
      }
    }

    const durationMs = Math.round(performance.now() - startTime);

    const summary: SyncSummary = {
      status: 'completed',
      source: {
        id: source.id,
        type: source.type,
        name: source.name,
        externalId: source.externalId || fetchResult.sourceIdentifier,
      },
      repository: source.name,
      filesInspected: Number(fetchResult.metadata.filesCount || 0),
      claimsExtracted: extractedClaims.length,
      claimsCreated,
      claimsUpdated,
      durationMs,
      contradictionsFound,
      newContradictions,
    };

    logger.info('External source synchronization complete', {
      repository: summary.repository,
      claimsCreated: summary.claimsCreated,
      claimsUpdated: summary.claimsUpdated,
      durationMs: summary.durationMs,
    });
    return summary;
  }

  /**
   * Synchronizes multiple external sources with bounded concurrency and failure isolation.
   */
  public async syncSources(
    requests: Array<{ connector: string; input: unknown }>,
    options?: SyncOptions & { concurrency?: number },
  ): Promise<{
    sourcesRequested: number;
    sourcesSucceeded: number;
    sourcesFailed: number;
    claimsCreated: number;
    claimsUpdated: number;
    contradictionsFound: number;
    durationMs: number;
    results: Array<{
      connector: string;
      status: 'completed' | 'failed';
      summary?: SyncSummary;
      error?: string;
    }>;
  }> {
    const startTime = performance.now();
    const concurrency = Math.max(1, Math.min(10, options?.concurrency ?? 3));
    const results: Array<{
      connector: string;
      status: 'completed' | 'failed';
      summary?: SyncSummary;
      error?: string;
    }> = [];

    let succeeded = 0;
    let failed = 0;
    let totalClaimsCreated = 0;
    let totalClaimsUpdated = 0;
    let totalContradictionsFound = 0;

    // Execute with worker queue for bounded concurrency
    let index = 0;
    const executeWorker = async () => {
      while (index < requests.length) {
        const currentIdx = index++;
        const req = requests[currentIdx];
        try {
          const summary = await this.syncSource(req.connector, req.input, options);
          results[currentIdx] = {
            connector: req.connector,
            status: 'completed',
            summary,
          };
          succeeded++;
          totalClaimsCreated += summary.claimsCreated;
          totalClaimsUpdated += summary.claimsUpdated;
          totalContradictionsFound += summary.contradictionsFound ?? 0;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to sync source in batch', { connector: req.connector, error: msg });
          results[currentIdx] = {
            connector: req.connector,
            status: 'failed',
            error: msg,
          };
          failed++;
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, requests.length) }, () =>
      executeWorker(),
    );
    await Promise.all(workers);

    return {
      sourcesRequested: requests.length,
      sourcesSucceeded: succeeded,
      sourcesFailed: failed,
      claimsCreated: totalClaimsCreated,
      claimsUpdated: totalClaimsUpdated,
      contradictionsFound: totalContradictionsFound,
      durationMs: Math.round(performance.now() - startTime),
      results,
    };
  }
}
