import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/storage/database.js';
import { DatabaseError, ValidationError } from '../src/domain/types/common.js';

describe('Domain Entities & Storage Tests', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('Source Entity', () => {
    it('creates and reads a Source', () => {
      const source = dbManager.createSource({
        name: 'GitHub Repository Readme',
        type: 'github',
        uri: 'https://github.com/example/repo',
        trustScore: 0.95,
        metadata: { repo: 'example/repo', branch: 'main' },
      });

      expect(source.id).toBeDefined();
      expect(source.name).toBe('GitHub Repository Readme');
      expect(source.type).toBe('github');
      expect(source.trustScore).toBe(0.95);
      expect(source.metadata).toEqual({ repo: 'example/repo', branch: 'main' });

      const fetched = dbManager.getSourceById(source.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(source.id);
      expect(fetched?.name).toBe('GitHub Repository Readme');
      expect(fetched?.trustScore).toBe(0.95);
    });

    it('rejects invalid Source data via schema validation', () => {
      expect(() => {
        dbManager.createSource({
          name: '',
          type: 'github',
          trustScore: 2.5, // Exceeds max 1.0
        });
      }).toThrow(ValidationError);
    });

    it('updates a Source and persists changes', () => {
      const source = dbManager.createSource({
        name: 'Product Spec Doc',
        type: 'document',
        trustScore: 0.8,
      });

      const updated = dbManager.updateSource(source.id, {
        name: 'Product Spec Doc v2',
        trustScore: 0.85,
        metadata: { version: '2.0' },
      });

      expect(updated.name).toBe('Product Spec Doc v2');
      expect(updated.trustScore).toBe(0.85);
      expect(updated.metadata).toEqual({ version: '2.0' });

      const fetched = dbManager.getSourceById(source.id);
      expect(fetched?.name).toBe('Product Spec Doc v2');
      expect(fetched?.trustScore).toBe(0.85);
    });
  });

  describe('Claim Entity', () => {
    it('creates and reads a Claim associated with a Source', () => {
      const source = dbManager.createSource({
        name: 'Tech Architecture Wiki',
        type: 'document',
      });

      const claim = dbManager.createClaim({
        sourceId: source.id,
        subject: 'Node.js runtime',
        predicate: 'version',
        value: '22',
        valueType: 'version',
        normalizedValue: '22.0.0',
        confidence: 0.99,
        metadata: { extractedFromSection: 'Runtime Requirements' },
      });

      expect(claim.id).toBeDefined();
      expect(claim.sourceId).toBe(source.id);
      expect(claim.subject).toBe('Node.js runtime');
      expect(claim.value).toBe('22');
      expect(claim.valueType).toBe('version');
      expect(claim.normalizedValue).toBe('22.0.0');
      expect(claim.confidence).toBe(0.99);

      const fetched = dbManager.getClaimById(claim.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(claim.id);
      expect(fetched?.subject).toBe('Node.js runtime');
      expect(fetched?.value).toBe('22');
    });

    it('lists Claims filtered by source and subject', () => {
      const sourceA = dbManager.createSource({ name: 'Source A', type: 'github' });
      const sourceB = dbManager.createSource({ name: 'Source B', type: 'document' });

      dbManager.createClaim({
        sourceId: sourceA.id,
        subject: 'Project API',
        predicate: 'port',
        value: '3000',
        valueType: 'configuration',
      });

      dbManager.createClaim({
        sourceId: sourceB.id,
        subject: 'Project API',
        predicate: 'port',
        value: '8080',
        valueType: 'configuration',
      });

      const claimsForSubject = dbManager.listClaims({ subject: 'Project API' });
      expect(claimsForSubject).toHaveLength(2);

      const claimsForSourceA = dbManager.listClaims({ sourceId: sourceA.id });
      expect(claimsForSourceA).toHaveLength(1);
      expect(claimsForSourceA[0].value).toBe('3000');
    });
  });

  describe('Contradiction Entity', () => {
    it('creates and reads a Contradiction between two claims', () => {
      const sourceA = dbManager.createSource({ name: 'Package JSON', type: 'github' });
      const sourceB = dbManager.createSource({ name: 'Deployment Manifest', type: 'document' });

      const claimA = dbManager.createClaim({
        sourceId: sourceA.id,
        subject: 'Node.js',
        predicate: 'version',
        value: '22',
        valueType: 'version',
      });

      const claimB = dbManager.createClaim({
        sourceId: sourceB.id,
        subject: 'Node.js',
        predicate: 'version',
        value: '18',
        valueType: 'version',
      });

      const contradiction = dbManager.createContradiction({
        claimAId: claimA.id,
        claimBId: claimB.id,
        contradictionType: 'VERSION_MISMATCH',
        severity: 'HIGH',
        confidence: 0.95,
        explanation:
          'Package JSON specifies Node.js 22 while Deployment Manifest specifies Node.js 18',
        metadata: { automaticDetection: true },
      });

      expect(contradiction.id).toBeDefined();
      expect(contradiction.claimAId).toBe(claimA.id);
      expect(contradiction.claimBId).toBe(claimB.id);
      expect(contradiction.contradictionType).toBe('VERSION_MISMATCH');
      expect(contradiction.severity).toBe('HIGH');
      expect(contradiction.status).toBe('OPEN');

      const fetched = dbManager.getContradictionById(contradiction.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.explanation).toContain(
        'Node.js 22 while Deployment Manifest specifies Node.js 18',
      );
    });

    it('updates contradiction status to RESOLVED', () => {
      const source = dbManager.createSource({ name: 'Source', type: 'manual' });
      const claimA = dbManager.createClaim({
        sourceId: source.id,
        subject: 'Price',
        predicate: 'amount',
        value: '$100',
        valueType: 'price',
      });
      const claimB = dbManager.createClaim({
        sourceId: source.id,
        subject: 'Price',
        predicate: 'amount',
        value: '$150',
        valueType: 'price',
      });

      const contradiction = dbManager.createContradiction({
        claimAId: claimA.id,
        claimBId: claimB.id,
        contradictionType: 'VALUE_MISMATCH',
        severity: 'MEDIUM',
        explanation: 'Conflicting price quotes',
      });

      const resolved = dbManager.updateContradictionStatus(contradiction.id, 'RESOLVED');
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.resolvedAt).toBeInstanceOf(Date);

      const fetched = dbManager.getContradictionById(contradiction.id);
      expect(fetched?.status).toBe('RESOLVED');
      expect(fetched?.resolvedAt).not.toBeNull();
    });

    it('rejects self-contradiction where claimAId equals claimBId', () => {
      const source = dbManager.createSource({ name: 'Source', type: 'manual' });
      const claim = dbManager.createClaim({
        sourceId: source.id,
        subject: 'Status',
        predicate: 'state',
        value: 'active',
        valueType: 'status',
      });

      expect(() => {
        dbManager.createContradiction({
          claimAId: claim.id,
          claimBId: claim.id,
          contradictionType: 'STATUS_MISMATCH',
          severity: 'LOW',
          explanation: 'Claim cannot contradict itself',
        });
      }).toThrow(ValidationError);
    });
  });

  describe('Foreign-Key Enforcement', () => {
    it('fails when inserting a Claim with non-existent sourceId', () => {
      expect(() => {
        dbManager.createClaim({
          sourceId: 'non-existent-source-uuid-12345',
          subject: 'Test',
          predicate: 'test',
          value: 'value',
          valueType: 'status',
        });
      }).toThrow(DatabaseError);
    });

    it('fails when inserting a Contradiction with non-existent claimId', () => {
      const source = dbManager.createSource({ name: 'Source', type: 'manual' });
      const validClaim = dbManager.createClaim({
        sourceId: source.id,
        subject: 'Valid',
        predicate: 'claim',
        value: '1',
        valueType: 'quantity',
      });

      expect(() => {
        dbManager.createContradiction({
          claimAId: validClaim.id,
          claimBId: 'non-existent-claim-uuid-99999',
          contradictionType: 'QUANTITY_MISMATCH',
          severity: 'LOW',
          explanation: 'Non-existent claim reference',
        });
      }).toThrow(DatabaseError);
    });

    it('cascades deletion of Source to its Claims and associated Contradictions', () => {
      const sourceA = dbManager.createSource({ name: 'Source A', type: 'github' });
      const sourceB = dbManager.createSource({ name: 'Source B', type: 'website' });

      const claimA = dbManager.createClaim({
        sourceId: sourceA.id,
        subject: 'Release Date',
        predicate: 'date',
        value: '2026-01-01',
        valueType: 'date',
      });

      const claimB = dbManager.createClaim({
        sourceId: sourceB.id,
        subject: 'Release Date',
        predicate: 'date',
        value: '2026-06-01',
        valueType: 'date',
      });

      const contradiction = dbManager.createContradiction({
        claimAId: claimA.id,
        claimBId: claimB.id,
        contradictionType: 'DATE_MISMATCH',
        severity: 'MEDIUM',
        explanation: 'Conflicting release dates',
      });

      // Deleting sourceA should cascade delete claimA and the contradiction referencing claimA
      const deleted = dbManager.deleteSource(sourceA.id);
      expect(deleted).toBe(true);

      expect(dbManager.getSourceById(sourceA.id)).toBeNull();
      expect(dbManager.getClaimById(claimA.id)).toBeNull();
      // claimB from sourceB remains
      expect(dbManager.getClaimById(claimB.id)).not.toBeNull();
      // Contradiction referencing claimA should be cascade deleted
      expect(dbManager.getContradictionById(contradiction.id)).toBeNull();
    });
  });
});
