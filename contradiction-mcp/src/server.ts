import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { HealthService } from './services/healthService.js';
import { AnalysisService } from './services/analysisService.js';
import { DiscoveryService } from './discovery/discoveryService.js';
import { DatabaseManager } from './storage/database.js';
import { ConnectorRegistry } from './connectors/connectorRegistry.js';
import { SyncService } from './connectors/syncService.js';
import { GitHubConnector } from './connectors/github/githubConnector.js';
import { ReviewService } from './services/reviewService.js';
import { ResolutionAdvisor } from './intelligence/resolutionAdvisor.js';
import { MetricsService, globalMetrics } from './services/metricsService.js';
import { RateLimiter } from './services/rateLimiter.js';
import { logger } from './utils/logger.js';
import { NotFoundError, AuthorizationError, toSafeError } from './domain/types/common.js';
import { ContradictionSeverities, ContradictionStatuses } from './domain/entities/contradiction.js';

export type AuthScope = 'read' | 'analyze' | 'sync' | 'review' | 'resolve' | 'admin';

export interface ServerOptions {
  healthService: HealthService;
  analysisService?: AnalysisService;
  discoveryService?: DiscoveryService;
  dbManager?: DatabaseManager;
  connectorRegistry?: ConnectorRegistry;
  syncService?: SyncService;
  reviewService?: ReviewService;
  resolutionAdvisor?: ResolutionAdvisor;
  metricsService?: MetricsService;
  rateLimiter?: RateLimiter;
  name?: string;
  version?: string;
  clientScopes?: AuthScope[];
}

function checkScope(scope: AuthScope, options: ServerOptions): void {
  if (!options.clientScopes) return;
  if (!options.clientScopes.includes('admin') && !options.clientScopes.includes(scope)) {
    throw new AuthorizationError(
      `Insufficient permissions: operation requires '${scope}' or 'admin' scope`,
      { requiredScope: scope, activeScopes: options.clientScopes },
    );
  }
}

export function createMcpServer(options: ServerOptions): McpServer {
  const name = options.name || 'contradiction-mcp';
  const version = options.version || '0.1.0';

  const reviewService =
    options.reviewService ?? (options.dbManager ? new ReviewService(options.dbManager) : undefined);
  const resolutionAdvisor = options.resolutionAdvisor ?? new ResolutionAdvisor();
  const metricsService = options.metricsService ?? globalMetrics;

  const server = new McpServer(
    {
      name,
      version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
    },
  );

  const registerTool = (
    toolName: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (args: any) => Promise<any>,
  ) => {
    if (!schema || Object.keys(schema).length === 0) {
      server.registerTool(toolName, { description }, handler);
    } else {
      server.registerTool(toolName, { description, inputSchema: schema }, handler);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = registerTool;

  // 1. Tool: health_check
  registerTool(
    'health_check',
    'Checks the operational status of Contradiction MCP, including database connectivity and server metrics.',
    {},
    async () => {
      try {
        logger.debug('Executing health_check tool');
        const health = await options.healthService.getHealth();

        return {
          isError: health.status === 'unhealthy',
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(health, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during health_check execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  status: 'unhealthy',
                  error: safe.message,
                  code: safe.code,
                  timestamp: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 2. Tool: analyze_claim_pair
  registerTool(
    'analyze_claim_pair',
    'Analyzes two claims to determine whether they contradict each other, returning contradiction classification, severity, confidence score, and explanation.',
    {
      claimAId: z.string().min(1).describe('The unique ID of the first claim'),
      claimBId: z.string().min(1).describe('The unique ID of the second claim'),
    },
    async (args) => {
      try {
        logger.debug('Executing analyze_claim_pair tool', {
          claimAId: args.claimAId,
          claimBId: args.claimBId,
        });

        if (!options.analysisService) {
          throw new Error('AnalysisService is not configured on this server instance');
        }

        const result = options.analysisService.analyzeClaimPair(args.claimAId, args.claimBId);

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during analyze_claim_pair execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  claimAId: args.claimAId,
                  claimBId: args.claimBId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 3. Tool: scan_for_contradictions
  registerTool(
    'scan_for_contradictions',
    'Scans all claims in the database using deterministic candidate grouping, detects contradictions, persists them without duplicates, and returns a summary report.',
    {
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of contradiction results to return (default: 50)'),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum confidence threshold between 0.0 and 1.0 (default: 0.5)'),
      includeDismissed: z
        .boolean()
        .optional()
        .describe('Whether to include previously dismissed contradictions (default: false)'),
    },
    async (args) => {
      try {
        logger.debug('Executing scan_for_contradictions tool', args);

        if (!options.discoveryService) {
          throw new Error('DiscoveryService is not configured on this server instance');
        }

        const summary = options.discoveryService.scanAllClaims(args);

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during scan_for_contradictions execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 4. Tool: scan_claim_for_contradictions
  registerTool(
    'scan_claim_for_contradictions',
    'Performs an incremental scan for a single claim against relevant candidate claims in the database and persists new contradictions.',
    {
      claimId: z.string().min(1).describe('The unique ID of the claim to scan'),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum confidence threshold between 0.0 and 1.0 (default: 0.5)'),
    },
    async (args) => {
      try {
        logger.debug('Executing scan_claim_for_contradictions tool', args);

        if (!options.discoveryService) {
          throw new Error('DiscoveryService is not configured on this server instance');
        }

        const summary = options.discoveryService.scanClaim(args.claimId, {
          minConfidence: args.minConfidence,
        });

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during scan_claim_for_contradictions execution', {
          error: String(error),
        });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  claimId: args.claimId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 5. Tool: list_contradictions
  registerTool(
    'list_contradictions',
    'Queries stored contradiction records from the database with optional filtering by status, severity, type, and confidence.',
    {
      status: z
        .enum(ContradictionStatuses)
        .optional()
        .describe('Filter by contradiction status (OPEN, REVIEWED, RESOLVED, DISMISSED)'),
      severity: z
        .enum(ContradictionSeverities)
        .optional()
        .describe('Filter by severity level (LOW, MEDIUM, HIGH, CRITICAL)'),
      type: z.string().optional().describe('Filter by contradiction type string'),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Filter by minimum confidence threshold'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of records to return (default: 50)'),
      offset: z.number().int().nonnegative().optional().describe('Pagination offset (default: 0)'),
    },
    async (args) => {
      try {
        logger.debug('Executing list_contradictions tool', args);

        if (!options.dbManager) {
          throw new Error('DatabaseManager is not configured on this server instance');
        }

        const items = options.dbManager.listContradictions({
          status: args.status,
          severity: args.severity,
          type: args.type,
          minConfidence: args.minConfidence,
          limit: args.limit ?? 50,
          offset: args.offset,
        });

        // Enrich with basic claim and source references
        const enriched = items.map((item) => {
          const claimA = options.dbManager?.getClaimById(item.claimAId);
          const claimB = options.dbManager?.getClaimById(item.claimBId);
          const sourceA = claimA ? options.dbManager?.getSourceById(claimA.sourceId) : null;
          const sourceB = claimB ? options.dbManager?.getSourceById(claimB.sourceId) : null;

          return {
            id: item.id,
            contradictionType: item.contradictionType,
            severity: item.severity,
            confidence: item.confidence,
            status: item.status,
            explanation: item.explanation,
            detectedAt: item.detectedAt,
            resolvedAt: item.resolvedAt,
            claims: {
              claimA: claimA
                ? {
                    id: claimA.id,
                    subject: claimA.subject,
                    predicate: claimA.predicate,
                    value: claimA.value,
                  }
                : { id: item.claimAId },
              claimB: claimB
                ? {
                    id: claimB.id,
                    subject: claimB.subject,
                    predicate: claimB.predicate,
                    value: claimB.value,
                  }
                : { id: item.claimBId },
            },
            sources: {
              sourceA: sourceA ? { id: sourceA.id, name: sourceA.name, type: sourceA.type } : null,
              sourceB: sourceB ? { id: sourceB.id, name: sourceB.name, type: sourceB.type } : null,
            },
          };
        });

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: enriched.length,
                  contradictions: enriched,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during list_contradictions execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 6. Tool: get_contradiction
  registerTool(
    'get_contradiction',
    'Retrieves a single contradiction by ID, including its complete claim and source records for in-depth agent investigation.',
    {
      contradictionId: z.string().min(1).describe('The unique ID of the contradiction record'),
    },
    async (args) => {
      try {
        logger.debug('Executing get_contradiction tool', args);

        if (!options.dbManager) {
          throw new Error('DatabaseManager is not configured on this server instance');
        }

        const details = options.dbManager.getContradictionWithDetails(args.contradictionId);
        if (!details) {
          throw new NotFoundError('Contradiction', args.contradictionId);
        }

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(details, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during get_contradiction execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  contradictionId: args.contradictionId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 7. Tool: list_connectors
  registerTool(
    'list_connectors',
    'Lists all available external source connectors with their capabilities, authentication requirements, and statuses.',
    {},
    async () => {
      try {
        logger.debug('Executing list_connectors tool');

        if (!options.connectorRegistry) {
          throw new Error('ConnectorRegistry is not configured on this server instance');
        }

        const connectors = options.connectorRegistry.list();

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: connectors.length,
                  connectors,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during list_connectors execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 8. Tool: test_github_connection
  registerTool(
    'test_github_connection',
    'Tests connectivity to GitHub and validates accessibility of a specific repository without exposing credentials.',
    {
      owner: z
        .string()
        .min(1)
        .describe('The GitHub organization or username owning the repository'),
      repo: z.string().min(1).describe('The repository name'),
    },
    async (args) => {
      try {
        logger.debug('Executing test_github_connection tool', args);

        if (!options.connectorRegistry) {
          throw new Error('ConnectorRegistry is not configured on this server instance');
        }

        const connector = options.connectorRegistry.get('github') as GitHubConnector | undefined;
        if (!connector) {
          throw new NotFoundError('Connector', 'github');
        }

        const result = await connector.testConnection({
          owner: args.owner,
          repo: args.repo,
        });

        return {
          isError: !result.accessible,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during test_github_connection execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  owner: args.owner,
                  repo: args.repo,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 9. Tool: sync_github_repository
  registerTool(
    'sync_github_repository',
    'Ingests a real GitHub repository, extracts factual claims (runtimes, dependencies, ports), idempotently persists them in SQLite, and runs automatic contradiction discovery on touched claims.',
    {
      owner: z
        .string()
        .min(1)
        .describe('The GitHub organization or username owning the repository'),
      repo: z.string().min(1).describe('The repository name'),
      branch: z
        .string()
        .optional()
        .describe('Optional git branch or tag name (defaults to repository default branch)'),
      runDiscovery: z
        .boolean()
        .optional()
        .describe(
          'Whether to automatically trigger incremental contradiction discovery after sync (default: true)',
        ),
    },
    async (args) => {
      try {
        checkScope('sync', options);
        logger.debug('Executing sync_github_repository tool', args);

        if (!options.syncService) {
          throw new Error('SyncService is not configured on this server instance');
        }

        const summary = await options.syncService.syncSource(
          'github',
          {
            owner: args.owner,
            repo: args.repo,
            branch: args.branch,
          },
          {
            runDiscoveryAfterSync: args.runDiscovery ?? true,
          },
        );

        return {
          isError: summary.status === 'failed',
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during sync_github_repository execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  owner: args.owner,
                  repo: args.repo,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 10. Tool: explain_claim_relationship
  registerTool(
    'explain_claim_relationship',
    'Explains why two claims do or do not contradict each other based on context dimensions including environment, scope, source role, temporal state, SemVer range compatibility, and set membership.',
    {
      claimAId: z.string().uuid().describe('ID of the first claim'),
      claimBId: z.string().uuid().describe('ID of the second claim'),
    },
    async (args) => {
      try {
        logger.debug('Executing explain_claim_relationship tool', args);
        if (!options.analysisService) {
          throw new Error('AnalysisService is not configured on this server instance');
        }
        const result = options.analysisService.explainClaimRelationship(
          args.claimAId,
          args.claimBId,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during explain_claim_relationship execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  claimAId: args.claimAId,
                  claimBId: args.claimBId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 11. Tool: review_contradiction
  registerTool(
    'review_contradiction',
    'Marks a contradiction record as REVIEWED, recording the reviewer identity and optional notes in the persistent audit trail.',
    {
      contradictionId: z
        .string()
        .min(1)
        .describe('The unique ID of the contradiction record to review'),
      reviewedBy: z.string().min(1).describe('Name or identifier of the reviewer / agent'),
      notes: z.string().optional().describe('Review findings or triage notes'),
    },
    async (args) => {
      try {
        checkScope('review', options);
        metricsService.recordToolCall('review_contradiction');
        if (!reviewService) {
          throw new Error('ReviewService is not configured on this server instance');
        }

        const updated = reviewService.reviewContradiction(args.contradictionId, {
          reviewedBy: args.reviewedBy,
          notes: args.notes,
        });

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during review_contradiction execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  contradictionId: args.contradictionId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 12. Tool: resolve_contradiction
  registerTool(
    'resolve_contradiction',
    'Resolves a contradiction record, recording the authoritative chosen claim (optional), resolution reason, and audit trail.',
    {
      contradictionId: z
        .string()
        .min(1)
        .describe('The unique ID of the contradiction record to resolve'),
      resolvedBy: z.string().min(1).describe('Name or identifier of the resolver'),
      reason: z
        .string()
        .min(1)
        .describe('Detailed explanation of why and how this contradiction was resolved'),
      chosenClaimId: z
        .string()
        .optional()
        .describe('ID of the claim accepted as authoritative (optional)'),
      notes: z.string().optional().describe('Additional resolution notes'),
    },
    async (args) => {
      try {
        checkScope('resolve', options);
        metricsService.recordToolCall('resolve_contradiction');
        if (!reviewService) {
          throw new Error('ReviewService is not configured on this server instance');
        }

        const updated = reviewService.resolveContradiction(args.contradictionId, {
          resolvedBy: args.resolvedBy,
          reason: args.reason,
          chosenClaimId: args.chosenClaimId,
          notes: args.notes,
        });

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during resolve_contradiction execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  contradictionId: args.contradictionId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 13. Tool: dismiss_contradiction
  registerTool(
    'dismiss_contradiction',
    'Dismisses a contradiction record as acceptable or non-actionable, preserving an audit record of the decision.',
    {
      contradictionId: z
        .string()
        .min(1)
        .describe('The unique ID of the contradiction record to dismiss'),
      dismissedBy: z
        .string()
        .min(1)
        .describe('Name or identifier of the actor dismissing this contradiction'),
      reason: z.string().min(1).describe('Reason why this contradiction is dismissed'),
      notes: z.string().optional().describe('Additional notes'),
    },
    async (args) => {
      try {
        checkScope('review', options);
        metricsService.recordToolCall('dismiss_contradiction');
        if (!reviewService) {
          throw new Error('ReviewService is not configured on this server instance');
        }

        const updated = reviewService.dismissContradiction(args.contradictionId, {
          dismissedBy: args.dismissedBy,
          reason: args.reason,
          notes: args.notes,
        });

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during dismiss_contradiction execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  contradictionId: args.contradictionId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 14. Tool: reopen_contradiction
  registerTool(
    'reopen_contradiction',
    'Reopens a previously resolved or dismissed contradiction back to OPEN status with audit trail logging.',
    {
      contradictionId: z
        .string()
        .min(1)
        .describe('The unique ID of the contradiction record to reopen'),
      reopenedBy: z
        .string()
        .min(1)
        .describe('Name or identifier of the actor reopening this contradiction'),
      reason: z.string().optional().describe('Reason for reopening'),
      notes: z.string().optional().describe('Additional notes'),
    },
    async (args) => {
      try {
        checkScope('review', options);
        metricsService.recordToolCall('reopen_contradiction');
        if (!reviewService) {
          throw new Error('ReviewService is not configured on this server instance');
        }

        const updated = reviewService.reopenContradiction(args.contradictionId, {
          reopenedBy: args.reopenedBy,
          reason: args.reason,
          notes: args.notes,
        });

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during reopen_contradiction execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  contradictionId: args.contradictionId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 15. Tool: get_contradiction_history
  registerTool(
    'get_contradiction_history',
    'Retrieves the chronological audit history of review and resolution actions performed on a contradiction record.',
    {
      contradictionId: z.string().min(1).describe('The unique ID of the contradiction record'),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('get_contradiction_history');
        if (!reviewService) {
          throw new Error('ReviewService is not configured on this server instance');
        }

        const history = reviewService.getContradictionHistory(args.contradictionId);

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  contradictionId: args.contradictionId,
                  count: history.length,
                  history,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during get_contradiction_history execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  contradictionId: args.contradictionId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 16. Tool: get_claim_history
  registerTool(
    'get_claim_history',
    'Retrieves the chronological value transition history for a specific factual claim, tracking updates and superseded values.',
    {
      claimId: z.string().min(1).describe('The unique ID of the claim'),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('get_claim_history');
        if (!options.dbManager) {
          throw new Error('DatabaseManager is not configured on this server instance');
        }

        const claim = options.dbManager.getClaimById(args.claimId);
        if (!claim) {
          throw new NotFoundError('Claim', args.claimId);
        }

        const history = options.dbManager.getClaimHistory(args.claimId);

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  claimId: args.claimId,
                  currentValue: claim.value,
                  normalizedValue: claim.normalizedValue,
                  observedAt: claim.observedAt,
                  firstSeenAt: claim.firstSeenAt,
                  lastSeenAt: claim.lastSeenAt,
                  supersededBy: claim.supersededBy,
                  historyCount: history.length,
                  history,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during get_claim_history execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  claimId: args.claimId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 17. Tool: advise_resolution
  registerTool(
    'advise_resolution',
    'Generates deterministic authority and freshness scoring comparison to advise an agent on which claim likely represents current truth.',
    {
      contradictionId: z.string().min(1).describe('The unique ID of the contradiction record'),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('advise_resolution');
        if (!options.dbManager) {
          throw new Error('DatabaseManager is not configured on this server instance');
        }

        const details = options.dbManager.getContradictionWithDetails(args.contradictionId);
        if (!details) {
          throw new NotFoundError('Contradiction', args.contradictionId);
        }

        const advice = resolutionAdvisor.adviseResolution(
          details.contradiction,
          details.claimA,
          details.claimB,
          details.sourceA,
          details.sourceB,
        );

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(advice, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during advise_resolution execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  contradictionId: args.contradictionId,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 18. Tool: sync_source
  registerTool(
    'sync_source',
    'Unified ingestion tool: synchronizes any registered source connector (github, document, website), idempotently extracts claims, and runs automatic contradiction discovery.',
    {
      connector: z
        .string()
        .min(1)
        .describe('The connector identifier (e.g. github, document, website)'),
      input: z.record(z.string(), z.unknown()).describe('Connector-specific input parameters'),
      runDiscovery: z
        .boolean()
        .optional()
        .describe('Whether to trigger automatic contradiction discovery (default: true)'),
    },
    async (args) => {
      try {
        checkScope('sync', options);
        metricsService.recordToolCall('sync_source');
        if (!options.syncService) {
          throw new Error('SyncService is not configured on this server instance');
        }

        const summary = await options.syncService.syncSource(args.connector, args.input, {
          runDiscoveryAfterSync: args.runDiscovery ?? true,
        });

        metricsService.recordSync(
          summary.status === 'completed',
          summary.claimsCreated,
          summary.contradictionsFound ?? 0,
        );

        return {
          isError: summary.status === 'failed',
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during sync_source execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  connector: args.connector,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 19. Tool: sync_sources
  registerTool(
    'sync_sources',
    'Batch ingestion tool: synchronizes multiple external sources with bounded concurrency, failure isolation, and unified contradiction discovery.',
    {
      sources: z
        .array(
          z.object({
            connector: z.string().min(1).describe('Connector type: github, document, website'),
            input: z.record(z.string(), z.unknown()).describe('Input parameters for connector'),
          }),
        )
        .min(1)
        .describe('List of source synchronization requests'),
      concurrency: z
        .number()
        .int()
        .positive()
        .max(10)
        .optional()
        .describe('Max concurrent workers (default: 3)'),
      runDiscovery: z
        .boolean()
        .optional()
        .describe('Whether to run discovery after synchronization (default: true)'),
    },
    async (args) => {
      try {
        checkScope('sync', options);
        metricsService.recordToolCall('sync_sources');
        if (!options.syncService) {
          throw new Error('SyncService is not configured on this server instance');
        }

        const summary = await options.syncService.syncSources(args.sources, {
          concurrency: args.concurrency ?? 3,
          runDiscoveryAfterSync: args.runDiscovery ?? true,
        });

        return {
          isError:
            summary.sourcesFailed === summary.sourcesRequested && summary.sourcesRequested > 0,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during sync_sources execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 20. Tool: sync_document
  registerTool(
    'sync_document',
    'Synchronizes a local document file (Markdown, text, JSON, YAML, CSV), extracts claims with exact line provenance, and discovers contradictions.',
    {
      filePath: z.string().min(1).describe('Absolute or relative file path on disk'),
      sourceName: z.string().optional().describe('Optional friendly name for this source'),
      subject: z
        .string()
        .optional()
        .describe('Subject entity name for extracted claims (default: filename)'),
      scope: z.string().optional().describe('Scope of the document (default: file)'),
      environment: z
        .string()
        .optional()
        .describe('Environment context (e.g. production, development)'),
      sourceRole: z
        .string()
        .optional()
        .describe('Source role (e.g. deployment, configuration, documentation)'),
      runDiscovery: z
        .boolean()
        .optional()
        .describe('Whether to trigger automatic contradiction discovery (default: true)'),
    },
    async (args) => {
      try {
        checkScope('sync', options);
        metricsService.recordToolCall('sync_document');
        if (!options.syncService) {
          throw new Error('SyncService is not configured on this server instance');
        }

        const summary = await options.syncService.syncSource(
          'document',
          {
            filePath: args.filePath,
            sourceName: args.sourceName,
            subject: args.subject,
            scope: args.scope,
            environment: args.environment,
            sourceRole: args.sourceRole,
          },
          {
            runDiscoveryAfterSync: args.runDiscovery ?? true,
          },
        );

        return {
          isError: summary.status === 'failed',
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during sync_document execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  filePath: args.filePath,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 21. Tool: sync_website
  registerTool(
    'sync_website',
    'Fetches an explicit public web page with strict SSRF defenses, extracts factual claims, and discovers contradictions.',
    {
      url: z.string().url().describe('Public web page URL (http or https only)'),
      sourceName: z.string().optional().describe('Friendly name for the website'),
      runDiscovery: z
        .boolean()
        .optional()
        .describe('Whether to trigger automatic contradiction discovery (default: true)'),
    },
    async (args) => {
      try {
        checkScope('sync', options);
        metricsService.recordToolCall('sync_website');
        if (!options.syncService) {
          throw new Error('SyncService is not configured on this server instance');
        }

        const summary = await options.syncService.syncSource(
          'website',
          {
            url: args.url,
            sourceName: args.sourceName,
          },
          {
            runDiscoveryAfterSync: args.runDiscovery ?? true,
          },
        );

        return {
          isError: summary.status === 'failed',
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during sync_website execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: safe.message,
                  code: safe.code,
                  url: args.url,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // --- MCP RESOURCES ---

  server.registerResource(
    'health-metrics',
    'health://metrics',
    {
      title: 'Health Metrics',
      description: 'System health and operational metrics',
      mimeType: 'application/json',
    },
    async (uri) => {
      const snapshot = metricsService.getSnapshot();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(snapshot, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'contradiction-details',
    new ResourceTemplate('contradiction://{id}', { list: undefined }),
    {
      title: 'Contradiction Details',
      description: 'Details and claims for a specific contradiction',
      mimeType: 'application/json',
    },
    async (uri, { id }) => {
      if (!options.dbManager) {
        throw new Error('DatabaseManager is not configured');
      }
      const record = options.dbManager.getContradictionWithDetails(id as string);
      if (!record) {
        throw new NotFoundError('Contradiction', id as string);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(record, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'claim-details',
    new ResourceTemplate('claim://{id}', { list: undefined }),
    {
      title: 'Claim Details',
      description: 'Factual claim details and source provenance',
      mimeType: 'application/json',
    },
    async (uri, { id }) => {
      if (!options.dbManager) {
        throw new Error('DatabaseManager is not configured');
      }
      const claim = options.dbManager.getClaimById(id as string);
      if (!claim) {
        throw new NotFoundError('Claim', id as string);
      }
      const source = options.dbManager.getSourceById(claim.sourceId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ claim, source }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'source-details',
    new ResourceTemplate('source://{id}', { list: undefined }),
    {
      title: 'Source Details',
      description: 'Ingested source record details',
      mimeType: 'application/json',
    },
    async (uri, { id }) => {
      if (!options.dbManager) {
        throw new Error('DatabaseManager is not configured');
      }
      const source = options.dbManager.getSourceById(id as string);
      if (!source) {
        throw new NotFoundError('Source', id as string);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(source, null, 2),
          },
        ],
      };
    },
  );

  // --- MCP PROMPTS ---

  server.registerPrompt(
    'investigate_contradiction',
    {
      description:
        'Provides a structured investigation plan for an AI agent to resolve a specific contradiction.',
      argsSchema: {
        contradictionId: z.string().describe('ID of the contradiction to investigate'),
      },
    },
    async (args) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please investigate contradiction record '${args.contradictionId}' using Contradiction MCP tools:\n1. Call 'get_contradiction' with contradictionId='${args.contradictionId}'.\n2. Inspect the two conflicting claims and their sources.\n3. Call 'explain_claim_relationship' to analyze contextual dimensions (environment, scope, roles, ranges).\n4. Call 'advise_resolution' to assess authority and freshness scoring.\n5. Recommend or execute 'resolve_contradiction' or 'dismiss_contradiction' with justified reasoning.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'review_source_consistency',
    {
      description:
        'Guides an agent through scanning and reviewing consistency for claims associated with an ingested source.',
      argsSchema: {
        sourceName: z.string().describe('Name or identifier of the source repository or document'),
      },
    },
    async (args) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Review consistency for source '${args.sourceName}':\n1. Run 'scan_for_contradictions' to discover any newly introduced discrepancies.\n2. Query 'list_contradictions' filtered by status='OPEN'.\n3. For each high or critical contradiction, review the conflicting evidence snippets and recommend updates.`,
            },
          },
        ],
      };
    },
  );

  return server;
}
