import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { HealthService } from '../src/services/healthService.js';
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

describe('Health & Database Operational Tests', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = new DatabaseManager(':memory:');
  });

  afterEach(() => {
    dbManager.close();
  });

  it('initializes database and creates initial schema correctly', () => {
    dbManager.initialize();
    const rawDb = dbManager.getRawDb();
    expect(rawDb.open).toBe(true);

    const tables = rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('sources');
    expect(tableNames).toContain('claims');
    expect(tableNames).toContain('contradictions');
  });

  it('returns connected status on database health check when database is operational', () => {
    dbManager.initialize();
    const health = dbManager.checkHealth();

    expect(health.status).toBe('connected');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.tablesCount).toBeGreaterThanOrEqual(3);
    expect(health.error).toBeUndefined();
  });

  it('fails database health check when database is unavailable or closed', () => {
    dbManager.initialize();
    // Intentionally close database to simulate failure
    dbManager.close();

    const health = dbManager.checkHealth();
    expect(health.status).toBe('unreachable');
    expect(health.error).toBeDefined();
    expect(health.error).toContain('closed or not initialized');
  });

  it('healthService produces comprehensive structured operational report', async () => {
    dbManager.initialize();
    const healthService = new HealthService(dbManager, testConfig);
    const report = await healthService.getHealth();

    expect(report.status).toBe('healthy');
    expect(report.server.name).toBe('contradiction-mcp-test');
    expect(report.server.version).toBe('0.1.0');
    expect(report.server.environment).toBe('test');
    expect(report.mcp.implementation).toBe('@modelcontextprotocol/server');
    expect(report.mcp.protocolVersion).toBe('2026-07-28');
    expect(report.mcp.status).toBe('ready');
    expect(report.database.status).toBe('connected');
    expect(typeof report.timestamp).toBe('string');
  });

  it('executes MCP health_check tool over in-memory transport and returns structured health data', async () => {
    dbManager.initialize();
    const healthService = new HealthService(dbManager, testConfig);
    const server = createMcpServer({
      healthService,
      name: testConfig.SERVER_NAME,
      version: testConfig.SERVER_VERSION,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const toolResult = await client.callTool({
      name: 'health_check',
      arguments: {},
    });

    expect(toolResult.isError).toBeFalsy();
    const content = toolResult.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);

    const firstItem = content[0];
    expect(firstItem.type).toBe('text');

    const parsed = JSON.parse(firstItem.text);
    expect(parsed.status).toBe('healthy');
    expect(parsed.server.name).toBe('contradiction-mcp-test');
    expect(parsed.database.status).toBe('connected');
    expect(parsed.database.tablesCount).toBeGreaterThanOrEqual(3);

    await client.close();
    await server.close();
  });

  it('executes MCP health_check tool when database is down and reports unhealthy status', async () => {
    dbManager.initialize();
    const healthService = new HealthService(dbManager, testConfig);
    const server = createMcpServer({
      healthService,
      name: testConfig.SERVER_NAME,
      version: testConfig.SERVER_VERSION,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    // Close the database to force unhealthy state
    dbManager.close();

    const toolResult = await client.callTool({
      name: 'health_check',
      arguments: {},
    });

    expect(toolResult.isError).toBe(true);
    const content = toolResult.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);

    const firstItem = content[0];
    expect(firstItem.type).toBe('text');

    const parsed = JSON.parse(firstItem.text);
    expect(parsed.status).toBe('unhealthy');
    expect(parsed.database.status).toBe('unreachable');
    expect(parsed.database.error).toBeDefined();

    await client.close();
    await server.close();
  });
});
