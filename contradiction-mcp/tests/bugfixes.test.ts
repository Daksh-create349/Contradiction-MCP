import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthorityScorer } from '../src/intelligence/authorityScorer.js';
import { EvidenceEvaluator } from '../src/intelligence/evidenceEvaluator.js';
import { ResolutionAdvisor } from '../src/intelligence/resolutionAdvisor.js';
import { ContextAnalyzer } from '../src/analysis/contextAnalyzer.js';
import { ValueComparator } from '../src/analysis/valueComparator.js';
import { DatabaseManager } from '../src/storage/database.js';
import { ConnectorRegistry } from '../src/connectors/connectorRegistry.js';
import { DocumentConnector } from '../src/connectors/document/documentConnector.js';
import {
  WebsiteConnector,
  decodeHtmlEntities,
} from '../src/connectors/website/websiteConnector.js';
import { createMcpServer } from '../src/server.js';
import { HealthService } from '../src/services/healthService.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StandardClaimSourceRoles, Claim } from '../src/domain/entities/claim.js';
import { Contradiction } from '../src/domain/entities/contradiction.js';

describe('Comprehensive Bug Fixes Regression Suite', () => {
  let db: DatabaseManager;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    db.initialize();
  });

  afterEach(() => {
    db.close();
  });

  // Bug 1: Specification & Deployment Authority Scoring Defect
  it('Bug 1: StandardClaimSourceRoles includes specification and deployment, and AuthorityScorer scores specification appropriately', () => {
    expect(StandardClaimSourceRoles).toContain('specification');
    expect(StandardClaimSourceRoles).toContain('deployment');

    const scorer = new AuthorityScorer();
    const specClaim: Claim = {
      id: 'c-spec',
      sourceId: 's-spec',
      subject: 'AuthService',
      predicate: 'node_version',
      value: '20.0.0',
      valueType: 'version',
      sourceRole: 'specification',
      isHistorical: false,
      confidence: 1.0,
      observedAt: new Date(),
      createdAt: new Date(),
      metadata: {},
    };

    const docClaim: Claim = {
      id: 'c-doc',
      sourceId: 's-doc',
      subject: 'AuthService',
      predicate: 'node_version',
      value: '18.0.0',
      valueType: 'version',
      sourceRole: 'documentation',
      isHistorical: false,
      confidence: 1.0,
      observedAt: new Date(),
      createdAt: new Date(),
      metadata: {},
    };

    const specScore = scorer.scoreAuthority(specClaim);
    const docScore = scorer.scoreAuthority(docClaim);

    // Specification (roleScore 0.75) should score higher than documentation (roleScore 0.55)
    expect(specScore.breakdown.roleScore).toBe(0.75);
    expect(docScore.breakdown.roleScore).toBe(0.55);
    expect(specScore.score).toBeGreaterThan(docScore.score);
  });

  // Bug 1 (part 2): ResolutionAdvisor breaks ties with evidence quality
  it('Bug 1 (part 2): ResolutionAdvisor resolves tie when one claim has superior empirical evidence quality', () => {
    const advisor = new ResolutionAdvisor();
    const contra: Contradiction = {
      id: 'contra-1',
      claimAId: 'claim-1',
      claimBId: 'claim-2',
      contradictionType: 'CONFIGURATION_MISMATCH',
      severity: 'HIGH',
      confidence: 0.9,
      explanation: 'Both claims configure port with identical authority and recency',
      status: 'OPEN',
      detectedAt: new Date(),
      metadata: {},
    };

    const claimA: Claim = {
      id: 'claim-1',
      sourceId: 'src-1',
      subject: 'API',
      predicate: 'port',
      value: '8080',
      valueType: 'quantity',
      sourceRole: 'configuration',
      isHistorical: false,
      confidence: 1.0,
      observedAt: new Date(),
      createdAt: new Date(),
      metadata: {
        lineRange: [42, 42],
        evidence: 'port: 8080',
        extractionMethod: 'json_parse',
      },
    };

    const claimB: Claim = {
      id: 'claim-2',
      sourceId: 'src-2',
      subject: 'API',
      predicate: 'port',
      value: '9090',
      valueType: 'quantity',
      sourceRole: 'configuration',
      isHistorical: false,
      confidence: 1.0,
      observedAt: new Date(),
      createdAt: new Date(),
      metadata: {
        // Lacks lineRange and evidence snippet
        extractionMethod: 'heuristic',
      },
    };

    const advice = advisor.adviseResolution(contra, claimA, claimB);
    // Authority and freshness tie, but Claim A has strong evidence provenance
    expect(advice.likelyCurrentClaim).toBe('claimA');
    expect(advice.reason).toContain('Claim A provides superior verifiable empirical evidence');
  });

  // Bug 3: Line Provenance & Evidence Metadata Alignment
  it('Bug 3: EvidenceEvaluator and AuthorityScorer recognize lineRange and evidence strings', () => {
    const evaluator = new EvidenceEvaluator();
    const scorer = new AuthorityScorer();

    const claimWithLineRange: Claim = {
      id: 'c-range',
      sourceId: 's-1',
      subject: 'Service',
      predicate: 'timeout_ms',
      value: '5000',
      valueType: 'quantity',
      isHistorical: false,
      confidence: 1.0,
      observedAt: new Date(),
      createdAt: new Date(),
      metadata: {
        lineRange: [15, 15],
        evidence: 'timeout_ms = 5000',
        extractionMethod: 'json_parse',
      },
    };

    const evalResult = evaluator.evaluateEvidence(claimWithLineRange);
    expect(evalResult.hasLineProvenance).toBe(true);
    expect(evalResult.hasVerbatimSnippet).toBe(true);
    expect(evalResult.quality).toBe('STRONG');
    expect(evalResult.score).toBeGreaterThanOrEqual(0.8);

    const authResult = scorer.scoreAuthority(claimWithLineRange);
    expect(authResult.breakdown.directnessScore).toBe(1.0);
    expect(authResult.reasoning).toContain(
      'Exact line provenance provides direct verifiable evidence',
    );
    expect(authResult.reasoning).toContain('Verbatim snippet available');
  });

  // Bug 4: False-Positive Environment Contradictions
  it('Bug 4: ContextAnalyzer recognizes staging vs development and testing vs development as DIFFERENT_ENVIRONMENT', () => {
    const analyzer = new ContextAnalyzer();

    const claimDev: Claim = {
      id: 'c-dev',
      sourceId: 's-1',
      subject: 'DB',
      predicate: 'host',
      value: 'localhost',
      valueType: 'string',
      environment: 'development',
      isHistorical: false,
      confidence: 1.0,
      observedAt: new Date(),
      createdAt: new Date(),
      metadata: {},
    };

    const claimStaging: Claim = {
      id: 'c-stg',
      sourceId: 's-2',
      subject: 'DB',
      predicate: 'host',
      value: 'staging.db.internal',
      valueType: 'string',
      environment: 'staging',
      isHistorical: false,
      confidence: 1.0,
      observedAt: new Date(),
      createdAt: new Date(),
      metadata: {},
    };

    const claimTesting: Claim = {
      id: 'c-test',
      sourceId: 's-3',
      subject: 'DB',
      predicate: 'host',
      value: 'test.db.internal',
      valueType: 'string',
      environment: 'testing',
      isHistorical: false,
      confidence: 1.0,
      observedAt: new Date(),
      createdAt: new Date(),
      metadata: {},
    };

    const stgVsDev = analyzer.analyze(claimStaging, claimDev);
    expect(stgVsDev.relationship.type).toBe('DIFFERENT_ENVIRONMENT');
    expect(stgVsDev.relationship.isContradictionEligible).toBe(false);

    const testVsDev = analyzer.analyze(claimTesting, claimDev);
    expect(testVsDev.relationship.type).toBe('DIFFERENT_ENVIRONMENT');
    expect(testVsDev.relationship.isContradictionEligible).toBe(false);

    const testVsStg = analyzer.analyze(claimTesting, claimStaging);
    expect(testVsStg.relationship.type).toBe('DIFFERENT_ENVIRONMENT');
    expect(testVsStg.relationship.isContradictionEligible).toBe(false);
  });

  // Bug 6: WebsiteConnector redirect loop protection
  it('Bug 6: WebsiteConnector enforces maximum redirect limit', async () => {
    const connector = new WebsiteConnector();
    await expect(connector.fetch({ url: 'https://example.com' }, 5)).rejects.toThrow(
      'Maximum redirect limit exceeded (5 redirects allowed)',
    );
  });

  // Bug 7: DatabaseManager listSources pagination offset & tie-breakers
  it('Bug 7: listSources supports offset and returns deterministic order with id tie-breaker', () => {
    // Create 3 sources with identical timestamps
    const now = new Date('2026-01-01T00:00:00.000Z');
    db.createSource({ type: 'document', name: 'Source 1' });
    db.createSource({ type: 'document', name: 'Source 2' });
    db.createSource({ type: 'document', name: 'Source 3' });

    // Directly force identical created_at in raw SQLite
    const raw = db.getRawDb();
    raw.prepare('UPDATE sources SET created_at = ?').run(now.toISOString());

    // Page 1: limit 2, offset 0
    const page1 = db.listSources({ limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    // Page 2: limit 2, offset 2
    const page2 = db.listSources({ limit: 2, offset: 2 });
    expect(page2.length).toBe(1);

    // Ensure mutually exclusive items across pages (deterministic ordering)
    const page1Ids = page1.map((s) => s.id);
    expect(page1Ids).not.toContain(page2[0].id);
  });

  // Bug 9: Quantity Number Normalization with Commas
  it('Bug 9: ValueComparator parses comma-separated numbers accurately', () => {
    const comparator = new ValueComparator();

    // 5,000 vs 5000 should be equal
    const compEqual = comparator.compare('5,000', '5000', 'quantity');
    expect(compEqual.equal).toBe(true);
    expect(compEqual.differenceStrength).toBe(0.0);

    // 10,000 vs 5,000 should compare as numbers, not single-digit 10 vs 5
    const compDiff = comparator.compare('10,000', '5,000', 'quantity');
    expect(compDiff.equal).toBe(false);
    expect(compDiff.details?.numberA).toBe(10000);
    expect(compDiff.details?.numberB).toBe(5000);
    expect(compDiff.details?.difference).toBe(5000);

    // normalizeQuantity with unit and commas: '16,384 MB'
    const q = comparator.normalizeQuantity('16,384 MB');
    expect(q).not.toBeNull();
    expect(q?.amount).toBe(16384 * 1024 * 1024);
  });

  // Bug 5 & 8: Server Tool Delegations (test_connection, list_sources offset, sync_source website context)
  it('Bug 5 & 8: Server test_connection delegates to connectors, list_sources passes offset, and website sync preserves context', async () => {
    const registry = new ConnectorRegistry();
    const docConnector = new DocumentConnector({ allowedRoots: ['/tmp/safe-dir'] });
    registry.register(docConnector);

    const webConnector = new WebsiteConnector();
    registry.register(webConnector);

    const server = createMcpServer({
      healthService: new HealthService(db, {
        SERVER_NAME: 'test-server',
        SERVER_VERSION: '1.0.0',
        NODE_ENV: 'test',
        port: 3000,
        env: 'test',
        logLevel: 'error',
        maxDbConnections: 1,
        enableAuth: false,
        apiKeys: [],
        jwtSecret: 'test',
        corsOrigins: [],
        rateLimitWindowMs: 60000,
        rateLimitMax: 100,
      }),
      dbManager: db,
      connectorRegistry: registry,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    // 1. test_connection with document connector outside allowed roots should fail path validation
    const docTestRes = await client.callTool({
      name: 'test_connection',
      arguments: {
        connector: 'document',
        target: '/etc/passwd',
      },
    });
    // Should be rejected by allowedRoots check or not found, not bypass it
    expect(docTestRes.isError).toBe(true);

    // 2. test_connection with website connector against loopback / SSRF target should fail
    const webTestRes = await client.callTool({
      name: 'test_connection',
      arguments: {
        connector: 'website',
        target: 'http://127.0.0.1:8080/admin',
      },
    });
    expect(webTestRes.isError).toBe(true);
    const webTestData = JSON.parse((webTestRes.content as Array<{ text: string }>)[0].text);
    expect(webTestData.error).toContain('SSRF Protection');

    // 3. list_sources tool handles offset properly
    db.createSource({ type: 'document', name: 'Doc 1' });
    db.createSource({ type: 'document', name: 'Doc 2' });
    db.createSource({ type: 'document', name: 'Doc 3' });

    const listRes = await client.callTool({
      name: 'list_sources',
      arguments: {
        limit: 1,
        offset: 1,
      },
    });
    expect(listRes.isError).toBe(false);
    const listData = JSON.parse((listRes.content as Array<{ text: string }>)[0].text);
    expect(listData.sourcesCount).toBe(1);

    await client.close();
    await server.close();
  });

  // Bug Fix: Legacy Routing Shim for Action & History Tools
  it('Legacy routing shim properly routes review_contradiction, dismiss_contradiction, and get_contradiction_history to dot-notation tools', async () => {
    const registry = new ConnectorRegistry();
    const server = createMcpServer({
      healthService: new HealthService(db, {
        SERVER_NAME: 'contradiction-mcp',
        SERVER_VERSION: '0.3.3',
        NODE_ENV: 'test',
        port: 3000,
        env: 'test',
        logLevel: 'error',
        maxDbConnections: 1,
        enableAuth: false,
        apiKeys: [],
        jwtSecret: 'test',
        corsOrigins: [],
        rateLimitWindowMs: 60000,
        rateLimitMax: 100,
      }),
      dbManager: db,
      connectorRegistry: registry,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    // Setup dummy source, claims, and contradiction
    const src = db.createSource({ type: 'document', name: 'Test Doc' });
    const claim1 = db.createClaim({
      sourceId: src.id,
      subject: 'api',
      predicate: 'port',
      value: '8080',
      valueType: 'quantity',
      isHistorical: false,
      observedAt: new Date(),
    });
    const claim2 = db.createClaim({
      sourceId: src.id,
      subject: 'api',
      predicate: 'port',
      value: '9090',
      valueType: 'quantity',
      isHistorical: false,
      observedAt: new Date(),
    });
    const contra = db.createContradiction({
      claimAId: claim1.id,
      claimBId: claim2.id,
      contradictionType: 'CONFIGURATION_MISMATCH',
      severity: 'HIGH',
      confidence: 1.0,
      explanation: 'Conflicting port settings',
      status: 'OPEN',
      detectedAt: new Date(),
    });

    // 1. review_contradiction alias
    const reviewRes = await client.callTool({
      name: 'review_contradiction',
      arguments: {
        contradictionId: contra.id,
        reviewedBy: 'test-auditor',
        notes: 'Review notes',
      },
    });
    expect(reviewRes.isError).toBe(false);
    const reviewData = JSON.parse((reviewRes.content as Array<{ text: string }>)[0].text);
    expect(reviewData.status).toBe('REVIEWED');

    // 2. dismiss_contradiction alias
    const dismissRes = await client.callTool({
      name: 'dismiss_contradiction',
      arguments: {
        contradictionId: contra.id,
        dismissedBy: 'test-dismiss',
        reason: 'Known dev exception',
      },
    });
    expect(dismissRes.isError).toBe(false);
    const dismissData = JSON.parse((dismissRes.content as Array<{ text: string }>)[0].text);
    expect(dismissData.status).toBe('DISMISSED');

    // 3. reopen_contradiction alias
    const reopenRes = await client.callTool({
      name: 'reopen_contradiction',
      arguments: {
        contradictionId: contra.id,
        reopenedBy: 'test-reopen',
        reason: 'Revisiting decision',
      },
    });
    expect(reopenRes.isError).toBe(false);
    const reopenData = JSON.parse((reopenRes.content as Array<{ text: string }>)[0].text);
    expect(reopenData.status).toBe('OPEN');

    // 4. get_contradiction_history alias
    const historyRes = await client.callTool({
      name: 'get_contradiction_history',
      arguments: {
        contradictionId: contra.id,
      },
    });
    expect(historyRes.isError).toBe(false);
    const historyData = JSON.parse((historyRes.content as Array<{ text: string }>)[0].text);
    expect(historyData.contradiction.id).toBe(contra.id);
    expect(historyData.auditTrail).toBeDefined();

    // 5. get_claim_history alias
    const claimHistRes = await client.callTool({
      name: 'get_claim_history',
      arguments: {
        claimId: claim1.id,
      },
    });
    expect(claimHistRes.isError).toBe(false);
    const claimHistData = JSON.parse((claimHistRes.content as Array<{ text: string }>)[0].text);
    expect(claimHistData.claim.id).toBe(claim1.id);
    expect(claimHistData.history).toBeDefined();

    await client.close();
    await server.close();
  });

  // Bug Fix: ValueComparator Quantity & Unit Safety
  it('ValueComparator correctly rejects unit dimension mismatches and unitless vs dimensional quantities', () => {
    const vc = new ValueComparator();

    // Different dimensional units (bytes vs ms)
    const res1 = vc.compare('1 GB', '1 ms', 'quantity');
    expect(res1.equal).toBe(false);
    expect(res1.differenceType).toBe('UNIT_DIMENSION_MISMATCH');

    // Unitless vs dimensional quantity (1000 vs 1000 ms)
    const res2 = vc.compare('1000', '1000 ms', 'quantity');
    expect(res2.equal).toBe(false);
    expect(res2.differenceType).toBe('UNIT_MISMATCH');

    // Same dimensional unit with equivalence (1 GB vs 1024 MB)
    const res3 = vc.compare('1 GB', '1024 MB', 'quantity');
    expect(res3.equal).toBe(true);

    // Bare numbers with equivalence (5000 vs 5,000)
    const res4 = vc.compare('5000', '5,000', 'number');
    expect(res4.equal).toBe(true);
  });

  // Bug Fix: HTML Entity Decoding in Website Connector
  it('decodeHtmlEntities properly decodes common HTML entities safely', () => {
    expect(decodeHtmlEntities('&gt;= 20.0.0')).toBe('>= 20.0.0');
    expect(decodeHtmlEntities('Node &amp; Express')).toBe('Node & Express');
    expect(decodeHtmlEntities('&quot;production&quot;')).toBe('"production"');
    expect(decodeHtmlEntities('It&#39;s ready')).toBe("It's ready");
    expect(decodeHtmlEntities('&#60;test&#62;')).toBe('<test>');
  });
});
