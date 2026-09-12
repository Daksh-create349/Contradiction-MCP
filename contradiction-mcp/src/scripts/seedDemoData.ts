import { DatabaseManager } from '../storage/database.js';
import { DiscoveryService } from '../discovery/discoveryService.js';
import { logger } from '../utils/logger.js';

export function seedDemoData(dbManager: DatabaseManager): {
  sourcesCreated: number;
  claimsCreated: number;
  contradictionsDetected: number;
} {
  logger.info('Seeding DEMO dataset for Contradiction MCP...');

  // 1. Source A: GitHub Repository (Operational Configuration)
  const sourceA = dbManager.createSource({
    externalId: 'github:acme-corp/api-gateway',
    type: 'github',
    name: 'acme-corp/api-gateway (Production Repository)',
    uri: 'https://github.com/acme-corp/api-gateway',
    trustScore: 0.95,
    metadata: {
      isDemo: true,
      repository: 'acme-corp/api-gateway',
      branch: 'main',
    },
  });

  // 2. Source B: Documentation Document
  const sourceB = dbManager.createSource({
    externalId: 'document:docs/deployment_guide.md',
    type: 'document',
    name: 'Deployment Guide (Markdown)',
    uri: 'file://docs/deployment_guide.md',
    trustScore: 0.6,
    metadata: {
      isDemo: true,
      filePath: 'docs/deployment_guide.md',
    },
  });

  // 3. Source C: Public Website
  const sourceC = dbManager.createSource({
    externalId: 'website:https://api.acme.com/info',
    type: 'website',
    name: 'Acme API Status Portal',
    uri: 'https://api.acme.com/info',
    trustScore: 0.7,
    metadata: {
      isDemo: true,
      url: 'https://api.acme.com/info',
    },
  });

  let claimsCreated = 0;

  // Claim 1: Dockerfile runtime in Source A (Operational truth: Node 22)
  dbManager.createClaim({
    sourceId: sourceA.id,
    subject: 'API Server',
    predicate: 'node_version',
    value: '22',
    valueType: 'version',
    normalizedValue: '22.0.0',
    confidence: 1.0,
    environment: 'production',
    scope: 'service',
    sourceRole: 'deployment',
    isHistorical: false,
    observedAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    metadata: {
      filePath: 'Dockerfile',
      line: 1,
      snippet: 'FROM node:22-alpine',
      extractionMethod: 'regex',
    },
  });
  claimsCreated++;

  // Claim 2: Outdated README documentation in Source B (Discrepancy: Node 18)
  dbManager.createClaim({
    sourceId: sourceB.id,
    subject: 'API Server',
    predicate: 'node_version',
    value: '18',
    valueType: 'version',
    normalizedValue: '18.0.0',
    confidence: 0.9,
    environment: 'production',
    scope: 'service',
    sourceRole: 'documentation',
    isHistorical: false,
    observedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60), // 60 days ago
    metadata: {
      filePath: 'docs/deployment_guide.md',
      line: 42,
      snippet: 'Requires Node.js version 18 or higher for production deployment.',
      extractionMethod: 'markdown_pattern',
    },
  });
  claimsCreated++;

  // Claim 3: Historical claim in Source A (Historical transition: Node 20)
  dbManager.createClaim({
    sourceId: sourceA.id,
    subject: 'API Server',
    predicate: 'node_version',
    value: '20',
    valueType: 'version',
    normalizedValue: '20.0.0',
    confidence: 1.0,
    environment: 'production',
    scope: 'service',
    sourceRole: 'historical',
    isHistorical: true,
    observedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 180), // 180 days ago
    metadata: {
      filePath: 'package.json.old',
      snippet: '"node": "20.x"',
      extractionMethod: 'json_parse',
    },
  });
  claimsCreated++;

  // Claim 4: CI Compatibility Matrix (Node 20, 22, 24 in workflows - non-contradictory)
  dbManager.createClaim({
    sourceId: sourceA.id,
    subject: 'API Server',
    predicate: 'node_version',
    value: '20',
    valueType: 'version',
    normalizedValue: '20.0.0',
    confidence: 0.95,
    environment: 'ci',
    scope: 'workflow',
    sourceRole: 'configuration',
    isHistorical: false,
    multiValueContext: 'ci_matrix',
    observedAt: new Date(),
    metadata: {
      filePath: '.github/workflows/ci.yml',
      snippet: 'node-version: [20, 22, 24]',
    },
  });
  claimsCreated++;

  // Claim 5: Port specification in Source A (Config: 8080)
  dbManager.createClaim({
    sourceId: sourceA.id,
    subject: 'API Gateway',
    predicate: 'http_port',
    value: '8080',
    valueType: 'quantity',
    environment: 'production',
    scope: 'service',
    sourceRole: 'configuration',
    isHistorical: false,
    observedAt: new Date(),
    metadata: {
      filePath: 'config/production.json',
      snippet: '"port": 8080',
    },
  });
  claimsCreated++;

  // Claim 6: Port specification in Source C (Website: 443)
  dbManager.createClaim({
    sourceId: sourceC.id,
    subject: 'API Gateway',
    predicate: 'http_port',
    value: '443',
    valueType: 'quantity',
    environment: 'production',
    scope: 'public_web',
    sourceRole: 'documentation',
    isHistorical: false,
    observedAt: new Date(),
    metadata: {
      url: 'https://api.acme.com/info',
      snippet: 'Gateway listening on standard TLS port 443',
    },
  });
  claimsCreated++;

  // Run discovery scan
  const discoveryService = new DiscoveryService(dbManager);
  const scanResult = discoveryService.scanAllClaims();

  logger.info('Demo data seed complete', {
    sources: 3,
    claims: claimsCreated,
    contradictions: scanResult.contradictionsFound,
  });

  return {
    sourcesCreated: 3,
    claimsCreated,
    contradictionsDetected: scanResult.contradictionsFound,
  };
}
