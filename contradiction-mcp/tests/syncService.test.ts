import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { ConnectorRegistry } from '../src/connectors/connectorRegistry.js';
import { SyncService } from '../src/connectors/syncService.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';
import { GitHubConnector } from '../src/connectors/github/githubConnector.js';
import { GitHubClient } from '../src/connectors/github/githubClient.js';
import { GitHubExtractor } from '../src/connectors/github/githubExtractor.js';
import { GitHubNormalizer } from '../src/connectors/github/githubNormalizer.js';
import { GitHubRepoResponse } from '../src/connectors/github/githubTypes.js';

describe('SyncService & Ingestion Pipeline', () => {
  let dbManager: DatabaseManager;
  let registry: ConnectorRegistry;
  let discoveryService: DiscoveryService;
  let syncService: SyncService;

  beforeEach(() => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();

    registry = new ConnectorRegistry();
    discoveryService = new DiscoveryService(dbManager);
    syncService = new SyncService(dbManager, registry, discoveryService);
  });

  afterEach(() => {
    dbManager.close();
  });

  it('synchronizes a repository and creates source and claims', async () => {
    // Setup mock GitHub client
    const repoMock: GitHubRepoResponse = {
      id: 101,
      name: 'demo-app',
      full_name: 'test-user/demo-app',
      owner: { login: 'test-user' },
      private: false,
      html_url: 'https://github.com/test-user/demo-app',
      description: 'Demo app',
      default_branch: 'main',
    };

    const pkgContent = JSON.stringify({
      name: 'demo-app',
      engines: { node: '20.0.0' },
    });

    const client = new GitHubClient();
    client.getRepository = async () => repoMock;
    client.getReadme = async () => null;
    client.getFileContent = async (_o, _r, path) => {
      if (path === 'package.json') {
        return {
          path: 'package.json',
          content: pkgContent,
          url: 'https://github.com/test-user/demo-app/blob/main/package.json',
          sha: 'sha-pkg',
          size: pkgContent.length,
        };
      }
      return null;
    };
    client.getWorkflowFiles = async () => [];

    const connector = new GitHubConnector(client, new GitHubExtractor(), new GitHubNormalizer());
    registry.register(connector);

    // Sync #1: First time
    const summary1 = await syncService.syncSource('github', {
      owner: 'test-user',
      repo: 'demo-app',
    });

    expect(summary1.status).toBe('completed');
    expect(summary1.source.externalId).toBe('github:test-user/demo-app');
    expect(summary1.claimsCreated).toBe(1);
    expect(summary1.claimsUpdated).toBe(0);

    const sourceInDb = dbManager.getSourceByExternalId('github:test-user/demo-app');
    expect(sourceInDb).not.toBeNull();
    expect(sourceInDb?.name).toBe('test-user/demo-app');

    const claimsInDb = dbManager.listClaims({ sourceId: sourceInDb!.id });
    expect(claimsInDb).toHaveLength(1);
    expect(claimsInDb[0].predicate).toBe('node_version');
    expect(claimsInDb[0].value).toBe('20.0.0');

    // Sync #2: Re-syncing same repository without changes (Idempotency)
    const summary2 = await syncService.syncSource('github', {
      owner: 'test-user',
      repo: 'demo-app',
    });

    expect(summary2.status).toBe('completed');
    expect(summary2.claimsCreated).toBe(0); // Zero duplicate claims
    expect(summary2.claimsUpdated).toBe(0);

    const claimsAfterResync = dbManager.listClaims({ sourceId: sourceInDb!.id });
    expect(claimsAfterResync).toHaveLength(1); // Still exactly 1 row
  });

  it('updates claim and records previous value in history when source content changes', async () => {
    let nodeVersion = '20.0.0';

    const repoMock: GitHubRepoResponse = {
      id: 102,
      name: 'versioned-app',
      full_name: 'test-user/versioned-app',
      owner: { login: 'test-user' },
      private: false,
      html_url: 'https://github.com/test-user/versioned-app',
      description: 'App with changing version',
      default_branch: 'main',
    };

    const client = new GitHubClient();
    client.getRepository = async () => repoMock;
    client.getReadme = async () => null;
    client.getFileContent = async () => ({
      path: 'package.json',
      content: JSON.stringify({ engines: { node: nodeVersion } }),
      url: 'https://github.com/test-user/versioned-app/blob/main/package.json',
      sha: 'sha-v1',
      size: 50,
    });
    client.getWorkflowFiles = async () => [];

    const connector = new GitHubConnector(client, new GitHubExtractor(), new GitHubNormalizer());
    registry.register(connector);

    // Sync 1: Node 20
    await syncService.syncSource('github', { owner: 'test-user', repo: 'versioned-app' });

    // Change version in upstream repo: Node 22
    nodeVersion = '22.0.0';

    // Sync 2: Node 22
    const summary2 = await syncService.syncSource('github', {
      owner: 'test-user',
      repo: 'versioned-app',
    });

    expect(summary2.claimsCreated).toBe(0);
    expect(summary2.claimsUpdated).toBe(1);

    const claim = dbManager.getClaimByExternalId(
      'github:test-user/versioned-app:package.json:node_version',
    );
    expect(claim).not.toBeNull();
    expect(claim?.value).toBe('22.0.0');
    expect(claim?.normalizedValue).toBe('22.0.0');

    // Provenance history tracks previous value
    const history = claim?.metadata.history as Array<{ previousValue: string }>;
    expect(history).toBeDefined();
    expect(history[0].previousValue).toBe('20.0.0');
  });

  it('automatically discovers contradictions between extracted files upon sync', async () => {
    // Repository with conflicting versions:
    // package.json says node: 22
    // Dockerfile says FROM node:18
    const repoMock: GitHubRepoResponse = {
      id: 103,
      name: 'conflict-app',
      full_name: 'test-user/conflict-app',
      owner: { login: 'test-user' },
      private: false,
      html_url: 'https://github.com/test-user/conflict-app',
      description: 'App with conflicting configs',
      default_branch: 'main',
    };

    const pkgContent = JSON.stringify({
      name: 'conflict-app',
      engines: { node: '22' },
    });

    const dockerContent = `
      FROM node:18-alpine
      EXPOSE 8080
      CMD ["node", "server.js"]
    `.trim();

    const client = new GitHubClient();
    client.getRepository = async () => repoMock;
    client.getReadme = async () => null;
    client.getFileContent = async (_o, _r, path) => {
      if (path === 'package.json') {
        return {
          path: 'package.json',
          content: pkgContent,
          url: 'https://github.com/test-user/conflict-app/blob/main/package.json',
          sha: 's1',
          size: pkgContent.length,
        };
      }
      if (path === 'Dockerfile') {
        return {
          path: 'Dockerfile',
          content: dockerContent,
          url: 'https://github.com/test-user/conflict-app/blob/main/Dockerfile',
          sha: 's2',
          size: dockerContent.length,
        };
      }
      return null;
    };
    client.getWorkflowFiles = async () => [];

    const connector = new GitHubConnector(client, new GitHubExtractor(), new GitHubNormalizer());
    registry.register(connector);

    const summary = await syncService.syncSource(
      'github',
      { owner: 'test-user', repo: 'conflict-app' },
      { runDiscoveryAfterSync: true },
    );

    expect(summary.status).toBe('completed');
    expect(summary.claimsCreated).toBe(3); // package.json node:22, docker node:18, docker port:8080
    expect(summary.newContradictions).toBeGreaterThanOrEqual(1);

    // Verify stored contradiction in SQLite
    const storedContradictions = dbManager.listContradictions();
    expect(storedContradictions.length).toBeGreaterThanOrEqual(1);

    const versionContradiction = storedContradictions.find(
      (c) => c.contradictionType === 'VERSION_MISMATCH',
    );
    expect(versionContradiction).toBeDefined();
    expect(versionContradiction?.explanation).toContain('22');
    expect(versionContradiction?.explanation).toContain('18');
  });
});
