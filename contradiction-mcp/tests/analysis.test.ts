import { describe, it, expect } from 'vitest';
import { contradictionEngine } from '../src/analysis/contradictionEngine.js';
import { claimMatcher } from '../src/analysis/claimMatcher.js';
import { valueComparator } from '../src/analysis/valueComparator.js';
import { confidenceScorer } from '../src/analysis/confidenceScorer.js';
import { Claim } from '../src/domain/entities/claim.js';
import { Source } from '../src/domain/entities/source.js';

function createMockClaim(overrides: Partial<Claim>): Claim {
  return {
    id: overrides.id ?? 'claim-test-id-1',
    sourceId: overrides.sourceId ?? 'source-test-id-1',
    subject: overrides.subject ?? 'API Server',
    predicate: overrides.predicate ?? 'node_version',
    value: overrides.value ?? '20',
    valueType: overrides.valueType ?? 'version',
    normalizedValue: overrides.normalizedValue ?? null,
    confidence: overrides.confidence ?? 1.0,
    observedAt: overrides.observedAt ?? new Date('2026-09-01'),
    createdAt: overrides.createdAt ?? new Date('2026-09-01'),
    isHistorical: overrides.isHistorical ?? false,
    metadata: overrides.metadata ?? {},
  };
}

function createMockSource(overrides: Partial<Source>): Source {
  return {
    id: overrides.id ?? 'source-test-id-1',
    type: overrides.type ?? 'github',
    name: overrides.name ?? 'Repository README',
    uri: overrides.uri ?? 'https://github.com/example/repo',
    lastFetchedAt: overrides.lastFetchedAt ?? new Date('2026-09-01'),
    createdAt: overrides.createdAt ?? new Date('2026-09-01'),
    updatedAt: overrides.updatedAt ?? new Date('2026-09-01'),
    trustScore: overrides.trustScore ?? 1.0,
    metadata: overrides.metadata ?? {},
  };
}

describe('Contradiction Engine & Analysis Pipeline', () => {
  describe('Required Core Scenarios (A - N)', () => {
    // Scenario A: Same subject + same predicate + same value -> no contradiction
    it('A. recognizes same subject, predicate, and value as non-contradictory', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'API Server',
        predicate: 'node_version',
        value: '20',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'API Server',
        predicate: 'node_version',
        value: '20',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(false);
      expect(result.explanation).toContain('No contradiction detected');
    });

    // Scenario B: Same subject + same predicate + different string -> contradiction
    it('B. detects contradiction for same subject and predicate with differing strings', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'Database Host',
        predicate: 'region',
        value: 'us-east-1',
        valueType: 'string',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'Database Host',
        predicate: 'region',
        value: 'eu-west-1',
        valueType: 'string',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(true);
      expect(result.contradictionType).toBe('VALUE_MISMATCH');
    });

    // Scenario C: Case differences "Production" vs "production" -> no contradiction
    it('C. normalizes casing differences without flagging contradiction', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'Environment',
        predicate: 'mode',
        value: 'Production',
        valueType: 'string',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'Environment',
        predicate: 'mode',
        value: 'production',
        valueType: 'string',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(false);
    });

    // Scenario D: Version: "Node 20" vs "Node 22" -> VERSION_MISMATCH
    it('D. classifies conflicting versions as VERSION_MISMATCH with HIGH severity', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'API Server',
        predicate: 'runtime',
        value: 'Node 20',
        valueType: 'version',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'API Server',
        predicate: 'runtime',
        value: 'Node 22',
        valueType: 'version',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(true);
      expect(result.contradictionType).toBe('VERSION_MISMATCH');
      expect(result.severity).toBe('HIGH');
      expect(result.explanation).toContain('Node 20');
      expect(result.explanation).toContain('Node 22');
    });

    // Scenario E: Date: "2026-09-15" vs "September 17, 2026" -> DATE_MISMATCH
    it('E. normalizes and identifies date conflicts as DATE_MISMATCH', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'Project Alpha',
        predicate: 'deadline',
        value: '2026-09-15',
        valueType: 'date',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'Project Alpha',
        predicate: 'deadline',
        value: 'September 17, 2026',
        valueType: 'date',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(true);
      expect(result.contradictionType).toBe('DATE_MISMATCH');
      expect(result.evidence.comparison.normalizedA).toBe('2026-09-15');
      expect(result.evidence.comparison.normalizedB).toBe('2026-09-17');
    });

    // Scenario F: Price: "₹70,000" vs "70000 INR" -> no contradiction
    it('F. recognizes formatted currency representations of identical amount as equivalent', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'Laptop Order',
        predicate: 'total_price',
        value: '₹70,000',
        valueType: 'price',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'Laptop Order',
        predicate: 'total_price',
        value: '70000 INR',
        valueType: 'price',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(false);
    });

    // Scenario G: Price: "₹70,000" vs "₹75,000" -> contradiction
    it('G. flags price discrepancy as contradiction with HIGH severity', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'Laptop Order',
        predicate: 'total_price',
        value: '₹70,000',
        valueType: 'price',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'Laptop Order',
        predicate: 'total_price',
        value: '₹75,000',
        valueType: 'price',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(true);
      expect(result.severity).toBe('HIGH');
      expect(result.explanation).toContain('incompatible');
    });

    // Scenario H: Quantity: 10 vs 20 -> QUANTITY_MISMATCH
    it('H. detects numeric quantity discrepancy as QUANTITY_MISMATCH', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'Warehouse Inventory',
        predicate: 'item_count',
        value: '10',
        valueType: 'quantity',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'Warehouse Inventory',
        predicate: 'item_count',
        value: '20',
        valueType: 'quantity',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(true);
      expect(result.contradictionType).toBe('QUANTITY_MISMATCH');
    });

    // Scenario I: Status: active vs inactive -> STATUS_MISMATCH
    it('I. detects conflicting status values as STATUS_MISMATCH', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'User Account',
        predicate: 'status',
        value: 'active',
        valueType: 'status',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'User Account',
        predicate: 'status',
        value: 'inactive',
        valueType: 'status',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(true);
      expect(result.contradictionType).toBe('STATUS_MISMATCH');
    });

    // Scenario J: Completely unrelated subjects API Server vs Database -> no contradiction
    it('J. returns no contradiction when subjects are completely unrelated', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'API Server',
        predicate: 'status',
        value: 'active',
        valueType: 'status',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'Database Cluster',
        predicate: 'status',
        value: 'inactive',
        valueType: 'status',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(false);
      expect(result.explanation).toContain('distinct subjects');
    });

    // Scenario K: Same subject but different predicates node_version vs python_version -> no contradiction
    it('K. returns no contradiction for same subject with different predicates', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'API Server',
        predicate: 'node_version',
        value: '22',
        valueType: 'version',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'API Server',
        predicate: 'python_version',
        value: '3.12',
        valueType: 'version',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(false);
      expect(result.explanation).toContain('Predicates');
    });

    // Scenario L: Missing/invalid claim / same claim id
    it('L. safely handles identical claim ID with non-contradiction result', () => {
      const claimA = createMockClaim({
        id: 'identical-id',
        subject: 'API Server',
        predicate: 'port',
        value: '3000',
      });
      const claimB = createMockClaim({
        id: 'identical-id',
        subject: 'API Server',
        predicate: 'port',
        value: '3000',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(false);
      expect(result.explanation).toContain('cannot contradict itself');
    });

    // Scenario M: Low-confidence ambiguous comparison -> must not aggressively declare contradiction
    it('M. does not declare contradiction on unparseable or ambiguous dates', () => {
      const claimA = createMockClaim({
        id: 'c1',
        subject: 'Milestone',
        predicate: 'due_date',
        value: 'some vague date',
        valueType: 'date',
      });
      const claimB = createMockClaim({
        id: 'c2',
        subject: 'Milestone',
        predicate: 'due_date',
        value: 'another vague date',
        valueType: 'date',
      });

      const result = contradictionEngine.analyzePair(claimA, claimB);
      expect(result.isContradiction).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
    });

    // Scenario N: Source trust and claim confidence influence the score
    it('N. verifies that source trust and claim confidence measurably affect the confidence score', () => {
      const claimA1 = createMockClaim({
        id: 'c1',
        confidence: 1.0,
        value: 'Node 18',
        valueType: 'version',
      });
      const claimB1 = createMockClaim({
        id: 'c2',
        confidence: 1.0,
        value: 'Node 22',
        valueType: 'version',
      });
      const sourceHigh1 = createMockSource({ trustScore: 1.0 });
      const sourceHigh2 = createMockSource({ trustScore: 1.0 });

      const resultHigh = contradictionEngine.analyzePair(
        claimA1,
        claimB1,
        sourceHigh1,
        sourceHigh2,
      );

      const claimA2 = createMockClaim({
        id: 'c3',
        confidence: 0.4,
        value: 'Node 18',
        valueType: 'version',
      });
      const claimB2 = createMockClaim({
        id: 'c4',
        confidence: 0.4,
        value: 'Node 22',
        valueType: 'version',
      });
      const sourceLow1 = createMockSource({ trustScore: 0.2 });
      const sourceLow2 = createMockSource({ trustScore: 0.3 });

      const resultLow = contradictionEngine.analyzePair(claimA2, claimB2, sourceLow1, sourceLow2);

      expect(resultHigh.confidence).toBeGreaterThan(resultLow.confidence);
    });
  });

  describe('Edge Cases & Property Robustness', () => {
    it('handles empty strings and null-like inputs safely', () => {
      const comp = valueComparator.compare('', '');
      expect(comp.equal).toBe(true);

      const comp2 = valueComparator.compare('   ', 'content');
      expect(comp2.equal).toBe(false);
      expect(comp2.differenceType).toBe('EMPTY_VS_NONEMPTY');
    });

    it('handles version prefixes such as "v22" and "nodejs v22"', () => {
      const parsedA = valueComparator.normalizeVersion('v22.1.0');
      const parsedB = valueComparator.normalizeVersion('NodeJS 22.1.0');
      expect(parsedA?.canonical).toBe('22.1.0');
      expect(parsedB?.canonical).toBe('22.1.0');

      const comp = valueComparator.compare('v22.1.0', 'NodeJS 22.1.0', 'version');
      expect(comp.equal).toBe(true);
    });

    it('handles decimal numbers with variable trailing zeroes', () => {
      const comp = valueComparator.compare('10', '10.00', 'number');
      expect(comp.equal).toBe(true);
      expect(comp.differenceStrength).toBe(0.0);
    });

    it('handles Unicode currency symbols and formats correctly', () => {
      const comp1 = valueComparator.compare('$1,000.50', '1000.50 USD', 'price');
      expect(comp1.equal).toBe(true);

      const comp2 = valueComparator.compare('€500', '£500', 'price');
      expect(comp2.equal).toBe(false);
      expect(comp2.differenceType).toBe('CURRENCY_MISMATCH');
    });

    it('handles various date formats (ISO, slash-separated, textual)', () => {
      const d1 = valueComparator.normalizeDate('2026-12-25');
      const d2 = valueComparator.normalizeDate('December 25, 2026');
      expect(d1).toBe(d2);
    });

    it('handles extremely long strings without crashing or hanging', () => {
      const longA = 'a'.repeat(5000);
      const longB = 'a'.repeat(5000);
      const comp = valueComparator.compare(longA, longB, 'string');
      expect(comp.equal).toBe(true);
    });

    it('scores ambiguity penalty when values are uncomparable', () => {
      const score = confidenceScorer.calculate({
        subjectSimilarity: 1.0,
        predicateSimilarity: 1.0,
        valueComparable: false,
        valueDifferenceStrength: 0.0,
        isAmbiguous: true,
      });

      expect(score.breakdown.ambiguityPenalty).toBe(0.25);
    });

    it('matches subject and predicate with varying separators and casing', () => {
      const match = claimMatcher.match(
        { subject: 'API Server', predicate: 'Node Version' },
        { subject: 'api_server', predicate: 'node-version' },
      );

      expect(match.matches).toBe(true);
      expect(match.subjectSimilarity).toBe(1.0);
      expect(match.predicateSimilarity).toBe(1.0);
    });
  });
});
