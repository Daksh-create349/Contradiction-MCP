import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { DatabaseManager } from '../src/storage/database.js';
import { HealthService } from '../src/services/healthService.js';
import { AnalysisService } from '../src/services/analysisService.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';
import { ConnectorRegistry } from '../src/connectors/connectorRegistry.js';
import { DocumentConnector } from '../src/connectors/document/documentConnector.js';
import { SyncService } from '../src/connectors/syncService.js';
import { ReviewService } from '../src/services/reviewService.js';
import { ResolutionAdvisor } from '../src/intelligence/resolutionAdvisor.js';
import { createMcpServer } from '../src/server.js';
import { EnvConfig, config as defaultConfig } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Real-World Multi-Format Architecture Ingestion (MD, DOCX, JSON)', () => {
  let dbManager: DatabaseManager;
  let client: Client;
  let mcpServer: ReturnType<typeof createMcpServer>;

  const fixturesDir = path.resolve(__dirname, 'fixtures/real_world');
  const mdPath = path.join(fixturesDir, 'service_runbook.md');
  const jsonPath = path.join(fixturesDir, 'service_config.json');
  const docxPath = path.join(fixturesDir, 'enterprise_architecture.docx');

  const testConfig: EnvConfig = {
    ...defaultConfig,
    NODE_ENV: 'test',
    HTTP_PORT: 3000,
    HTTP_HOST: '127.0.0.1',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'error',
    SERVER_NAME: 'contradiction-mcp-realworld',
    SERVER_VERSION: '0.3.0',
  };

  beforeEach(async () => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();

    const healthService = new HealthService(dbManager, testConfig);
    const analysisService = new AnalysisService(dbManager);
    const discoveryService = new DiscoveryService(dbManager);
    const reviewService = new ReviewService(dbManager);
    const resolutionAdvisor = new ResolutionAdvisor();

    const connectorRegistry = new ConnectorRegistry();
    connectorRegistry.register(new DocumentConnector());

    const syncService = new SyncService(dbManager, connectorRegistry, discoveryService);

    mcpServer = createMcpServer({
      healthService,
      analysisService,
      discoveryService,
      dbManager,
      connectorRegistry,
      syncService,
      reviewService,
      resolutionAdvisor,
      name: testConfig.SERVER_NAME,
      version: testConfig.SERVER_VERSION,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);

    client = new Client({ name: 'test-architect-agent', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await mcpServer.close();
    dbManager.close();
  });

  it('verifies TDQS quality standards: exactly 12 tools, uniform verb_noun naming, no duplicates', async () => {
    const listRes = await client.listTools();
    expect(listRes.tools).toHaveLength(12);

    const toolNames = listRes.tools.map((t) => t.name);
    const expectedCanonicalTools = [
      'check_health',
      'list_sources',
      'test_connection',
      'sync_source',
      'scan_contradictions',
      'analyze_claim_pair',
      'list_claims',
      'get_claim',
      'list_contradictions',
      'get_contradiction',
      'advise_resolution',
      'resolve_contradiction',
    ];

    expect(toolNames.sort()).toEqual(expectedCanonicalTools.sort());

    // Verify all tool names adhere to strict verb_noun pattern
    for (const name of toolNames) {
      expect(name).toMatch(/^(check|list|test|sync|scan|analyze|get|advise|resolve)_[a-z_]+$/);
    }

    // Verify each tool has non-empty description and typed schema
    for (const tool of listRes.tools) {
      expect(tool.description).toBeTruthy();
      expect((tool.description || '').length).toBeGreaterThan(20);
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('ingests real MD, JSON, and DOCX files, detects architectural contradictions across formats', async () => {
    // 1. Ingest operations runbook (Markdown)
    const syncMdRes = await client.callTool({
      name: 'sync_source',
      arguments: {
        connector: 'document',
        source: mdPath,
        sourceName: 'UserAuthService Runbook',
        subject: 'UserAuthService',
        environment: 'production',
        sourceRole: 'documentation',
        runDiscovery: true,
      },
    });
    expect(syncMdRes.isError).toBe(false);
    const mdSummary = JSON.parse((syncMdRes.content as Array<{ text: string }>)[0].text);
    expect(mdSummary.status).toBe('completed');
    expect(mdSummary.claimsCreated).toBe(9);

    // 2. Ingest production deployment config (JSON)
    const syncJsonRes = await client.callTool({
      name: 'sync_source',
      arguments: {
        connector: 'document',
        source: jsonPath,
        sourceName: 'Production Config',
        subject: 'UserAuthService',
        environment: 'production',
        sourceRole: 'deployment',
        runDiscovery: true,
      },
    });
    expect(syncJsonRes.isError).toBe(false);
    const jsonSummary = JSON.parse((syncJsonRes.content as Array<{ text: string }>)[0].text);
    expect(jsonSummary.status).toBe('completed');
    expect(jsonSummary.claimsCreated).toBe(9);
    // Discovers contradictions with Runbook (node 18 vs 20, min_ram 8GB vs 16GB, db pg14 vs pg15, timeout 15s vs 30s)
    expect(jsonSummary.newContradictions).toBeGreaterThanOrEqual(4);

    // 3. Ingest legacy architecture specification (real DOCX Word table)
    const syncDocxRes = await client.callTool({
      name: 'sync_source',
      arguments: {
        connector: 'document',
        source: docxPath,
        sourceName: 'Enterprise Architecture Spec',
        subject: 'UserAuthService',
        environment: 'production',
        sourceRole: 'specification',
        runDiscovery: true,
      },
    });
    expect(syncDocxRes.isError).toBe(false);
    const docxSummary = JSON.parse((syncDocxRes.content as Array<{ text: string }>)[0].text);
    expect(docxSummary.status).toBe('completed');
    expect(docxSummary.claimsCreated).toBe(9);
    expect(docxSummary.newContradictions).toBeGreaterThanOrEqual(5);

    // 4. Query claims with list_claims tool
    const claimsRes = await client.callTool({
      name: 'list_claims',
      arguments: {
        subject: 'UserAuthService',
        predicate: 'node_version',
      },
    });
    expect(claimsRes.isError).toBe(false);
    const claimsData = JSON.parse((claimsRes.content as Array<{ text: string }>)[0].text);
    expect(claimsData.count).toBe(3); // 18.19.0 (MD), 20.11.0 (JSON), 16.20.0 (DOCX)
    const values = claimsData.claims.map((c: { value: string }) => c.value);
    expect(values).toContain('18.19.0');
    expect(values).toContain('20.11.0');
    expect(values).toContain('16.20.0');

    // 5. Query single claim with get_claim tool
    const firstClaimId = claimsData.claims[0].id;
    const getClaimRes = await client.callTool({
      name: 'get_claim',
      arguments: {
        claimId: firstClaimId,
        includeHistory: true,
      },
    });
    expect(getClaimRes.isError).toBe(false);
    const claimDetail = JSON.parse((getClaimRes.content as Array<{ text: string }>)[0].text);
    expect(claimDetail.claim.id).toBe(firstClaimId);
    expect(claimDetail.source).toBeDefined();

    // 6. List detected contradictions across MD, JSON, DOCX
    const listContrasRes = await client.callTool({
      name: 'list_contradictions',
      arguments: {
        status: 'OPEN',
      },
    });
    expect(listContrasRes.isError).toBe(false);
    const contrasData = JSON.parse((listContrasRes.content as Array<{ text: string }>)[0].text);
    expect(contrasData.count).toBeGreaterThanOrEqual(5);

    // Find node_version contradiction
    const nodeContra = contrasData.contradictions.find(
      (c: any) =>
        c.claims.claimA.predicate === 'node_version' ||
        c.claims.claimB.predicate === 'node_version',
    );
    expect(nodeContra).toBeDefined();

    // 7. Analyze claim pair directly with analyze_claim_pair
    const pairAnalysisRes = await client.callTool({
      name: 'analyze_claim_pair',
      arguments: {
        claimAId: nodeContra.claims.claimA.id,
        claimBId: nodeContra.claims.claimB.id,
        explainContext: true,
      },
    });
    expect(pairAnalysisRes.isError).toBe(false);
    const pairAnalysis = JSON.parse((pairAnalysisRes.content as Array<{ text: string }>)[0].text);
    expect(pairAnalysis.isContradiction).toBe(true);
    expect(pairAnalysis.contradictionType).toBe('VERSION_MISMATCH');

    // 8. Generate resolution advice with advise_resolution
    const adviseRes = await client.callTool({
      name: 'advise_resolution',
      arguments: {
        contradictionId: nodeContra.id,
      },
    });
    expect(adviseRes.isError).toBe(false);
    const advice = JSON.parse((adviseRes.content as Array<{ text: string }>)[0].text);
    expect(['claimA', 'claimB']).toContain(advice.likelyCurrentClaim);
    expect(advice.reason).toBeTruthy();

    // 9. Resolve contradiction with resolve_contradiction
    const winningKey = advice.likelyCurrentClaim as 'claimA' | 'claimB';
    const chosenClaimId = nodeContra.claims[winningKey].id;

    const resolveRes = await client.callTool({
      name: 'resolve_contradiction',
      arguments: {
        contradictionId: nodeContra.id,
        action: 'RESOLVE',
        actor: 'lead-devops-engineer',
        reason: advice.reason,
        chosenClaimId,
      },
    });
    expect(resolveRes.isError).toBe(false);
    const resolvedData = JSON.parse((resolveRes.content as Array<{ text: string }>)[0].text);
    expect(resolvedData.status).toBe('RESOLVED');

    // 10. Verify audit history in get_contradiction
    const getContraRes = await client.callTool({
      name: 'get_contradiction',
      arguments: {
        contradictionId: nodeContra.id,
        includeAuditHistory: true,
      },
    });
    expect(getContraRes.isError).toBe(false);
    const contraDetail = JSON.parse((getContraRes.content as Array<{ text: string }>)[0].text);
    expect(contraDetail.contradiction.status).toBe('RESOLVED');
    expect(contraDetail.auditTrailCount).toBeGreaterThanOrEqual(1);
    expect(contraDetail.auditTrail[0].action).toBe('RESOLVED');
    expect(contraDetail.auditTrail[0].performedBy).toBe('lead-devops-engineer');
  });

  it('demonstrates seamless backwards compatibility for legacy tool calls', async () => {
    // 1. health_check legacy call routes to check_health
    const legacyHealth = await client.callTool({
      name: 'health_check',
      arguments: {},
    });
    expect(legacyHealth.isError).toBe(false);
    const healthJson = JSON.parse((legacyHealth.content as Array<{ text: string }>)[0].text);
    expect(healthJson.status).toBe('healthy');

    // 2. sync_document legacy call routes to sync_source
    const legacySync = await client.callTool({
      name: 'sync_document',
      arguments: {
        filePath: jsonPath,
        sourceName: 'Legacy JSON Sync',
        subject: 'UserAuthService',
        environment: 'production',
        sourceRole: 'deployment',
      },
    });
    expect(legacySync.isError).toBe(false);
    const syncJson = JSON.parse((legacySync.content as Array<{ text: string }>)[0].text);
    expect(syncJson.status).toBe('completed');

    // 3. scan_for_contradictions legacy call routes to scan_contradictions
    const legacyScan = await client.callTool({
      name: 'scan_for_contradictions',
      arguments: {
        limit: 10,
      },
    });
    expect(legacyScan.isError).toBe(false);
    const scanJson = JSON.parse((legacyScan.content as Array<{ text: string }>)[0].text);
    expect(scanJson.status).toBe('completed');
  });
});
