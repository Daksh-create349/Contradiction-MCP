import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { CandidateGenerator, getCanonicalPairKey } from '../src/discovery/candidateGenerator.js';
import { InMemoryClaimIndex } from '../src/discovery/similarityIndex.js';
import { rankingService, RankableContradiction } from '../src/discovery/rankingService.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';
import { Claim } from '../src/domain/entities/claim.js';
import { Source } from '../src/domain/entities/source.js';
import { NotFoundError } from '../src/domain/types/common.js';

function mockClaim(overrides: Partial<Claim>): Claim {
  return {
    id: overrides.id ?? 'c-' + Math.random().toString(36).substring(2, 9),
    sourceId: overrides.sourceId ?? 's-1',
    subject: overrides.subject ?? 'API Gateway',
    predicate: overrides.predicate ?? 'node_version',
    value: overrides.value ?? '20',
    valueType: overrides.valueType ?? 'version',
    confidence: overrides.confidence ?? 1.0,
    isHistorical: overrides.isHistorical ?? false,
    observedAt: overrides.observedAt ?? new Date('2026-09-01'),
    createdAt: overrides.createdAt ?? new Date('2026-09-01'),
    metadata: overrides.metadata ?? {},
  };
}

describe('Discovery Layer - Comprehensive Tests (1 - 20)', () => {
  let dbManager: DatabaseManager;
  let discoveryService: DiscoveryService;
  let defaultSourceA: Source;
  let defaultSourceB: Source;

  beforeEach(() => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();
    discoveryService = new DiscoveryService(dbManager);

    defaultSourceA = dbManager.createSource({
      name: 'Source Alpha',
      type: 'github',
      trustScore: 0.95,
    });
    defaultSourceB = dbManager.createSource({
      name: 'Source Beta',
      type: 'document',
      trustScore: 0.9,
    });
  });

  afterEach(() => {
    dbManager.close();
  });

  // 1. Candidate grouping
  it('1. groups claims by conceptual subject and predicate', () => {
    const generator = new CandidateGenerator();
    const claims = [
      mockClaim({ id: '1', subject: 'Platform Gateway', predicate: 'port', value: '8080' }),
      mockClaim({ id: '2', subject: 'platform-gateway', predicate: 'port', value: '9090' }),
      mockClaim({ id: '3', subject: 'Auth Service', predicate: 'port', value: '4000' }),
    ];

    const pairs = generator.generatePairs(claims);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].pairKey).toBe(getCanonicalPairKey('1', '2'));
  });

  // 2. Subject normalization
  it('2. normalizes subjects across casing, whitespace, and delimiters', () => {
    const generator = new CandidateGenerator();
    const claims = [
      mockClaim({ id: '1', subject: '  Core-Billing_Service  ', predicate: 'tier', value: 'pro' }),
      mockClaim({ id: '2', subject: 'core billing service', predicate: 'tier', value: 'free' }),
    ];

    const pairs = generator.generatePairs(claims);
    expect(pairs).toHaveLength(1);
  });

  // 3. Predicate normalization
  it('3. normalizes predicates across casing and separators', () => {
    const generator = new CandidateGenerator();
    const claims = [
      mockClaim({ id: '1', subject: 'Worker', predicate: 'MAX_RETRIES', value: '3' }),
      mockClaim({ id: '2', subject: 'worker', predicate: 'max-retries', value: '5' }),
    ];

    const pairs = generator.generatePairs(claims);
    expect(pairs).toHaveLength(1);
  });

  // 4. Same pair is never analyzed twice
  it('4. guarantees same pair is analyzed exactly once regardless of ordering', () => {
    const generator = new CandidateGenerator();
    const claims = [
      mockClaim({ id: 'A', subject: 'Service', predicate: 'version', value: '1' }),
      mockClaim({ id: 'B', subject: 'Service', predicate: 'version', value: '2' }),
    ];

    const pairs = generator.generatePairs(claims);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].pairKey).toBe('A::B');
  });

  // 5. Same claim is never compared with itself
  it('5. never pairs or compares a claim with itself', () => {
    const index = new InMemoryClaimIndex();
    const claim = mockClaim({ id: 'self-1', subject: 'DB', predicate: 'port', value: '5432' });
    index.add(claim);

    const candidates = index.findCandidates(claim);
    expect(candidates).toHaveLength(0);

    const generator = new CandidateGenerator();
    const pairs = generator.generatePairs([claim]);
    expect(pairs).toHaveLength(0);
  });

  // 6. Unrelated claims are not unnecessarily compared
  it('6. excludes unrelated claims from candidate generation', () => {
    const generator = new CandidateGenerator();
    const claims = [
      mockClaim({ id: '1', subject: 'API Server', predicate: 'version', value: '1' }),
      mockClaim({ id: '2', subject: 'Warehouse Inventory', predicate: 'stock', value: '500' }),
      mockClaim({
        id: '3',
        subject: 'User Profile',
        predicate: 'email',
        value: 'test@example.com',
      }),
    ];

    const pairs = generator.generatePairs(claims);
    expect(pairs).toHaveLength(0);
  });

  // 7. Real contradiction is discovered automatically
  it('7. automatically discovers real contradictions across stored claims', () => {
    dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'Payments API',
      predicate: 'runtime_version',
      value: 'Node 22',
      valueType: 'version',
    });
    dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'payments-api',
      predicate: 'runtime-version',
      value: 'Node 20',
      valueType: 'version',
    });

    const summary = discoveryService.scanAllClaims();
    expect(summary.contradictionsFound).toBe(1);
    expect(summary.newContradictions).toBe(1);
    expect(summary.contradictions[0].contradictionType).toBe('VERSION_MISMATCH');
  });

  // 8. Equivalent values are not persisted as contradictions
  it('8. does not flag or persist equivalent normalized values', () => {
    dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'Invoice Total',
      predicate: 'amount',
      value: '₹70,000',
      valueType: 'price',
    });
    dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'invoice total',
      predicate: 'amount',
      value: '70000 INR',
      valueType: 'price',
    });

    const summary = discoveryService.scanAllClaims();
    expect(summary.contradictionsFound).toBe(0);
    expect(summary.newContradictions).toBe(0);
    const persisted = dbManager.listContradictions();
    expect(persisted).toHaveLength(0);
  });

  // 9. Duplicate scan does not create duplicate contradiction records
  it('9. prevents duplicate records across consecutive scans', () => {
    dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'Frontend Client',
      predicate: 'release_date',
      value: '2026-10-01',
      valueType: 'date',
    });
    dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'Frontend Client',
      predicate: 'release_date',
      value: '2026-10-15',
      valueType: 'date',
    });

    const firstScan = discoveryService.scanAllClaims();
    expect(firstScan.contradictionsFound).toBe(1);
    expect(firstScan.newContradictions).toBe(1);
    expect(firstScan.existingContradictions).toBe(0);

    const secondScan = discoveryService.scanAllClaims();
    expect(secondScan.contradictionsFound).toBe(1);
    expect(secondScan.newContradictions).toBe(0);
    expect(secondScan.existingContradictions).toBe(1);

    const persisted = dbManager.listContradictions();
    expect(persisted).toHaveLength(1);
  });

  // 10. Incremental scan works
  it('10. scans an individual claim incrementally against existing knowledge base', () => {
    dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'Database Cluster',
      predicate: 'primary_region',
      value: 'us-east-1',
      valueType: 'string',
    });

    const newClaim = dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'database-cluster',
      predicate: 'primary_region',
      value: 'eu-central-1',
      valueType: 'string',
    });

    const incSummary = discoveryService.scanClaim(newClaim.id);
    expect(incSummary.claimId).toBe(newClaim.id);
    expect(incSummary.candidatePairs).toBe(1);
    expect(incSummary.contradictionsFound).toBe(1);
    expect(incSummary.newContradictions).toBe(1);
    expect(incSummary.results[0].contradictionType).toBe('VALUE_MISMATCH');
  });

  // 11. Full scan works
  it('11. executes full scan across multiple subjects and reports complete summary', () => {
    dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'Order Service',
      predicate: 'active_replicas',
      value: '5',
      valueType: 'quantity',
    });
    dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'Order Service',
      predicate: 'active_replicas',
      value: '10',
      valueType: 'quantity',
    });

    const fullSummary = discoveryService.scanAllClaims();
    expect(fullSummary.status).toBe('completed');
    expect(fullSummary.claimsScanned).toBe(2);
    expect(fullSummary.pairsAnalyzed).toBe(1);
    expect(fullSummary.contradictionsFound).toBe(1);
    expect(fullSummary.durationMs).toBeGreaterThanOrEqual(0);
  });

  // 12. Confidence filtering works
  it('12. filters out contradictions below the specified minConfidence threshold', () => {
    dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'System Config',
      predicate: 'flag',
      value: 'valA',
      valueType: 'string',
      confidence: 0.3,
    });
    dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'System Config',
      predicate: 'flag',
      value: 'valB',
      valueType: 'string',
      confidence: 0.3,
    });

    const strictSummary = discoveryService.scanAllClaims({ minConfidence: 0.95 });
    expect(strictSummary.contradictionsFound).toBe(0);

    const relaxedSummary = discoveryService.scanAllClaims({ minConfidence: 0.3 });
    expect(relaxedSummary.contradictionsFound).toBe(1);
  });

  // 13. Severity filtering and listing works
  it('13. queries stored contradictions by severity and status filters', () => {
    const c1 = dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'App',
      predicate: 'ver',
      value: '1',
      valueType: 'version',
    });
    const c2 = dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'App',
      predicate: 'ver',
      value: '2',
      valueType: 'version',
    });
    const c3 = dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'Sec',
      predicate: 'security_policy',
      value: 'strict',
      valueType: 'policy',
    });
    const c4 = dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'Sec',
      predicate: 'security_policy',
      value: 'permissive',
      valueType: 'policy',
    });

    dbManager.createContradiction({
      claimAId: c1.id,
      claimBId: c2.id,
      contradictionType: 'VERSION_MISMATCH',
      severity: 'MEDIUM',
      explanation: 'version mismatch',
    });
    dbManager.createContradiction({
      claimAId: c3.id,
      claimBId: c4.id,
      contradictionType: 'POLICY_MISMATCH',
      severity: 'CRITICAL',
      explanation: 'security conflict',
    });

    const criticalList = dbManager.listContradictions({ severity: 'CRITICAL' });
    expect(criticalList).toHaveLength(1);
    expect(criticalList[0].contradictionType).toBe('POLICY_MISMATCH');

    const mediumList = dbManager.listContradictions({ severity: 'MEDIUM' });
    expect(mediumList).toHaveLength(1);
    expect(mediumList[0].contradictionType).toBe('VERSION_MISMATCH');
  });

  // 14. Contradiction persistence works
  it('14. verifies that contradictions persisted via discovery are saved in database', () => {
    dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'S1',
      predicate: 'p1',
      value: 'v1',
      valueType: 'string',
    });
    dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'S1',
      predicate: 'p1',
      value: 'v2',
      valueType: 'string',
    });

    discoveryService.scanAllClaims();
    const rows = dbManager.listContradictions();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('OPEN');
    expect(rows[0].explanation).toBeDefined();
  });

  // 15. Retrieval of contradiction with complete details works
  it('15. retrieves a single contradiction along with full claim and source references', () => {
    const claimA = dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'S',
      predicate: 'p',
      value: 'A',
      valueType: 'string',
    });
    const claimB = dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'S',
      predicate: 'p',
      value: 'B',
      valueType: 'string',
    });

    const contradiction = dbManager.createContradiction({
      claimAId: claimA.id,
      claimBId: claimB.id,
      contradictionType: 'VALUE_MISMATCH',
      severity: 'HIGH',
      explanation: 'conflict',
    });

    const details = dbManager.getContradictionWithDetails(contradiction.id);
    expect(details).not.toBeNull();
    expect(details?.contradiction.id).toBe(contradiction.id);
    expect(details?.claimA.id).toBe(claimA.id);
    expect(details?.claimB.id).toBe(claimB.id);
    expect(details?.sourceA?.id).toBe(defaultSourceA.id);
    expect(details?.sourceB?.id).toBe(defaultSourceB.id);
  });

  // 16. Ranking works
  it('16. ranks high severity and high confidence contradictions above low ones', () => {
    const c1 = mockClaim({ id: 'c1' });
    const c2 = mockClaim({ id: 'c2' });

    const highItem: RankableContradiction = {
      claimA: c1,
      claimB: c2,
      sourceA: defaultSourceA,
      sourceB: defaultSourceB,
      contradictionType: 'POLICY_MISMATCH',
      severity: 'CRITICAL',
      confidence: 0.98,
      explanation: 'Critical policy',
    };

    const lowItem: RankableContradiction = {
      claimA: c1,
      claimB: c2,
      sourceA: defaultSourceA,
      sourceB: defaultSourceB,
      contradictionType: 'VALUE_MISMATCH',
      severity: 'LOW',
      confidence: 0.5,
      explanation: 'Low severity note',
    };

    const ranked = rankingService.rank([lowItem, highItem]);
    expect(ranked[0].severity).toBe('CRITICAL');
    expect(ranked[1].severity).toBe('LOW');
    expect(ranked[0].priorityScore!).toBeGreaterThan(ranked[1].priorityScore!);
  });

  // 17. Empty database works safely
  it('17. operates safely without errors on an empty database', () => {
    const summary = discoveryService.scanAllClaims();
    expect(summary.claimsScanned).toBe(0);
    expect(summary.candidatePairs).toBe(0);
    expect(summary.contradictionsFound).toBe(0);
    expect(summary.contradictions).toHaveLength(0);
  });

  // 18. Missing claim ID returns safe error
  it('18. throws NotFoundError when incremental scan targets non-existent claim', () => {
    expect(() => {
      discoveryService.scanClaim('non-existent-claim-uuid-0000');
    }).toThrow(NotFoundError);
  });

  // 19. Large synthetic dataset does not cause quadratic candidate generation
  it('19. verifies candidate grouping eliminates quadratic comparison on unrelated claims', () => {
    const generator = new CandidateGenerator();
    // 50 claims with 50 completely distinct subjects
    const unrelatedClaims: Claim[] = [];
    for (let i = 0; i < 50; i++) {
      unrelatedClaims.push(
        mockClaim({
          id: `claim-${i}`,
          subject: `Distinct Entity ${i}`,
          predicate: `attribute_${i}`,
          value: `val_${i}`,
        }),
      );
    }

    // Naive pairwise: 50 * 49 / 2 = 1,225 pairs
    const pairs = generator.generatePairs(unrelatedClaims);
    // Optimized: 0 pairs!
    expect(pairs).toHaveLength(0);
  });

  // 20. Existing dismissed/resolved contradictions behave correctly according to filters
  it('20. respects includeDismissed flag when scanning', () => {
    const claimA = dbManager.createClaim({
      sourceId: defaultSourceA.id,
      subject: 'API',
      predicate: 'host',
      value: 'h1',
      valueType: 'string',
    });
    const claimB = dbManager.createClaim({
      sourceId: defaultSourceB.id,
      subject: 'API',
      predicate: 'host',
      value: 'h2',
      valueType: 'string',
    });

    // Pre-insert contradiction and dismiss it
    const created = dbManager.createContradiction({
      claimAId: claimA.id,
      claimBId: claimB.id,
      contradictionType: 'VALUE_MISMATCH',
      severity: 'LOW',
      explanation: 'Dismissed conflict',
    });
    dbManager.updateContradictionStatus(created.id, 'DISMISSED');

    // Scan with includeDismissed: false
    const scanWithout = discoveryService.scanAllClaims({ includeDismissed: false });
    expect(scanWithout.contradictions).toHaveLength(0);

    // Scan with includeDismissed: true
    const scanWith = discoveryService.scanAllClaims({ includeDismissed: true });
    expect(scanWith.contradictions).toHaveLength(1);
    expect(scanWith.contradictions[0].contradictionId).toBe(created.id);
  });
});
