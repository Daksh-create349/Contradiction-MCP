import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import fs from 'node:fs';
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
  const version = options.version || '0.3.1';

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

  // ==========================================
  // CANONICAL TOOLSET (12 VERB_NOUN TOOLS)
  // ==========================================

  // 1. Tool: check_health
  registerTool(
    'check_health',
    'Checks the operational status of the Contradiction MCP server, including SQLite database connectivity, storage metrics, active connectors, and runtime diagnostics. Read-only and safe to invoke frequently for readiness and liveness probing.',
    {
      verbose: z
        .boolean()
        .optional()
        .describe(
          'Whether to include extended diagnostic details such as memory usage, uptime, and connector capabilities (default: false)',
        ),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('check_health');
        const health = await options.healthService.getHealth();
        const payload: Record<string, unknown> = { ...health };
        if (args?.verbose) {
          payload.metrics = metricsService.getSnapshot();
        }
        return {
          isError: health.status === 'unhealthy',
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        };
      } catch (error) {
        logger.error('Error during check_health execution', { error: String(error) });
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

  // 2. Tool: list_sources
  registerTool(
    'list_sources',
    'Lists all registered external data source connectors (document, website, github) and ingested source entities tracked by the system, including source IDs, synchronization timestamps, and claim counts. Read-only operation. Use this tool to inspect available data sources before initiating scans or synchronization.',
    {
      type: z
        .enum(['document', 'website', 'github'])
        .optional()
        .describe('Optional filter by source connector type'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of ingested source records to return (default: 50)'),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Pagination offset for source records (default: 0)'),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('list_sources');
        const connectors = options.connectorRegistry?.list() ?? [];
        const sources = options.dbManager
          ? options.dbManager.listSources({
              type: args.type,
              limit: args.limit ?? 50,
              offset: args.offset,
            })
          : [];
        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { count: connectors.length, connectors, sourcesCount: sources.length, sources },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during list_sources execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: safe.message, code: safe.code }, null, 2),
            },
          ],
        };
      }
    },
  );

  // 3. Tool: test_connection
  registerTool(
    'test_connection',
    'Validates connectivity, authentication, and accessibility for an external data source or connector (such as a GitHub repository, web URL, or local file) without persisting any data or modifying state. Use this tool to verify credentials and target reachability prior to running synchronization.',
    {
      connector: z
        .enum(['github', 'website', 'document'])
        .describe('The connector type to validate (github, website, document)'),
      target: z
        .string()
        .min(1)
        .describe(
          'Target identifier to validate: "owner/repo" for GitHub, URL for website, or file path for document',
        ),
      branch: z
        .string()
        .optional()
        .describe('Optional git branch or tag name to check when testing GitHub repositories'),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('test_connection');
        if (args.connector === 'github') {
          const parts = args.target.split('/');
          const owner = parts[0] || '';
          const repo = parts[1] || '';
          const connector = options.connectorRegistry?.get('github') as GitHubConnector | undefined;
          if (!connector) throw new NotFoundError('Connector', 'github');
          const result = await connector.testConnection({ owner, repo, branch: args.branch });
          return {
            isError: !result.accessible,
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } else if (args.connector === 'website') {
          const connector = options.connectorRegistry?.get('website');
          if (!connector) throw new NotFoundError('Connector', 'website');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (connector as any).testConnection({ url: args.target });
          return {
            isError: !result.accessible,
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } else {
          const connector = options.connectorRegistry?.get('document');
          if (connector) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (connector as any).testConnection({ filePath: args.target });
            return {
              isError: !result.accessible,
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
          }
          const exists = fs.existsSync(args.target);
          return {
            isError: !exists,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    connector: 'document',
                    target: args.target,
                    accessible: exists,
                    message: exists ? 'File exists and is accessible' : 'File does not exist',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      } catch (error) {
        logger.error('Error during test_connection execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { error: safe.message, code: safe.code, target: args.target },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 4. Tool: sync_source
  registerTool(
    'sync_source',
    'Ingests and synchronizes one or more external data sources (local document file, public website URL, or GitHub repository), extracts factual claims with exact line provenance, idempotently updates SQLite storage, and triggers automatic contradiction discovery. Mutating and idempotent operation. Supports single source ingestion or concurrent batch synchronization.',
    {
      connector: z
        .string()
        .describe(
          'The external source connector to synchronize (document for local files, website for URLs, github for repositories)',
        ),
      source: z
        .string()
        .optional()
        .describe(
          'Source locator: absolute/relative file path for document, public URL for website, or "owner/repo" for GitHub',
        ),
      input: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Structured connector input object (e.g. { filePath: "..." }) for flexible invocation',
        ),
      sourceName: z
        .string()
        .optional()
        .describe('Optional human-readable friendly label for the source'),
      subject: z
        .string()
        .optional()
        .describe(
          'Subject entity name for extracted claims (defaults to filename or repository name)',
        ),
      environment: z
        .string()
        .optional()
        .describe(
          'Target environment context for extracted claims (e.g. "production", "staging", "development")',
        ),
      scope: z
        .string()
        .optional()
        .describe('Scope of the document or claims (e.g. "system", "component", "file")'),
      sourceRole: z
        .string()
        .optional()
        .describe(
          'Role of the source in system architecture (e.g. "specification", "configuration", "documentation", "deployment")',
        ),
      branch: z
        .string()
        .optional()
        .describe('Optional branch or tag name when syncing GitHub repositories'),
      runDiscovery: z
        .boolean()
        .optional()
        .describe(
          'Whether to automatically trigger incremental contradiction discovery on touched claims after sync (default: true)',
        ),
      batch: z
        .array(
          z.object({
            connector: z.string(),
            input: z.record(z.string(), z.unknown()),
          }),
        )
        .optional()
        .describe(
          'Optional batch array of source requests to synchronize concurrently with failure isolation',
        ),
    },
    async (args) => {
      try {
        checkScope('sync', options);
        metricsService.recordToolCall('sync_source');
        if (!options.syncService) {
          throw new Error('SyncService is not configured on this server instance');
        }

        if (!['document', 'website', 'github'].includes(args.connector)) {
          throw new NotFoundError('Connector', args.connector);
        }

        if (args.input && !args.source) {
          args.source =
            (args.input.filePath as string) ||
            (args.input.url as string) ||
            (args.input.owner && args.input.repo ? `${args.input.owner}/${args.input.repo}` : '') ||
            '';
        }

        if (args.batch && args.batch.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const summary = await options.syncService.syncSources(args.batch as any, {
            runDiscoveryAfterSync: args.runDiscovery ?? true,
          });
          return {
            isError:
              summary.sourcesFailed === summary.sourcesRequested && summary.sourcesRequested > 0,
            content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
          };
        }

        let input: Record<string, unknown>;
        if (args.input) {
          input = args.input;
        } else if (args.connector === 'github') {
          const parts = (args.source || '').split('/');
          input = {
            owner: parts[0] || '',
            repo: parts[1] || '',
            branch: args.branch,
          };
        } else if (args.connector === 'website') {
          input = {
            url: args.source || '',
            sourceName: args.sourceName,
            subject: args.subject,
            scope: args.scope,
            environment: args.environment,
          };
        } else {
          input = {
            filePath: args.source || '',
            sourceName: args.sourceName,
            subject: args.subject,
            scope: args.scope,
            environment: args.environment,
            sourceRole: args.sourceRole,
          };
        }

        const summary = await options.syncService.syncSource(args.connector, input, {
          runDiscoveryAfterSync: args.runDiscovery ?? true,
        });

        metricsService.recordSync(
          summary.status === 'completed',
          summary.claimsCreated,
          summary.contradictionsFound ?? 0,
        );

        return {
          isError: summary.status === 'failed',
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
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
                { error: safe.message, code: safe.code, source: args.source },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 5. Tool: scan_contradictions
  registerTool(
    'scan_contradictions',
    'Discovers conflicting and inconsistent factual assertions across connected sources. Can scan the entire database, or scope the scan to a specific source, file, or single claim. Uses deterministic candidate grouping, entity resolution, and value comparison algorithms to detect and persist contradictions without duplicates. Mutating and idempotent.',
    {
      sourceId: z
        .string()
        .optional()
        .describe(
          'Scope scan to claims originating from a specific source ID, file path, or repository name',
        ),
      claimId: z
        .string()
        .optional()
        .describe(
          'Scope scan to a single claim by ID, testing it against all eligible candidate claims',
        ),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum confidence threshold between 0.0 and 1.0 (default: 0.35)'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of contradiction results to return (default: 50)'),
      includeDismissed: z
        .boolean()
        .optional()
        .describe(
          'Whether to include previously dismissed contradictions in output (default: false)',
        ),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('scan_contradictions');
        if (!options.discoveryService) {
          throw new Error('DiscoveryService is not configured on this server instance');
        }

        let summary;
        if (args.claimId) {
          summary = options.discoveryService.scanClaim(args.claimId, {
            minConfidence: args.minConfidence,
          });
        } else if (args.sourceId) {
          summary = options.discoveryService.scanSource(args.sourceId, {
            minConfidence: args.minConfidence,
            limit: args.limit,
            includeDismissed: args.includeDismissed,
          });
        } else {
          summary = options.discoveryService.scanAllClaims({
            limit: args.limit,
            minConfidence: args.minConfidence,
            includeDismissed: args.includeDismissed,
          });
        }

        return {
          isError: false,
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
        };
      } catch (error) {
        logger.error('Error during scan_contradictions execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: safe.message, code: safe.code }, null, 2),
            },
          ],
        };
      }
    },
  );

  // 6. Tool: analyze_claim_pair
  registerTool(
    'analyze_claim_pair',
    'Performs deep comparative analysis between two factual claims to determine whether they contradict each other. Evaluates semantic meaning, value differences, numeric/temporal ranges, and contextual dimensions (environment divergence, scope, source roles). Returns contradiction classification, severity, confidence score, and detailed explanation. Read-only operation.',
    {
      claimAId: z.string().min(1).describe('The unique ID of the first claim'),
      claimBId: z.string().min(1).describe('The unique ID of the second claim'),
      explainContext: z
        .boolean()
        .optional()
        .describe(
          'Whether to include detailed contextual relationship dimensions such as SemVer compatibility and role authority (default: true)',
        ),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('analyze_claim_pair');
        if (!options.analysisService) {
          throw new Error('AnalysisService is not configured on this server instance');
        }

        const analysis = options.analysisService.analyzeClaimPair(args.claimAId, args.claimBId);
        let result: Record<string, unknown> = { ...analysis };

        if (args.explainContext !== false) {
          const relationship = options.analysisService.explainClaimRelationship(
            args.claimAId,
            args.claimBId,
          );
          result = {
            ...result,
            relationship: relationship.relationship,
            divergenceDimensions: relationship.divergenceDimensions,
            analysisStatus: relationship.analysisStatus,
            isContradiction: relationship.isContradiction,
            contextFactors: relationship.contextFactors,
            contextExplanation: relationship.explanation,
          };
        }

        return {
          isError: false,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
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

  // 7. Tool: list_claims
  registerTool(
    'list_claims',
    'Queries stored factual assertions and claims extracted from connected sources with flexible filtering by subject, predicate, source, environment, and value type. Read-only operation. Use this tool to explore known facts, find subjects with multiple assertions, or inspect extracted data.',
    {
      subject: z
        .string()
        .optional()
        .describe('Filter by claim subject entity name (e.g. "UserAuthService", "API Gateway")'),
      predicate: z
        .string()
        .optional()
        .describe(
          'Filter by property/predicate name (e.g. "node_version", "min_ram", "http_port")',
        ),
      sourceId: z.string().optional().describe('Filter by originating source identifier'),
      environment: z
        .string()
        .optional()
        .describe('Filter by environment context (e.g. "production", "development")'),
      valueType: z
        .string()
        .optional()
        .describe(
          'Filter by value type (e.g. "quantity", "version", "status", "date", "price", "configuration")',
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of claims to return (default: 50)'),
      offset: z.number().int().nonnegative().optional().describe('Pagination offset (default: 0)'),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('list_claims');
        if (!options.dbManager) {
          throw new Error('DatabaseManager is not configured on this server instance');
        }

        const claims = options.dbManager.listClaims({
          subject: args.subject,
          predicate: args.predicate,
          sourceId: args.sourceId,
          environment: args.environment,
          valueType: args.valueType,
          limit: args.limit ?? 50,
          offset: args.offset,
        });

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ count: claims.length, claims }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during list_claims execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: safe.message, code: safe.code }, null, 2),
            },
          ],
        };
      }
    },
  );

  // 8. Tool: get_claim
  registerTool(
    'get_claim',
    'Retrieves complete details for a single factual claim by ID, including its subject, predicate, current and normalized values, provenance evidence, originating source metadata, and chronological historical value transitions over time. Read-only operation.',
    {
      claimId: z.string().min(1).describe('The unique ID of the claim to retrieve'),
      includeHistory: z
        .boolean()
        .optional()
        .describe(
          'Whether to include full chronological value transitions and superseded historical values (default: true)',
        ),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('get_claim');
        if (!options.dbManager) {
          throw new Error('DatabaseManager is not configured on this server instance');
        }

        const claim = options.dbManager.getClaimById(args.claimId);
        if (!claim) {
          throw new NotFoundError('Claim', args.claimId);
        }

        const source = options.dbManager.getSourceById(claim.sourceId);
        const history =
          args.includeHistory !== false ? options.dbManager.getClaimHistory(args.claimId) : [];

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { claim, source, historyCount: history.length, history },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Error during get_claim execution', { error: String(error) });
        const safe = toSafeError(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { error: safe.message, code: safe.code, claimId: args.claimId },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 9. Tool: list_contradictions
  registerTool(
    'list_contradictions',
    'Queries stored contradiction records from the database with filtering by resolution status, severity level, contradiction type, and confidence score. Returns enriched contradiction records with associated claim summaries and originating source details. Read-only operation. Use this tool to prioritize and triage conflicts.',
    {
      status: z
        .enum(ContradictionStatuses)
        .optional()
        .describe('Filter by contradiction lifecycle status (OPEN, REVIEWED, RESOLVED, DISMISSED)'),
      severity: z
        .enum(ContradictionSeverities)
        .optional()
        .describe('Filter by severity level (LOW, MEDIUM, HIGH, CRITICAL)'),
      type: z.string().optional().describe('Filter by contradiction classification type string'),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Filter by minimum confidence threshold between 0.0 and 1.0'),
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
        metricsService.recordToolCall('list_contradictions');
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
              text: JSON.stringify({ count: enriched.length, contradictions: enriched }, null, 2),
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
              text: JSON.stringify({ error: safe.message, code: safe.code }, null, 2),
            },
          ],
        };
      }
    },
  );

  // 10. Tool: get_contradiction
  registerTool(
    'get_contradiction',
    'Retrieves complete details of a single contradiction record by ID, including full representations of both conflicting claims, originating source metadata, exact line evidence snippets, and chronological audit trail of all review and resolution actions. Read-only operation.',
    {
      contradictionId: z
        .string()
        .min(1)
        .describe('The unique ID of the contradiction record to retrieve'),
      includeAuditHistory: z
        .boolean()
        .optional()
        .describe(
          'Whether to include the full chronological review and resolution audit trail (default: true)',
        ),
    },
    async (args) => {
      try {
        metricsService.recordToolCall('get_contradiction');
        if (!options.dbManager) {
          throw new Error('DatabaseManager is not configured on this server instance');
        }

        const details = options.dbManager.getContradictionWithDetails(args.contradictionId);
        if (!details) {
          throw new NotFoundError('Contradiction', args.contradictionId);
        }

        const auditTrail =
          args.includeAuditHistory !== false && reviewService
            ? reviewService.getContradictionHistory(args.contradictionId)
            : [];

        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ...details, auditTrailCount: auditTrail.length, auditTrail },
                null,
                2,
              ),
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
                { error: safe.message, code: safe.code, contradictionId: args.contradictionId },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // 11. Tool: advise_resolution
  registerTool(
    'advise_resolution',
    'Generates deterministic authority, freshness, and evidence comparison between conflicting claims to advise an AI agent or human reviewer on which claim likely represents current truth and recommended remediation steps. Read-only deterministic calculation.',
    {
      contradictionId: z
        .string()
        .min(1)
        .describe('The unique ID of the contradiction record to analyze for resolution advice'),
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
          content: [{ type: 'text' as const, text: JSON.stringify(advice, null, 2) }],
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
                { error: safe.message, code: safe.code, contradictionId: args.contradictionId },
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
    'Updates the lifecycle status and audit trail of a contradiction record. Supports marking as REVIEWED, resolving as RESOLVED with an authoritative chosen claim, dismissing as DISMISSED (acceptable divergence), or reopening back to OPEN. Preserves an immutable audit trail of reviewer identity, decision reason, and timestamp. Mutating operation.',
    {
      contradictionId: z
        .string()
        .min(1)
        .describe('The unique ID of the contradiction record to update'),
      action: z
        .enum(['RESOLVE', 'REVIEW', 'DISMISS', 'REOPEN'])
        .optional()
        .default('RESOLVE')
        .describe(
          'Lifecycle action to perform: RESOLVE (accepts authoritative claim), REVIEW (marks reviewed), DISMISS (marks acceptable divergence), REOPEN (reopens back to OPEN) (default: RESOLVE)',
        ),
      actor: z
        .string()
        .optional()
        .describe(
          'Name, email, or agent identifier performing the lifecycle action (defaults to resolvedBy if provided)',
        ),
      resolvedBy: z
        .string()
        .optional()
        .describe('Legacy parameter: Name or identifier of the resolver when action is RESOLVE'),
      reason: z
        .string()
        .optional()
        .describe(
          'Detailed explanation justifying the decision (required for RESOLVE and DISMISS)',
        ),
      chosenClaimId: z
        .string()
        .optional()
        .describe('ID of the claim accepted as authoritative (optional for RESOLVE action)'),
      notes: z.string().optional().describe('Additional triage notes or reviewer findings'),
    },
    async (args) => {
      try {
        const action = args.action || 'RESOLVE';
        const actor = args.actor || args.resolvedBy || 'reviewer';
        const requiredScope = action === 'RESOLVE' ? 'resolve' : 'review';
        checkScope(requiredScope, options);
        metricsService.recordToolCall('resolve_contradiction');
        if (!reviewService) {
          throw new Error('ReviewService is not configured on this server instance');
        }

        let updated;
        switch (action) {
          case 'REVIEW':
            updated = reviewService.reviewContradiction(args.contradictionId, {
              reviewedBy: actor,
              notes: args.notes,
            });
            break;
          case 'RESOLVE':
            updated = reviewService.resolveContradiction(args.contradictionId, {
              resolvedBy: actor,
              reason: args.reason || 'Resolved with authoritative claim selection',
              chosenClaimId: args.chosenClaimId,
              notes: args.notes,
            });
            break;
          case 'DISMISS':
            updated = reviewService.dismissContradiction(args.contradictionId, {
              dismissedBy: actor,
              reason: args.reason || 'Dismissed as acceptable divergence',
              notes: args.notes,
            });
            break;
          case 'REOPEN':
            updated = reviewService.reopenContradiction(args.contradictionId, {
              reopenedBy: actor,
              reason: args.reason,
              notes: args.notes,
            });
            break;
        }

        return {
          isError: false,
          content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }],
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
                { error: safe.message, code: safe.code, contradictionId: args.contradictionId },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // ==========================================
  // BACKWARDS COMPATIBILITY ROUTING SHIM
  // Transparently dispatches legacy tool invocations
  // ==========================================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).setToolRequestHandlers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRequestHandlers = (server.server as any)._requestHandlers;
  const canonicalCallHandler = rawRequestHandlers.get('tools/call');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawRequestHandlers.set('tools/call', async (request: any, ctx: any) => {
    const toolName = request.params?.name;
    const args = request.params?.arguments || {};

    if (toolName === 'health_check') {
      request.params.name = 'check_health';
    } else if (toolName === 'list_connectors') {
      request.params.name = 'list_sources';
    } else if (toolName === 'test_github_connection') {
      if (!args.owner || !args.repo) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: 'owner and repo parameters are required', code: 'VALIDATION_ERROR' },
                null,
                2,
              ),
            },
          ],
        };
      }
      request.params.name = 'test_connection';
      request.params.arguments = {
        connector: 'github',
        target: `${args.owner}/${args.repo}`,
        branch: args.branch,
      };
    } else if (toolName === 'sync_document') {
      request.params.name = 'sync_source';
      request.params.arguments = {
        connector: 'document',
        source: args.filePath,
        sourceName: args.sourceName,
        subject: args.subject,
        scope: args.scope,
        environment: args.environment,
        sourceRole: args.sourceRole,
        runDiscovery: args.runDiscovery,
      };
    } else if (toolName === 'sync_website') {
      request.params.name = 'sync_source';
      request.params.arguments = {
        connector: 'website',
        source: args.url,
        sourceName: args.sourceName,
        runDiscovery: args.runDiscovery,
      };
    } else if (toolName === 'sync_github_repository') {
      request.params.name = 'sync_source';
      request.params.arguments = {
        connector: 'github',
        source: `${args.owner}/${args.repo}`,
        branch: args.branch,
        runDiscovery: args.runDiscovery,
      };
    } else if (toolName === 'sync_sources') {
      request.params.name = 'sync_source';
      request.params.arguments = {
        connector: 'document',
        source: 'batch',
        batch: args.sources,
        runDiscovery: args.runDiscovery,
      };
    } else if (toolName === 'scan_for_contradictions') {
      request.params.name = 'scan_contradictions';
      request.params.arguments = {
        limit: args.limit,
        minConfidence: args.minConfidence,
        includeDismissed: args.includeDismissed,
      };
    } else if (toolName === 'scan_claim_for_contradictions') {
      request.params.name = 'scan_contradictions';
      request.params.arguments = {
        claimId: args.claimId,
        minConfidence: args.minConfidence,
      };
    } else if (toolName === 'scan_source_for_contradictions') {
      request.params.name = 'scan_contradictions';
      request.params.arguments = {
        sourceId: args.sourceId,
        minConfidence: args.minConfidence,
        limit: args.limit,
        includeDismissed: args.includeDismissed,
      };
    } else if (toolName === 'explain_claim_relationship') {
      request.params.name = 'analyze_claim_pair';
      request.params.arguments = {
        claimAId: args.claimAId,
        claimBId: args.claimBId,
        explainContext: true,
      };
    } else if (toolName === 'review_contradiction') {
      request.params.name = 'resolve_contradiction';
      request.params.arguments = {
        contradictionId: args.contradictionId,
        action: 'REVIEW',
        actor: args.reviewedBy,
        notes: args.notes,
      };
    } else if (toolName === 'dismiss_contradiction') {
      request.params.name = 'resolve_contradiction';
      request.params.arguments = {
        contradictionId: args.contradictionId,
        action: 'DISMISS',
        actor: args.dismissedBy || 'reviewer',
        reason: args.reason || 'Dismissed via legacy call',
        notes: args.notes,
      };
    } else if (toolName === 'reopen_contradiction') {
      request.params.name = 'resolve_contradiction';
      request.params.arguments = {
        contradictionId: args.contradictionId,
        action: 'REOPEN',
        actor: args.reopenedBy || 'reviewer',
        reason: args.reason,
        notes: args.notes,
      };
    } else if (toolName === 'get_contradiction_history') {
      request.params.name = 'get_contradiction';
      request.params.arguments = {
        contradictionId: args.contradictionId,
        includeAuditHistory: true,
      };
    } else if (toolName === 'get_claim_history') {
      request.params.name = 'get_claim';
      request.params.arguments = {
        claimId: args.claimId,
        includeHistory: true,
      };
    }

    return canonicalCallHandler(request, ctx);
  });

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
      argsSchema: z
        .object({
          contradictionId: z
            .string()
            .optional()
            .describe('ID of the contradiction to investigate (optional)'),
        })
        .optional()
        .default({}),
    },
    async (args) => {
      const id = args?.contradictionId;
      const targetText = id ? `contradiction record '${id}'` : 'open contradiction records';
      const step1 = id
        ? `1. Call 'get_contradiction' with contradictionId='${id}'.`
        : `1. Call 'list_contradictions' with status='OPEN' to identify target contradiction IDs, then inspect them via 'get_contradiction'.`;

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please investigate ${targetText} using Contradiction MCP tools:\n${step1}\n2. Inspect the conflicting claims and their originating sources.\n3. Call 'analyze_claim_pair' to analyze contextual dimensions (environment, scope, roles, ranges).\n4. Call 'advise_resolution' to assess authority and freshness scoring.\n5. Recommend or execute 'resolve_contradiction' with justified reasoning.`,
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
      argsSchema: z
        .object({
          sourceName: z
            .string()
            .optional()
            .describe('Name or identifier of the source repository or document (optional)'),
        })
        .optional()
        .default({}),
    },
    async (args) => {
      const source = args?.sourceName;
      const sourceTarget = source ? `for source '${source}'` : 'across all registered sources';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Review consistency ${sourceTarget}:\n1. Run 'list_sources' to review registered data sources.\n2. Run 'scan_contradictions' to discover any newly introduced discrepancies.\n3. Query 'list_contradictions' filtered by status='OPEN'.\n4. For each high or critical contradiction, review the conflicting evidence snippets and recommend updates.`,
            },
          },
        ],
      };
    },
  );

  return server;
}
