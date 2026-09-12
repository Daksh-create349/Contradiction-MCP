import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { HealthService } from '../src/services/healthService.js';
import { AnalysisService } from '../src/services/analysisService.js';
import { createMcpServer } from '../src/server.js';
import { InMemoryTransport, Client } from '@modelcontextprotocol/client';
import { loadConfig } from '../src/config/env.js';

const testConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  LOG_LEVEL: 'error',
  SERVER_NAME: 'contradiction-mcp-test',
  SERVER_VERSION: '0.1.0',
});

describe('MCP analyze_claim_pair Tool Integration', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();
  });

  afterEach(() => {
    dbManager.close();
  });

  it('calls analyze_claim_pair through MCP protocol and detects a real contradiction', async () => {
    const healthService = new HealthService(dbManager, testConfig);
    const analysisService = new AnalysisService(dbManager);
    const server = createMcpServer({
      healthService,
      analysisService,
      name: testConfig.SERVER_NAME,
      version: testConfig.SERVER_VERSION,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    // 1. Seed two real sources in the database
    const sourceA = dbManager.createSource({
      name: 'GitHub Repository Readme',
      type: 'github',
      uri: 'https://github.com/org/repo/blob/main/README.md',
      trustScore: 0.9,
    });

    const sourceB = dbManager.createSource({
      name: 'Dockerfile Specification',
      type: 'document',
      uri: 'https://github.com/org/repo/blob/main/Dockerfile',
      trustScore: 0.95,
    });

    // 2. Seed two conflicting claims
    const claimA = dbManager.createClaim({
      sourceId: sourceA.id,
      subject: 'Backend API Service',
      predicate: 'Node.js Runtime',
      value: 'Node 22',
      valueType: 'version',
      confidence: 0.95,
    });

    const claimB = dbManager.createClaim({
      sourceId: sourceB.id,
      subject: 'backend-api-service',
      predicate: 'node_js_runtime',
      value: 'Node 18',
      valueType: 'version',
      confidence: 0.9,
    });

    // 3. Invoke analyze_claim_pair tool via MCP protocol
    const toolResult = await client.callTool({
      name: 'analyze_claim_pair',
      arguments: {
        claimAId: claimA.id,
        claimBId: claimB.id,
      },
    });

    expect(toolResult.isError).toBeFalsy();
    const content = toolResult.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);

    const firstItem = content[0];
    expect(firstItem.type).toBe('text');

    const parsed = JSON.parse(firstItem.text);
    expect(parsed.isContradiction).toBe(true);
    expect(parsed.contradictionType).toBe('VERSION_MISMATCH');
    expect(parsed.severity).toBe('HIGH');
    expect(parsed.confidence).toBeGreaterThan(0.7);
    expect(parsed.explanation).toContain('Backend API Service');
    expect(parsed.claims.claimA.id).toBe(claimA.id);
    expect(parsed.claims.claimB.id).toBe(claimB.id);
    expect(parsed.sources.sourceA.id).toBe(sourceA.id);
    expect(parsed.sources.sourceB.id).toBe(sourceB.id);

    await client.close();
    await server.close();
  });

  it('safely handles missing claim ID through MCP protocol with error response', async () => {
    const healthService = new HealthService(dbManager, testConfig);
    const analysisService = new AnalysisService(dbManager);
    const server = createMcpServer({
      healthService,
      analysisService,
      name: testConfig.SERVER_NAME,
      version: testConfig.SERVER_VERSION,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const toolResult = await client.callTool({
      name: 'analyze_claim_pair',
      arguments: {
        claimAId: 'non-existent-claim-uuid-11111',
        claimBId: 'non-existent-claim-uuid-22222',
      },
    });

    expect(toolResult.isError).toBe(true);
    const content = toolResult.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);

    const parsed = JSON.parse(content[0].text);
    expect(parsed.code).toBe('NOT_FOUND');
    expect(parsed.error).toContain('not found');

    await client.close();
    await server.close();
  });
});
