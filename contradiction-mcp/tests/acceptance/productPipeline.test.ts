import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager } from '../../src/storage/database.js';
import { ConnectorRegistry } from '../../src/connectors/connectorRegistry.js';
import { DocumentConnector } from '../../src/connectors/document/documentConnector.js';
import { WebsiteConnector } from '../../src/connectors/website/websiteConnector.js';
import { GitHubConnector } from '../../src/connectors/github/githubConnector.js';
import { GitHubClient } from '../../src/connectors/github/githubClient.js';
import { SyncService } from '../../src/connectors/syncService.js';
import { DiscoveryService } from '../../src/discovery/discoveryService.js';
import { ReviewService } from '../../src/services/reviewService.js';
import { ResolutionAdvisor } from '../../src/intelligence/resolutionAdvisor.js';

describe('Product Acceptance Pipeline: Multi-Source Contradiction Lifecycle', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;
  let registry: ConnectorRegistry;
  let discoveryService: DiscoveryService;
  let syncService: SyncService;
  let reviewService: ReviewService;
  let advisor: ResolutionAdvisor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-pipeline-'));
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();

    registry = new ConnectorRegistry();

    // 1. Register Document Connector
    const docConnector = new DocumentConnector();
    registry.register(docConnector);

    // 2. Register Website Connector
    const webConnector = new WebsiteConnector();
    registry.register(webConnector);

    // 3. Register GitHub Connector (offline-safe client)
    const githubClient = new GitHubClient();
    const githubConnector = new GitHubConnector(githubClient);
    registry.register(githubConnector);

    discoveryService = new DiscoveryService(dbManager);
    syncService = new SyncService(dbManager, registry, discoveryService);
    reviewService = new ReviewService(dbManager);
    advisor = new ResolutionAdvisor();
  });

  afterEach(() => {
    dbManager.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs complete multi-source pipeline: ingestion -> claims -> contradiction -> authority/freshness -> review -> resolution -> idempotency', async () => {
    // -------------------------------------------------------------
    // SOURCE 1: Production Deployment Manifest (Document Connector)
    // -------------------------------------------------------------
    const deployDocPath = path.join(tempDir, 'production_manifest.json');
    fs.writeFileSync(
      deployDocPath,
      JSON.stringify({
        node_version: '22',
        service_port: 8080,
        cluster_region: 'us-east-1',
      }),
    );

    const deploySync = await syncService.syncSource(
      'document',
      {
        filePath: deployDocPath,
        sourceName: 'Production Manifest',
        subject: 'API Server',
        scope: 'deployment',
        environment: 'production',
        sourceRole: 'deployment',
      },
      { runDiscoveryAfterSync: true },
    );
    expect(deploySync.status).toBe('completed');
    expect(deploySync.claimsCreated).toBe(3);

    // -------------------------------------------------------------
    // SOURCE 2: Documentation Guide (Document Connector - Markdown)
    // Outdated: claims node_version is 18
    // -------------------------------------------------------------
    const readmePath = path.join(tempDir, 'README.md');
    fs.writeFileSync(
      readmePath,
      `# Architecture Guide
node_version: 18
service_port: 8080
cluster_region: us-east-1
`,
    );

    const docSync = await syncService.syncSource(
      'document',
      {
        filePath: readmePath,
        sourceName: 'Documentation README',
        subject: 'API Server',
        scope: 'deployment',
        environment: 'production',
        sourceRole: 'documentation',
      },
      { runDiscoveryAfterSync: true },
    );
    expect(docSync.status).toBe('completed');
    expect(docSync.claimsCreated).toBe(3);

    // -------------------------------------------------------------
    // 1. Verify Provenance & Stored Claims
    // -------------------------------------------------------------
    const allClaims = dbManager.listClaims();
    expect(allClaims.length).toBe(6);

    for (const c of allClaims) {
      expect(c.metadata).toBeDefined();
      expect(c.observedAt).toBeInstanceOf(Date);
      expect(c.externalId).toBeDefined();
    }

    // -------------------------------------------------------------
    // 2. Verify Genuine Contradictions vs Compatible Values
    // - node_version (22 vs 18): GENUINE CONTRADICTION
    // - service_port (8080 vs 8080): EQUIVALENT (NO CONTRADICTION)
    // - cluster_region (us-east-1 vs us-east-1): EQUIVALENT (NO CONTRADICTION)
    // -------------------------------------------------------------
    const contradictions = dbManager.listContradictions();
    expect(contradictions.length).toBe(1);

    const nodeContra = contradictions[0];
    expect(nodeContra.contradictionType).toBe('VERSION_MISMATCH');
    expect(nodeContra.severity).toBe('HIGH');
    expect(nodeContra.explanation).toContain('mutually exclusive');

    // -------------------------------------------------------------
    // 3. Authority & Freshness Analysis
    // -------------------------------------------------------------
    const details = dbManager.getContradictionWithDetails(nodeContra.id);
    expect(details).toBeDefined();

    const advice = advisor.adviseResolution(
      details!.contradiction,
      details!.claimA,
      details!.claimB,
      details!.sourceA,
      details!.sourceB,
    );

    const deployClaim = details!.claimA.value === '22' ? details!.claimA : details!.claimB;
    const winningKey = advice.likelyCurrentClaim as 'claimA' | 'claimB';
    const winningClaim = winningKey === 'claimA' ? details!.claimA : details!.claimB;

    expect(winningClaim.value).toBe('22');
    expect(winningClaim.id).toBe(deployClaim.id);
    expect(advice.authorityComparison.winner).toBe(winningKey);
    expect(advice.recommendedAction).toContain("('22')");

    // -------------------------------------------------------------
    // 4. Review & Resolution Workflow
    // -------------------------------------------------------------
    // Review
    const reviewed = reviewService.reviewContradiction(nodeContra.id, {
      reviewedBy: 'qa-agent',
      notes: 'Investigating documentation drift',
    });
    expect(reviewed.status).toBe('REVIEWED');

    // Resolve
    const resolved = reviewService.resolveContradiction(nodeContra.id, {
      resolvedBy: 'lead-architect',
      reason: advice.reason,
      chosenClaimId: deployClaim.id,
      notes: 'Issue #1042 created to update README to Node 22',
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.chosenClaimId).toBe(deployClaim.id);
    expect(resolved.resolvedAt).toBeInstanceOf(Date);

    // Audit History check
    const history = reviewService.getContradictionHistory(nodeContra.id);
    expect(history.length).toBe(2);
    expect(history[0].action).toBe('RESOLVED');
    expect(history[1].action).toBe('REVIEWED');

    // -------------------------------------------------------------
    // 5. Repeat Synchronization & Discovery Idempotency Verification
    // -------------------------------------------------------------
    const repeatSync = await syncService.syncSource(
      'document',
      {
        filePath: deployDocPath,
        sourceName: 'Production Manifest',
      },
      { runDiscoveryAfterSync: true },
    );

    // No new claims created; zero duplicate records
    expect(repeatSync.claimsCreated).toBe(0);
    expect(dbManager.listClaims().length).toBe(6);

    // Re-scanning does NOT create duplicate contradictions
    const rescan = discoveryService.scanAllClaims();
    expect(rescan.newContradictions).toBe(0);
    expect(dbManager.listContradictions().length).toBe(1);
  });
});
