import { describe, it, expect } from 'vitest';
import { AuthorityScorer } from '../src/intelligence/authorityScorer.js';
import { FreshnessScorer } from '../src/intelligence/freshnessScorer.js';
import { EvidenceEvaluator } from '../src/intelligence/evidenceEvaluator.js';
import { EntityResolver } from '../src/intelligence/entityResolver.js';
import { SemanticMatcher } from '../src/intelligence/semanticMatcher.js';
import { ResolutionAdvisor } from '../src/intelligence/resolutionAdvisor.js';
import { Claim } from '../src/domain/entities/claim.js';
import { Source } from '../src/domain/entities/source.js';
import { Contradiction } from '../src/domain/entities/contradiction.js';

describe('Intelligence Layer Tests', () => {
  const sourceDeploy: Source = {
    id: 'src-deploy',
    type: 'github',
    name: 'Deploy Repo',
    trustScore: 0.95,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  };

  const sourceDoc: Source = {
    id: 'src-doc',
    type: 'document',
    name: 'Documentation',
    trustScore: 0.6,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  };

  const claimDeploy: Claim = {
    id: 'claim-1',
    sourceId: sourceDeploy.id,
    subject: 'API Server',
    predicate: 'node_version',
    value: '22',
    valueType: 'version',
    sourceRole: 'deployment',
    isHistorical: false,
    confidence: 1.0,
    observedAt: new Date(),
    createdAt: new Date(),
    metadata: {
      filePath: 'Dockerfile',
      line: 1,
      snippet: 'FROM node:22-alpine',
      extractionMethod: 'regex',
    },
  };

  const claimDoc: Claim = {
    id: 'claim-2',
    sourceId: sourceDoc.id,
    subject: 'API Server',
    predicate: 'node_version',
    value: '18',
    valueType: 'version',
    sourceRole: 'documentation',
    isHistorical: false,
    confidence: 0.9,
    observedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60), // 60 days ago
    createdAt: new Date(),
    metadata: {
      filePath: 'README.md',
      snippet: 'Node.js 18 required',
      extractionMethod: 'markdown_pattern',
    },
  };

  describe('AuthorityScorer', () => {
    it('scores deployment specification higher than documentation', () => {
      const scorer = new AuthorityScorer();
      const scoreDeploy = scorer.scoreAuthority(claimDeploy, sourceDeploy);
      const scoreDoc = scorer.scoreAuthority(claimDoc, sourceDoc);

      expect(scoreDeploy.score).toBeGreaterThan(scoreDoc.score);
      expect(scoreDeploy.score).toBeGreaterThanOrEqual(0.85);
      expect(scoreDoc.score).toBeLessThanOrEqual(0.65);
      expect(scoreDeploy.reasoning.length).toBeGreaterThan(0);
    });

    it('penalizes historical claims in authority scoring', () => {
      const scorer = new AuthorityScorer();
      const historicalClaim: Claim = {
        ...claimDeploy,
        sourceRole: 'historical',
        isHistorical: true,
      };
      const result = scorer.scoreAuthority(historicalClaim, sourceDeploy);
      expect(result.score).toBeLessThan(0.7);
    });
  });

  describe('FreshnessScorer', () => {
    it('rates recent claim higher than 60-day old claim', () => {
      const scorer = new FreshnessScorer();
      const freshDeploy = scorer.scoreFreshness(claimDeploy, sourceDeploy);
      const freshDoc = scorer.scoreFreshness(claimDoc, sourceDoc);

      expect(freshDeploy.score).toBeGreaterThan(freshDoc.score);
      expect(freshDeploy.observedAgeDays).toBeLessThan(1);
      expect(freshDoc.observedAgeDays).toBeGreaterThanOrEqual(59);
    });

    it('heavily penalizes claims explicitly flagged as historical', () => {
      const scorer = new FreshnessScorer();
      const historicalClaim: Claim = {
        ...claimDeploy,
        isHistorical: true,
      };
      const res = scorer.scoreFreshness(historicalClaim, sourceDeploy);
      expect(res.score).toBe(0.1);
      expect(res.isHistorical).toBe(true);
    });

    it('compares freshness between two claims', () => {
      const scorer = new FreshnessScorer();
      const cmp = scorer.compareFreshness(claimDeploy, claimDoc, sourceDeploy, sourceDoc);
      expect(cmp.winner).toBe('claimA');
      expect(cmp.differenceDays).toBeGreaterThan(50);
    });
  });

  describe('EvidenceEvaluator', () => {
    it('evaluates claim with line number and snippet as STRONG', () => {
      const evaluator = new EvidenceEvaluator();
      const evalDeploy = evaluator.evaluateEvidence(claimDeploy);
      expect(evalDeploy.quality).toBe('STRONG');
      expect(evalDeploy.hasLineProvenance).toBe(true);
      expect(evalDeploy.hasVerbatimSnippet).toBe(true);
    });

    it('evaluates claim lacking line provenance as MODERATE or WEAK', () => {
      const evaluator = new EvidenceEvaluator();
      const weakClaim: Claim = {
        ...claimDeploy,
        metadata: {},
      };
      const evalWeak = evaluator.evaluateEvidence(weakClaim);
      expect(evalWeak.score).toBeLessThan(0.6);
      expect(evalWeak.hasLineProvenance).toBe(false);
    });
  });

  describe('EntityResolver', () => {
    it('resolves normalized naming variations to the same logical entity', () => {
      const resolver = new EntityResolver();

      const match1 = resolver.resolveEntityMatch('api-server', 'API Server');
      expect(match1.isMatch).toBe(true);
      expect(match1.confidence).toBeGreaterThanOrEqual(0.9);

      const match2 = resolver.resolveEntityMatch('platform-gateway-service', 'gateway');
      expect(match2.isMatch).toBe(true);
      expect(match2.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('rejects clearly disparate entity names', () => {
      const resolver = new EntityResolver();
      const match = resolver.resolveEntityMatch('billing-service', 'user-database');
      expect(match.isMatch).toBe(false);
      expect(match.confidence).toBeLessThan(0.5);
    });

    it('ranks candidate matches by confidence', () => {
      const resolver = new EntityResolver();
      const candidates = ['api', 'billing', 'api-server', 'database'];
      const matches = resolver.findMatches('api-service', candidates);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].candidate).toMatch(/api/);
    });
  });

  describe('SemanticMatcher', () => {
    it('returns disabled status when configured as disabled', () => {
      const matcher = new SemanticMatcher({ enabled: false });
      const result = matcher.match('database port configuration', 'database listening port');
      expect(result.matched).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    it('identifies token-based similarity when enabled', () => {
      const matcher = new SemanticMatcher({ enabled: true, threshold: 0.5 });
      const result = matcher.match('database port number', 'database listening port');
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.matchedFeatures.length).toBeGreaterThan(0);
    });
  });

  describe('ResolutionAdvisor', () => {
    it('advises choosing Claim A when Claim A has higher authority and freshness', () => {
      const advisor = new ResolutionAdvisor();
      const contradiction: Contradiction = {
        id: 'contra-1',
        claimAId: claimDeploy.id,
        claimBId: claimDoc.id,
        contradictionType: 'VERSION_MISMATCH',
        severity: 'HIGH',
        confidence: 0.95,
        explanation: 'Version conflict between Dockerfile and README',
        status: 'OPEN',
        detectedAt: new Date(),
        metadata: {},
      };

      const advice = advisor.adviseResolution(
        contradiction,
        claimDeploy,
        claimDoc,
        sourceDeploy,
        sourceDoc,
      );

      expect(advice.likelyCurrentClaim).toBe('claimA');
      expect(advice.confidence).toBeGreaterThanOrEqual(0.7);
      expect(advice.recommendedAction).toContain("Accept Claim A ('22')");
      expect(advice.authorityComparison.winner).toBe('claimA');
      expect(advice.freshnessComparison.winner).toBe('claimA');
    });
  });
});
