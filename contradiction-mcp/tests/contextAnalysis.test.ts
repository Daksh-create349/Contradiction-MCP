import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { ContradictionEngine } from '../src/analysis/contradictionEngine.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';
import { HealthService } from '../src/services/healthService.js';
import { AnalysisService } from '../src/services/analysisService.js';
import { createMcpServer } from '../src/server.js';
import { InMemoryTransport, Client } from '@modelcontextprotocol/client';

describe('Context-Aware Contradiction Engine & False-Positive Elimination', () => {
  let db: DatabaseManager;
  let engine: ContradictionEngine;
  let sourceId: string;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    db.initialize();
    engine = new ContradictionEngine();

    const src = db.createSource({
      type: 'github',
      name: 'test-org/context-repo',
      uri: 'https://github.com/test-org/context-repo',
    });
    sourceId = src.id;
  });

  afterEach(() => {
    db.close();
  });

  // 1. CI Matrix
  it('1. identifies CI matrix node versions as SET_MEMBERSHIP and not a contradiction', () => {
    const claim1 = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '20',
      valueType: 'version',
      environment: 'ci',
      scope: 'workflow',
      sourceRole: 'configuration',
      multiValueContext: 'ci_matrix',
    });

    const claim2 = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '22',
      valueType: 'version',
      environment: 'ci',
      scope: 'workflow',
      sourceRole: 'configuration',
      multiValueContext: 'ci_matrix',
    });

    const analysis = engine.analyzePair(claim1, claim2);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(analysis.relationship.type).toBe('SET_MEMBERSHIP');
    expect(analysis.explanation).toContain('multi-value context');
  });

  // 2. SemVer Satisfaction
  it('2. detects concrete version satisfying SemVer range as COMPATIBLE_FACT', () => {
    const claimRange = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '>= 18',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
      sourceRole: 'configuration',
    });

    const claimConcrete = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '22',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
      sourceRole: 'configuration',
    });

    const analysis = engine.analyzePair(claimRange, claimConcrete);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(analysis.relationship.type).toBe('COMPATIBLE_FACT');
  });

  // 3. SemVer Violation
  it('3. detects concrete version violating SemVer range as CONFIRMED_CONTRADICTION', () => {
    const claimRange = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '>= 20',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
      sourceRole: 'configuration',
    });

    const claimConcrete = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '16',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
      sourceRole: 'configuration',
    });

    const analysis = engine.analyzePair(claimRange, claimConcrete);
    expect(analysis.isContradiction).toBe(true);
    expect(analysis.analysisStatus).toBe('CONFIRMED_CONTRADICTION');
    expect(analysis.contradictionType).toBe('VERSION_MISMATCH');
  });

  // 4. SemVer Ranges Overlap / Intersection
  it('4. detects intersecting SemVer ranges as COMPATIBLE_FACT', () => {
    const claimA = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '>= 18',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
    });

    const claimB = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '>= 16',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
    });

    const analysis = engine.analyzePair(claimA, claimB);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(analysis.relationship.type).toBe('COMPATIBLE_FACT');
  });

  // 5. SemVer Ranges Disjoint
  it('5. detects disjoint SemVer ranges as CONFIRMED_CONTRADICTION', () => {
    const claimA = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '< 16',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
    });

    const claimB = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '>= 18',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
    });

    const analysis = engine.analyzePair(claimA, claimB);
    expect(analysis.isContradiction).toBe(true);
    expect(analysis.analysisStatus).toBe('CONFIRMED_CONTRADICTION');
  });

  // 6. Dev vs Prod Environment
  it('6. detects dev vs prod port configurations as DIFFERENT_ENVIRONMENT', () => {
    const claimDev = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'port',
      value: '3000',
      valueType: 'quantity',
      environment: 'development',
      scope: 'service',
      sourceRole: 'configuration',
    });

    const claimProd = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'port',
      value: '8080',
      valueType: 'quantity',
      environment: 'production',
      scope: 'service',
      sourceRole: 'configuration',
    });

    const analysis = engine.analyzePair(claimDev, claimProd);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(analysis.relationship.type).toBe('DIFFERENT_ENVIRONMENT');
    expect(analysis.explanation).toContain('distinct non-overlapping environments');
  });

  // 7. Staging vs Prod Environment
  it('7. detects staging vs prod environment difference', () => {
    const claimStaging = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'database_host',
      value: 'staging-db.internal',
      valueType: 'name',
      environment: 'staging',
    });

    const claimProd = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'database_host',
      value: 'prod-db.internal',
      valueType: 'name',
      environment: 'production',
    });

    const analysis = engine.analyzePair(claimStaging, claimProd);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.relationship.type).toBe('DIFFERENT_ENVIRONMENT');
  });

  // 8. Testing vs Prod Environment
  it('8. detects testing vs prod environment difference', () => {
    const claimTest = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'cache_driver',
      value: 'memory',
      valueType: 'name',
      environment: 'testing',
    });

    const claimProd = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'cache_driver',
      value: 'redis',
      valueType: 'name',
      environment: 'production',
    });

    const analysis = engine.analyzePair(claimTest, claimProd);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.relationship.type).toBe('DIFFERENT_ENVIRONMENT');
  });

  // 9. Historical claim flag
  it('9. recognizes claims marked isHistorical: true as HISTORICAL and not a contradiction', () => {
    const claimOld = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '16',
      valueType: 'version',
      isHistorical: true,
      sourceRole: 'historical',
      environment: 'documentation',
    });

    const claimNew = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '22',
      valueType: 'version',
      isHistorical: false,
      sourceRole: 'documentation',
      environment: 'documentation',
    });

    const analysis = engine.analyzePair(claimOld, claimNew);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(analysis.relationship.type).toBe('HISTORICAL');
  });

  // 10. Temporal non-overlapping validity windows
  it('10. recognizes temporally disjoint validUntil <= validFrom as HISTORICAL', () => {
    const claim2023 = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'pricing_tier',
      value: 'tier-1',
      valueType: 'name',
      validUntil: new Date('2023-12-31'),
    });

    const claim2024 = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'pricing_tier',
      value: 'tier-2',
      valueType: 'name',
      validFrom: new Date('2024-01-01'),
    });

    const analysis = engine.analyzePair(claim2023, claim2024);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.relationship.type).toBe('HISTORICAL');
  });

  // 11. Documentation example role
  it('11. recognizes sourceRole: "example" as EXAMPLE and not a contradiction', () => {
    const claimExample = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'port',
      value: '3000',
      valueType: 'quantity',
      sourceRole: 'example',
      environment: 'documentation',
    });

    const claimCanonical = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'port',
      value: '8080',
      valueType: 'quantity',
      sourceRole: 'configuration',
      environment: 'production',
    });

    const analysis = engine.analyzePair(claimExample, claimCanonical);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(analysis.relationship.type).toBe('EXAMPLE');
  });

  // 12. Evidence text containing "example"
  it('12. recognizes example command evidence as EXAMPLE', () => {
    const claimSample = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'port',
      value: '3000',
      valueType: 'quantity',
      metadata: {
        evidence: 'docker run -p 3000:3000 for example quickstart testing',
      },
    });

    const claimActual = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'port',
      value: '5000',
      valueType: 'quantity',
    });

    const analysis = engine.analyzePair(claimSample, claimActual);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.relationship.type).toBe('EXAMPLE');
  });

  // 13. Production config vs Deployment container mismatch
  it('13. confirms real contradiction between production package.json and deployment Dockerfile', () => {
    const claimPkg = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '22',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
      sourceRole: 'configuration',
    });

    const claimDocker = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '20',
      valueType: 'version',
      environment: 'deployment',
      scope: 'service',
      sourceRole: 'configuration',
    });

    const analysis = engine.analyzePair(claimPkg, claimDocker);
    expect(analysis.isContradiction).toBe(true);
    expect(analysis.analysisStatus).toBe('CONFIRMED_CONTRADICTION');
    expect(analysis.contradictionType).toBe('VERSION_MISMATCH');
    expect(analysis.severity).toBe('HIGH');
  });

  // 14. Real port conflict in same environment
  it('14. confirms port contradiction in identical production environment', () => {
    const claim1 = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'port',
      value: '8080',
      valueType: 'quantity',
      environment: 'production',
      scope: 'service',
      sourceRole: 'configuration',
    });

    const claim2 = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'port',
      value: '9000',
      valueType: 'quantity',
      environment: 'production',
      scope: 'service',
      sourceRole: 'configuration',
    });

    const analysis = engine.analyzePair(claim1, claim2);
    expect(analysis.isContradiction).toBe(true);
    expect(analysis.analysisStatus).toBe('CONFIRMED_CONTRADICTION');
    expect(analysis.contradictionType).toBe('QUANTITY_MISMATCH');
  });

  // 15. Same claim identity
  it('15. verifies claim against itself produces NOT_A_CONTRADICTION', () => {
    const claim = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'node_version',
      value: '20',
      valueType: 'version',
    });

    const analysis = engine.analyzePair(claim, claim);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(analysis.relationship.type).toBe('SAME_FACT');
  });

  // 16. Distinct subjects/predicates
  it('16. verifies distinct subjects produce NOT_A_CONTRADICTION', () => {
    const claim1 = db.createClaim({
      sourceId,
      subject: 'service-alpha',
      predicate: 'port',
      value: '3000',
      valueType: 'quantity',
    });

    const claim2 = db.createClaim({
      sourceId,
      subject: 'service-beta',
      predicate: 'port',
      value: '4000',
      valueType: 'quantity',
    });

    const analysis = engine.analyzePair(claim1, claim2);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.relationship.type).toBe('UNKNOWN');
  });

  // 17. Scope mismatch: service vs repository
  it('17. evaluates distinct scopes as DIFFERENT_SCOPE and not a contradiction', () => {
    const claimService = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'log_level',
      value: 'debug',
      valueType: 'name',
      scope: 'service',
    });

    const claimRepo = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'log_level',
      value: 'info',
      valueType: 'name',
      scope: 'repository',
    });

    const analysis = engine.analyzePair(claimService, claimRepo);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.relationship.type).toBe('DIFFERENT_SCOPE');
  });

  // 18. SemVer caret range compatibility
  it('18. evaluates SemVer caret range ^4.17.0 against 4.18.2 as COMPATIBLE_FACT', () => {
    const claimA = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'express_version',
      value: '^4.17.0',
      valueType: 'version',
    });

    const claimB = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'express_version',
      value: '4.18.2',
      valueType: 'version',
    });

    const analysis = engine.analyzePair(claimA, claimB);
    expect(analysis.isContradiction).toBe(false);
    expect(analysis.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(analysis.relationship.type).toBe('COMPATIBLE_FACT');
  });

  // 19. SemVer tilde range violation
  it('19. evaluates SemVer tilde range ~1.2.0 against 1.3.0 as CONFIRMED_CONTRADICTION', () => {
    const claimA = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'lib_version',
      value: '~1.2.0',
      valueType: 'version',
    });

    const claimB = db.createClaim({
      sourceId,
      subject: 'test-org/context-repo',
      predicate: 'lib_version',
      value: '1.3.0',
      valueType: 'version',
    });

    const analysis = engine.analyzePair(claimA, claimB);
    expect(analysis.isContradiction).toBe(true);
    expect(analysis.analysisStatus).toBe('CONFIRMED_CONTRADICTION');
    expect(analysis.contradictionType).toBe('VERSION_MISMATCH');
  });

  // 20. Discovery Scanner false positive reduction
  it('20. ensures Discovery Scanner does NOT persist false positives for CI matrix claims', () => {
    const discoveryService = new DiscoveryService(db);

    // Create 4 CI matrix claims for node versions
    ['18', '20', '22', '24'].forEach((v) => {
      db.createClaim({
        sourceId,
        subject: 'matrix-project',
        predicate: 'node_version',
        value: v,
        valueType: 'version',
        environment: 'ci',
        scope: 'workflow',
        sourceRole: 'configuration',
        multiValueContext: 'ci_matrix',
      });
    });

    const scanResult = discoveryService.scanAllClaims({ minConfidence: 0.5 });
    expect(scanResult.pairsAnalyzed).toBeGreaterThan(0);
    // ZERO contradictions because all are ci_matrix!
    expect(scanResult.contradictionsFound).toBe(0);
    expect(db.listContradictions().length).toBe(0);
  });

  // 21. Discovery Scanner real contradiction discovery
  it('21. ensures Discovery Scanner persists real contradiction between Dockerfile and package.json', () => {
    const discoveryService = new DiscoveryService(db);

    db.createClaim({
      sourceId,
      subject: 'real-app',
      predicate: 'node_version',
      value: '22',
      valueType: 'version',
      environment: 'production',
      scope: 'package',
      sourceRole: 'configuration',
    });

    db.createClaim({
      sourceId,
      subject: 'real-app',
      predicate: 'node_version',
      value: '20',
      valueType: 'version',
      environment: 'deployment',
      scope: 'service',
      sourceRole: 'configuration',
    });

    const scanResult = discoveryService.scanAllClaims({ minConfidence: 0.5 });
    expect(scanResult.contradictionsFound).toBe(1);
    expect(db.listContradictions().length).toBe(1);
  });

  // 22. MCP explain_claim_relationship tool
  it('22. executes explain_claim_relationship tool over in-memory MCP transport', async () => {
    const analysisService = new AnalysisService(db);
    const discoveryService = new DiscoveryService(db);

    const claimDev = db.createClaim({
      sourceId,
      subject: 'mcp-app',
      predicate: 'port',
      value: '3000',
      valueType: 'quantity',
      environment: 'development',
      scope: 'service',
      sourceRole: 'configuration',
    });

    const claimProd = db.createClaim({
      sourceId,
      subject: 'mcp-app',
      predicate: 'port',
      value: '8080',
      valueType: 'quantity',
      environment: 'production',
      scope: 'service',
      sourceRole: 'configuration',
    });

    const healthService = new HealthService(db, {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'error',
      SERVER_NAME: 'test',
      SERVER_VERSION: '0.1.0',
    });

    const mcpServer = createMcpServer({
      dbManager: db,
      healthService,
      analysisService,
      discoveryService,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    const toolsRes = await client.listTools();
    const toolNames = toolsRes.tools.map((t) => t.name);
    expect(toolNames).toContain('analyze_claim_pair');

    const callRes = await client.callTool({
      name: 'explain_claim_relationship',
      arguments: {
        claimAId: claimDev.id,
        claimBId: claimProd.id,
      },
    });

    expect(callRes.isError).toBeFalsy();
    const content = callRes.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.relationship.type).toBe('DIFFERENT_ENVIRONMENT');
    expect(parsed.isContradiction).toBe(false);
    expect(parsed.analysisStatus).toBe('NOT_A_CONTRADICTION');
    expect(parsed.divergenceDimensions).toContain('environment');

    await client.close();
    await mcpServer.close();
  });
});
