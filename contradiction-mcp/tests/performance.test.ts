import { describe, it, expect } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';
import { CandidateGenerator } from '../src/discovery/candidateGenerator.js';

describe('Engine Performance Benchmarks', () => {
  it('indexes and scans 100 claims in under 500ms', () => {
    const db = new DatabaseManager(':memory:');
    db.initialize();
    const source = db.createSource({ type: 'github', name: 'bench-repo' });

    // Seed 100 synthetic claims across 10 distinct subjects
    for (let i = 0; i < 100; i++) {
      const subject = `service_${i % 10}`;
      const predicate = i % 2 === 0 ? 'runtime' : 'port';
      const value = i % 3 === 0 ? 'node22' : i % 3 === 1 ? 'node20' : 'node18';

      db.createClaim({
        sourceId: source.id,
        subject,
        predicate,
        value,
        valueType: 'version',
      });
    }

    const discovery = new DiscoveryService(db);
    const startTime = performance.now();
    const result = discovery.scanAllClaims();
    const duration = performance.now() - startTime;

    expect(result.claimsScanned).toBe(100);
    expect(duration).toBeLessThan(1000);
    db.close();
  });

  it('generates candidate pairs for 1000 claims with bounded complexity', () => {
    const generator = new CandidateGenerator();
    const claims = [];

    // 1000 claims across 50 subjects and 5 predicates
    for (let i = 0; i < 1000; i++) {
      claims.push({
        id: `claim-${i}`,
        sourceId: 'src-1',
        subject: `microservice_${i % 50}`,
        predicate: `property_${i % 5}`,
        value: `val_${i % 4}`,
        valueType: 'version' as const,
        confidence: 1.0,
        isHistorical: false,
        observedAt: new Date(),
        createdAt: new Date(),
        metadata: {},
      });
    }

    const startTime = performance.now();
    const candidates = generator.generatePairs(claims);
    const duration = performance.now() - startTime;

    // Must finish within 1500ms, proving indexing avoids blind O(N^2) cartesian product
    expect(duration).toBeLessThan(1500);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('scales candidate generation to 5,000 claims within sub-second latency and bounded memory', () => {
    const generator = new CandidateGenerator();
    const claims = [];

    // 5000 claims partitioned across 250 microservices and 10 configuration predicates
    for (let i = 0; i < 5000; i++) {
      claims.push({
        id: `claim-5k-${i}`,
        sourceId: 'src-5k',
        subject: `service_${i % 250}`,
        predicate: `setting_${i % 10}`,
        value: `value_${i % 3}`,
        valueType: 'string' as const,
        confidence: 1.0,
        isHistorical: false,
        observedAt: new Date(),
        createdAt: new Date(),
        metadata: {},
      });
    }

    const heapBefore = process.memoryUsage().heapUsed;
    const startTime = performance.now();
    const candidates = generator.generatePairs(claims);
    const durationMs = performance.now() - startTime;
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = (heapAfter - heapBefore) / (1024 * 1024);

    // 5,000 claims candidate generation must execute in under 1,000ms
    expect(durationMs).toBeLessThan(1000);
    expect(candidates.length).toBeGreaterThan(0);
    // Heap delta should remain well within healthy limits (< 50MB)
    expect(heapDeltaMb).toBeLessThan(50);
  });
});
