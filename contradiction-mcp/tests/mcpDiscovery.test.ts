import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { HealthService } from '../src/services/healthService.js';
import { AnalysisService } from '../src/services/analysisService.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';
import { createMcpServer } from '../src/server.js';
import { InMemoryTransport, Client } from '@modelcontextprotocol/client';
import { loadConfig } from '../src/config/env.js';

const testConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  LOG_LEVEL: 'error',
  SERVER_NAME: 'contradiction-mcp-discovery-test',
  SERVER_VERSION: '0.1.0',
});

describe('MCP Discovery Protocol Integration & Real End-to-End Test', () => {
  let dbManager: DatabaseManager;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();

    const healthService = new HealthService(dbManager, testConfig);
    const analysisService = new AnalysisService(dbManager);
    const discoveryService = new DiscoveryService(dbManager);

    server = createMcpServer({
      healthService,
      analysisService,
      discoveryService,
      dbManager,
      name: testConfig.SERVER_NAME,
      version: testConfig.SERVER_VERSION,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'mcp-discovery-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    dbManager.close();
  });

  it('executes real end-to-end discovery scenario via MCP tools', async () => {
    // 1. Seed sources
    const srcReadme = dbManager.createSource({
      name: 'Repository Readme',
      type: 'github',
      trustScore: 0.95,
    });
    const srcManifest = dbManager.createSource({
      name: 'Kubernetes Manifest',
      type: 'document',
      trustScore: 0.9,
    });

    // Scenario A: Node 20 vs Node 22 (Contradiction: VERSION_MISMATCH)
    const claimA1 = dbManager.createClaim({
      sourceId: srcReadme.id,
      subject: 'Backend API Gateway',
      predicate: 'node_version',
      value: 'Node 20',
      valueType: 'version',
    });
    dbManager.createClaim({
      sourceId: srcManifest.id,
      subject: 'backend-api-gateway',
      predicate: 'node-version',
      value: 'Node 22',
      valueType: 'version',
    });

    // Scenario B: ₹70,000 vs ₹75,000 (Contradiction: VALUE_MISMATCH)
    dbManager.createClaim({
      sourceId: srcReadme.id,
      subject: 'Server Hardware Quotation',
      predicate: 'total_cost',
      value: '₹70,000',
      valueType: 'price',
    });
    dbManager.createClaim({
      sourceId: srcManifest.id,
      subject: 'Server Hardware Quotation',
      predicate: 'total_cost',
      value: '₹75,000',
      valueType: 'price',
    });

    // Scenario C: Same price written differently but equivalent (No contradiction)
    dbManager.createClaim({
      sourceId: srcReadme.id,
      subject: 'License Subscription',
      predicate: 'price',
      value: '1000 USD',
      valueType: 'price',
    });
    dbManager.createClaim({
      sourceId: srcManifest.id,
      subject: 'License Subscription',
      predicate: 'price',
      value: '$1,000.00',
      valueType: 'price',
    });

    // Scenario D: Unrelated subjects (No contradiction)
    dbManager.createClaim({
      sourceId: srcReadme.id,
      subject: 'Marketing Landing Page',
      predicate: 'theme',
      value: 'dark',
      valueType: 'string',
    });

    // Scenario E: Same subject but unrelated predicates (No contradiction)
    dbManager.createClaim({
      sourceId: srcReadme.id,
      subject: 'Internal Cache',
      predicate: 'max_memory',
      value: '4GB',
      valueType: 'string',
    });
    dbManager.createClaim({
      sourceId: srcManifest.id,
      subject: 'Internal Cache',
      predicate: 'port',
      value: '6379',
      valueType: 'string',
    });

    // 2. Call scan_for_contradictions tool via MCP protocol
    const scanResult = await client.callTool({
      name: 'scan_for_contradictions',
      arguments: {
        limit: 10,
        minConfidence: 0.5,
      },
    });

    expect(scanResult.isError).toBeFalsy();
    const scanContent = scanResult.content as Array<{ type: string; text: string }>;
    const scanData = JSON.parse(scanContent[0].text);

    expect(scanData.status).toBe('completed');
    expect(scanData.contradictionsFound).toBe(2);
    expect(scanData.newContradictions).toBe(2);
    expect(scanData.existingContradictions).toBe(0);

    const types = scanData.contradictions.map(
      (c: { contradictionType: string }) => c.contradictionType,
    );
    expect(types).toContain('VERSION_MISMATCH');
    expect(types).toContain('VALUE_MISMATCH');

    // 3. Re-run scan_for_contradictions and verify duplicate prevention
    const reScanResult = await client.callTool({
      name: 'scan_for_contradictions',
      arguments: {},
    });

    const reScanData = JSON.parse(
      (reScanResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(reScanData.contradictionsFound).toBe(2);
    expect(reScanData.newContradictions).toBe(0);
    expect(reScanData.existingContradictions).toBe(2);

    // 4. Call list_contradictions tool via MCP protocol
    const listResult = await client.callTool({
      name: 'list_contradictions',
      arguments: {
        status: 'OPEN',
      },
    });

    expect(listResult.isError).toBeFalsy();
    const listData = JSON.parse(
      (listResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(listData.count).toBe(2);
    expect(listData.contradictions).toHaveLength(2);

    const firstItem = listData.contradictions[0];
    expect(firstItem.id).toBeDefined();
    expect(firstItem.claims.claimA).toBeDefined();
    expect(firstItem.sources.sourceA).toBeDefined();

    // 5. Call get_contradiction tool via MCP protocol
    const getResult = await client.callTool({
      name: 'get_contradiction',
      arguments: {
        contradictionId: firstItem.id,
      },
    });

    expect(getResult.isError).toBeFalsy();
    const getData = JSON.parse(
      (getResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(getData.contradiction.id).toBe(firstItem.id);
    expect(getData.claimA).toBeDefined();
    expect(getData.claimB).toBeDefined();
    expect(getData.sourceA).toBeDefined();

    // 6. Call scan_claim_for_contradictions tool via MCP protocol for claimA1
    const scanClaimResult = await client.callTool({
      name: 'scan_claim_for_contradictions',
      arguments: {
        claimId: claimA1.id,
      },
    });

    expect(scanClaimResult.isError).toBeFalsy();
    const claimScanData = JSON.parse(
      (scanClaimResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(claimScanData.claimId).toBe(claimA1.id);
    expect(claimScanData.contradictionsFound).toBe(1);
    expect(claimScanData.results[0].contradictionType).toBe('VERSION_MISMATCH');
  });

  it('safely returns error on non-existent contradiction ID in get_contradiction', async () => {
    const result = await client.callTool({
      name: 'get_contradiction',
      arguments: {
        contradictionId: 'missing-contradiction-uuid-9999',
      },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.code).toBe('NOT_FOUND');
    expect(parsed.error).toContain('not found');
  });
});
