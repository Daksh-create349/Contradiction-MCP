import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMcpServer } from '../../src/server.js';
import { HealthService } from '../../src/services/healthService.js';
import { DatabaseManager } from '../../src/storage/database.js';
import { loadConfig } from '../../src/config/env.js';
import { McpHttpServer } from '../../src/httpServer.js';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

describe('MCP Streamable HTTP Protocol Suite', () => {
  let dbManager: DatabaseManager;
  let healthService: HealthService;
  let httpServer: McpHttpServer;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();

    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      SERVER_NAME: 'Contradiction MCP',
      SERVER_VERSION: '0.1.0',
    });

    healthService = new HealthService(dbManager, config);
    const server = createMcpServer({ healthService, dbManager });

    httpServer = new McpHttpServer({
      server,
      healthService,
      port: 0,
      host: '127.0.0.1',
    });

    await httpServer.start();
    port = httpServer.getPort();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await httpServer.stop();
    dbManager.close();
  });

  it('serves liveness endpoint /health with healthy status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('healthy');
    expect(body.mcp.protocolVersion).toBe('2026-07-28');
    expect(body.mcp.implementation).toBe('@modelcontextprotocol/server');
  });

  it('serves readiness endpoint /ready with ready status', async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ready');
  });

  it('serves operational metrics on /metrics', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.uptimeSeconds).toBeDefined();
    expect(body.totalToolInvocations).toBeDefined();
  });

  it('handles MCP Streamable HTTP handshake and lists all registered tools', async () => {
    const clientTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new Client({ name: 'test-http-client', version: '1.0.0' });

    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(21);

    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain('health_check');
    expect(toolNames).toContain('analyze_claim_pair');
    expect(toolNames).toContain('scan_for_contradictions');
    expect(toolNames).toContain('list_contradictions');
    expect(toolNames).toContain('sync_document');
    expect(toolNames).toContain('sync_github_repository');
    expect(toolNames).toContain('resolve_contradiction');

    await client.close();
  });

  it('executes tools/call over Streamable HTTP transport', async () => {
    const clientTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new Client({ name: 'test-http-client', version: '1.0.0' });

    await client.connect(clientTransport);

    const callResult = (await client.callTool({
      name: 'health_check',
      arguments: {},
    })) as any;

    expect(callResult.isError).toBeFalsy();
    expect(callResult.content).toBeDefined();
    expect(callResult.content.length).toBeGreaterThanOrEqual(1);

    const parsed = JSON.parse(callResult.content[0].text);
    expect(parsed.status).toBe('healthy');
    expect(parsed.mcp.protocolVersion).toBe('2026-07-28');

    await client.close();
  });

  it('lists and reads resources over Streamable HTTP transport', async () => {
    const clientTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new Client({ name: 'test-http-client', version: '1.0.0' });

    await client.connect(clientTransport);

    const resources = await client.listResources();
    expect(resources.resources.length).toBeGreaterThanOrEqual(1);

    const metricsResource = resources.resources.find((r) => r.name === 'health-metrics');
    expect(metricsResource).toBeDefined();

    const readRes = await client.readResource({ uri: 'health://metrics' });
    expect(readRes.contents.length).toBe(1);
    expect(readRes.contents[0].mimeType).toBe('application/json');

    await client.close();
  });

  it('lists and gets prompts over Streamable HTTP transport', async () => {
    const clientTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new Client({ name: 'test-http-client', version: '1.0.0' });

    await client.connect(clientTransport);

    const prompts = await client.listPrompts();
    expect(prompts.prompts.length).toBeGreaterThanOrEqual(2);

    const prompt = await client.getPrompt({
      name: 'investigate_contradiction',
      arguments: { contradictionId: 'contra-uuid-1234' },
    });

    expect(prompt.messages).toBeDefined();
    expect(prompt.messages.length).toBe(1);
    expect((prompt.messages[0].content as any).text).toContain('contra-uuid-1234');

    await client.close();
  });

  it('enforces API key authentication when configured', async () => {
    const authedServer = createMcpServer({ healthService, dbManager });
    const authHttpServer = new McpHttpServer({
      server: authedServer,
      healthService,
      port: 0,
      host: '127.0.0.1',
      apiKey: 'secret-prod-token-123',
    });

    await authHttpServer.start();
    const authPort = authHttpServer.getPort();
    const authBaseUrl = `http://127.0.0.1:${authPort}`;

    try {
      // Unauthenticated request to /mcp
      const unauthRes = await fetch(`${authBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(unauthRes.status).toBe(401);

      // Authenticated request with Bearer token
      const authClientTransport = new StreamableHTTPClientTransport(new URL(`${authBaseUrl}/mcp`), {
        requestInit: {
          headers: {
            Authorization: 'Bearer secret-prod-token-123',
          },
        },
      });
      const authClient = new Client({ name: 'authed-client', version: '1.0.0' });
      await authClient.connect(authClientTransport);

      const tools = await authClient.listTools();
      expect(tools.tools.length).toBeGreaterThanOrEqual(21);

      await authClient.close();
    } finally {
      await authHttpServer.stop();
    }
  });
});
