import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { ReviewService } from '../src/services/reviewService.js';
import { Source } from '../src/domain/entities/source.js';
import { Claim } from '../src/domain/entities/claim.js';
import { Contradiction } from '../src/domain/entities/contradiction.js';

describe('Contradiction Review & Claim Lifecycle Tests', () => {
  let dbManager: DatabaseManager;
  let reviewService: ReviewService;
  let source: Source;
  let claimA: Claim;
  let claimB: Claim;
  let contradiction: Contradiction;

  beforeEach(() => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();
    reviewService = new ReviewService(dbManager);

    source = dbManager.createSource({
      type: 'github',
      name: 'test-source',
    });

    claimA = dbManager.createClaim({
      sourceId: source.id,
      subject: 'Server',
      predicate: 'port',
      value: '8080',
      valueType: 'quantity',
    });

    claimB = dbManager.createClaim({
      sourceId: source.id,
      subject: 'Server',
      predicate: 'port',
      value: '3000',
      valueType: 'quantity',
    });

    contradiction = dbManager.createContradiction({
      claimAId: claimA.id,
      claimBId: claimB.id,
      contradictionType: 'CONFIGURATION_MISMATCH',
      severity: 'HIGH',
      explanation: 'Port 8080 vs 3000',
    });
  });

  afterEach(() => {
    dbManager.close();
  });

  it('marks contradiction as reviewed and records audit entry', () => {
    const reviewed = reviewService.reviewContradiction(contradiction.id, {
      reviewedBy: 'security-analyst',
      notes: 'Investigating load balancer mapping',
    });

    expect(reviewed.status).toBe('REVIEWED');

    const history = reviewService.getContradictionHistory(contradiction.id);
    expect(history.length).toBe(1);
    expect(history[0].action).toBe('REVIEWED');
    expect(history[0].performedBy).toBe('security-analyst');
    expect(history[0].notes).toBe('Investigating load balancer mapping');
  });

  it('resolves contradiction with chosen claim and audit history', () => {
    const resolved = reviewService.resolveContradiction(contradiction.id, {
      resolvedBy: 'lead-dev',
      reason: 'Port 8080 is verified production port from Docker container config',
      chosenClaimId: claimA.id,
      notes: 'Updated staging configs',
    });

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.chosenClaimId).toBe(claimA.id);
    expect(resolved.resolutionReason).toContain('8080');

    const history = reviewService.getContradictionHistory(contradiction.id);
    expect(history.length).toBe(1);
    expect(history[0].action).toBe('RESOLVED');
    expect(history[0].chosenClaimId).toBe(claimA.id);
  });

  it('dismisses and reopens contradiction through complete lifecycle', () => {
    // 1. Dismiss
    const dismissed = reviewService.dismissContradiction(contradiction.id, {
      dismissedBy: 'triager',
      reason: 'Intentional dual-port fallback',
    });
    expect(dismissed.status).toBe('DISMISSED');

    // 2. Reopen
    const reopened = reviewService.reopenContradiction(contradiction.id, {
      reopenedBy: 'qa-tester',
      reason: 'Dual port is actually deprecated in v2',
    });
    expect(reopened.status).toBe('OPEN');
    expect(reopened.resolvedAt).toBeNull();

    // Verify complete audit history
    const history = reviewService.getContradictionHistory(contradiction.id);
    expect(history.length).toBe(2);
    expect(history[0].action).toBe('REOPENED');
    expect(history[1].action).toBe('DISMISSED');
  });

  it('preserves claim value history upon state transitions', () => {
    const originalClaim = dbManager.createClaim({
      externalId: 'test-external-claim-node',
      sourceId: source.id,
      subject: 'Runtime',
      predicate: 'node_version',
      value: '20',
      valueType: 'version',
      normalizedValue: '20.0.0',
    });

    // Update claim with new value (Node 20 -> Node 22)
    dbManager.upsertClaim({
      externalId: 'test-external-claim-node',
      sourceId: source.id,
      subject: 'Runtime',
      predicate: 'node_version',
      value: '22',
      valueType: 'version',
      normalizedValue: '22.0.0',
    });

    const updated = dbManager.getClaimById(originalClaim.id);
    expect(updated?.value).toBe('22');

    // Verify claim history table records the prior Node 20 value
    const history = dbManager.getClaimHistory(originalClaim.id);
    expect(history.length).toBe(1);
    expect(history[0].value).toBe('20');
    expect(history[0].normalizedValue).toBe('20.0.0');
    expect(history[0].supersededAt).toBeInstanceOf(Date);
  });
});
