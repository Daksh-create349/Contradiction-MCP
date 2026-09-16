import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { InMemoryTransport, Client } from '@modelcontextprotocol/client';
import { DatabaseManager } from '../src/storage/database.js';
import { HealthService } from '../src/services/healthService.js';
import { AnalysisService } from '../src/services/analysisService.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';
import { ConnectorRegistry } from '../src/connectors/connectorRegistry.js';
import { DocumentConnector } from '../src/connectors/document/documentConnector.js';
import { SyncService } from '../src/connectors/syncService.js';
import { createMcpServer } from '../src/server.js';
import { loadConfig } from '../src/config/env.js';

describe('MCP Client Harness: Tools, Resources, & Prompts Verification', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-harness-'));
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();

    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'error',
      SERVER_NAME: 'test-harness',
      SERVER_VERSION: '0.1.0',
    });

    const healthService = new HealthService(dbManager, config);
    const analysisService = new AnalysisService(dbManager);
    const discoveryService = new DiscoveryService(dbManager);
    const connectorRegistry = new ConnectorRegistry();
    const docConnector = new DocumentConnector();
    connectorRegistry.register(docConnector);
    const syncService = new SyncService(dbManager, connectorRegistry, discoveryService);

    server = createMcpServer({
      healthService,
      analysisService,
      discoveryService,
      dbManager,
      connectorRegistry,
      syncService,
      name: 'test-harness',
      version: '0.1.0',
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'harness-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    dbManager.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('lists all registered tools, resources, and prompts through MCP protocol', async () => {
    // 1. Tool listing
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name);

    expect(toolsResult.tools).toHaveLength(12);
    expect(toolNames).toContain('contradiction.health.check');
    expect(toolNames).toContain('contradiction.sources.list');
    expect(toolNames).toContain('contradiction.sources.test');
    expect(toolNames).toContain('contradiction.sources.sync');
    expect(toolNames).toContain('contradiction.conflicts.scan');
    expect(toolNames).toContain('contradiction.claims.analyze');
    expect(toolNames).toContain('contradiction.claims.list');
    expect(toolNames).toContain('contradiction.claims.get');
    expect(toolNames).toContain('contradiction.conflicts.list');
    expect(toolNames).toContain('contradiction.conflicts.get');
    expect(toolNames).toContain('contradiction.conflicts.advise');
    expect(toolNames).toContain('contradiction.conflicts.resolve');

    // 2. Resource listing
    const resourcesResult = await client.listResources();
    expect(resourcesResult.resources.length).toBeGreaterThan(0);
    const metricsResource = resourcesResult.resources.find((r) => r.uri === 'health://metrics');
    expect(metricsResource).toBeDefined();

    // 3. Prompt listing
    const promptsResult = await client.listPrompts();
    const promptNames = promptsResult.prompts.map((p) => p.name);
    expect(promptNames).toContain('investigate_contradiction');
    expect(promptNames).toContain('review_source_consistency');
  });

  it('reads the health://metrics resource over MCP protocol', async () => {
    const resourceResult = await client.readResource({ uri: 'health://metrics' });
    expect(resourceResult.contents.length).toBe(1);

    const content = resourceResult.contents[0] as { text: string };
    const parsed = JSON.parse(content.text);
    expect(parsed.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(parsed.totalToolInvocations).toBeDefined();
  });

  it('gets investigate_contradiction prompt with arguments', async () => {
    const promptResult = await client.getPrompt({
      name: 'investigate_contradiction',
      arguments: { contradictionId: 'test-contra-uuid-123' },
    });

    expect(promptResult.messages.length).toBe(1);
    const msg = promptResult.messages[0];
    expect(msg.role).toBe('user');
    expect((msg.content as { text: string }).text).toContain('test-contra-uuid-123');
  });

  it('gets investigate_contradiction and review_source_consistency prompts without arguments', async () => {
    const p1 = await client.getPrompt({
      name: 'investigate_contradiction',
    });
    expect(p1.messages.length).toBe(1);
    expect((p1.messages[0].content as { text: string }).text).toContain(
      'open contradiction records',
    );

    const p2 = await client.getPrompt({
      name: 'review_source_consistency',
    });
    expect(p2.messages.length).toBe(1);
    expect((p2.messages[0].content as { text: string }).text).toContain(
      'across all registered sources',
    );
  });

  it('executes sync_document, gets contradiction, and advises resolution via MCP client', async () => {
    // Write two documents with conflicting claims
    const doc1 = path.join(tempDir, 'service_deploy.json');
    const doc2 = path.join(tempDir, 'service_docs.md');

    fs.writeFileSync(doc1, JSON.stringify({ port: 8080 }));
    fs.writeFileSync(doc2, 'port: 3000');

    // Sync doc 1
    const sync1 = await client.callTool({
      name: 'sync_document',
      arguments: {
        filePath: doc1,
        subject: 'service',
        environment: 'production',
        sourceRole: 'deployment',
      },
    });
    expect(sync1.isError).toBeFalsy();

    // Sync doc 2
    const sync2 = await client.callTool({
      name: 'sync_document',
      arguments: {
        filePath: doc2,
        subject: 'service',
        environment: 'production',
        sourceRole: 'documentation',
      },
    });
    expect(sync2.isError).toBeFalsy();

    // List contradictions
    const listRes = await client.callTool({
      name: 'list_contradictions',
      arguments: {},
    });
    const parsedList = JSON.parse((listRes.content as Array<{ text: string }>)[0].text);
    expect(parsedList.count).toBe(1);

    const contradictionId = parsedList.contradictions[0].id;

    // Advise resolution
    const adviseRes = await client.callTool({
      name: 'advise_resolution',
      arguments: { contradictionId },
    });
    const advice = JSON.parse((adviseRes.content as Array<{ text: string }>)[0].text);
    expect(['claimA', 'claimB']).toContain(advice.likelyCurrentClaim);
    // deployment spec (8080) wins over documentation (3000)
    const winningKey = advice.likelyCurrentClaim as 'claimA' | 'claimB';
    const winningClaim = parsedList.contradictions[0].claims[winningKey];
    expect(winningClaim.value).toBe('8080');

    // Resolve contradiction
    const resolveRes = await client.callTool({
      name: 'resolve_contradiction',
      arguments: {
        contradictionId,
        resolvedBy: 'ai-operator',
        reason: advice.reason,
        chosenClaimId: winningClaim.id,
      },
    });
    const resolved = JSON.parse((resolveRes.content as Array<{ text: string }>)[0].text);
    expect(resolved.status).toBe('RESOLVED');
  });
});
