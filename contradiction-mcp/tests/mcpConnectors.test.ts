import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { HealthService } from '../src/services/healthService.js';
import { AnalysisService } from '../src/services/analysisService.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';
import { ConnectorRegistry } from '../src/connectors/connectorRegistry.js';
import { SyncService } from '../src/connectors/syncService.js';
import { GitHubConnector } from '../src/connectors/github/githubConnector.js';
import { GitHubClient } from '../src/connectors/github/githubClient.js';
import { GitHubExtractor } from '../src/connectors/github/githubExtractor.js';
import { GitHubNormalizer } from '../src/connectors/github/githubNormalizer.js';
import { createMcpServer } from '../src/server.js';
import { InMemoryTransport, Client } from '@modelcontextprotocol/client';
import { loadConfig } from '../src/config/env.js';

const testConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  LOG_LEVEL: 'error',
  SERVER_NAME: 'contradiction-mcp-connector-test',
  SERVER_VERSION: '0.1.0',
});

describe('MCP Connectors Protocol Integration Tests', () => {
  let dbManager: DatabaseManager;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();

    const healthService = new HealthService(dbManager, testConfig);
    const analysisService = new AnalysisService(dbManager);
    const discoveryService = new DiscoveryService(dbManager);

    const registry = new ConnectorRegistry();

    // Mock client for testing MCP protocol without external network dependencies
    const githubClient = new GitHubClient();
    githubClient.getRepository = async (owner, repo) => ({
      id: 999,
      name: repo,
      full_name: `${owner}/${repo}`,
      owner: { login: owner },
      private: false,
      html_url: `https://github.com/${owner}/${repo}`,
      description: 'Test repository for MCP connector tools',
      default_branch: 'main',
    });
    githubClient.getReadme = async (_owner, repo) => ({
      path: 'README.md',
      content: `# ${repo}\nRequires Node.js 18. Runs on port 3000.`,
      url: `https://github.com/mock/${repo}/blob/main/README.md`,
      sha: 'sha-readme',
      size: 50,
    });
    githubClient.getFileContent = async (_owner, repo, filePath) => {
      if (filePath === 'package.json') {
        return {
          path: 'package.json',
          content: JSON.stringify({
            name: repo,
            engines: { node: '22' },
          }),
          url: `https://github.com/mock/${repo}/blob/main/package.json`,
          sha: 'sha-pkg',
          size: 60,
        };
      }
      return null;
    };
    githubClient.getWorkflowFiles = async () => [];

    const githubConnector = new GitHubConnector(
      githubClient,
      new GitHubExtractor(),
      new GitHubNormalizer(),
    );
    registry.register(githubConnector);

    const syncService = new SyncService(dbManager, registry, discoveryService);

    server = createMcpServer({
      healthService,
      analysisService,
      discoveryService,
      dbManager,
      connectorRegistry: registry,
      syncService,
      name: testConfig.SERVER_NAME,
      version: testConfig.SERVER_VERSION,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'mcp-connector-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    dbManager.close();
  });

  it('lists registered connectors with list_connectors tool', async () => {
    const res = await client.callTool({
      name: 'list_connectors',
      arguments: {},
    });

    expect(res.isError).toBe(false);
    const content = res.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);

    expect(data.count).toBe(1);
    expect(data.connectors[0].type).toBe('github');
    expect(data.connectors[0].displayName).toBe('GitHub Repository');
    expect(data.connectors[0].capabilities.supportsIncrementalSync).toBe(true);
  });

  it('tests connection to a repository with test_github_connection tool', async () => {
    const res = await client.callTool({
      name: 'test_github_connection',
      arguments: {
        owner: 'test-org',
        repo: 'test-repo',
      },
    });

    expect(res.isError).toBe(false);
    const content = res.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);

    expect(data.accessible).toBe(true);
    expect(data.targetFound).toBe(true);
    expect(data.details.fullName).toBe('test-org/test-repo');
  });

  it('synchronizes a GitHub repository and executes contradiction discovery with sync_github_repository', async () => {
    const syncRes = await client.callTool({
      name: 'sync_github_repository',
      arguments: {
        owner: 'test-org',
        repo: 'node-conflict-repo',
        runDiscovery: true,
      },
    });

    expect(syncRes.isError).toBe(false);
    const syncContent = syncRes.content as Array<{ type: string; text: string }>;
    const syncData = JSON.parse(syncContent[0].text);

    expect(syncData.status).toBe('completed');
    expect(syncData.source.externalId).toBe('github:test-org/node-conflict-repo');
    expect(syncData.claimsCreated).toBeGreaterThanOrEqual(3); // README node:18, README port:3000, package.json node:22
    expect(syncData.newContradictions).toBeGreaterThanOrEqual(1); // Node 18 vs 22 conflict!

    // Verify contradiction is retrievable via list_contradictions
    const listRes = await client.callTool({
      name: 'list_contradictions',
      arguments: {
        status: 'OPEN',
      },
    });

    expect(listRes.isError).toBe(false);
    const listContent = listRes.content as Array<{ type: string; text: string }>;
    const listData = JSON.parse(listContent[0].text);

    expect(listData.count).toBeGreaterThanOrEqual(1);
    const versionMismatch = listData.contradictions.find(
      (c: { contradictionType: string }) => c.contradictionType === 'VERSION_MISMATCH',
    );
    expect(versionMismatch).toBeDefined();
    expect(versionMismatch.claims.claimA).toBeDefined();
    expect(versionMismatch.claims.claimB).toBeDefined();
  });
});
