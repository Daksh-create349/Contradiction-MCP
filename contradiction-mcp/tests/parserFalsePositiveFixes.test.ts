import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DocumentConnector } from '../src/connectors/document/documentConnector.js';
import {
  inferClaimValueType,
  isIpOrNetworkAddress,
} from '../src/connectors/base/connectorUtils.js';
import { ValueComparator } from '../src/analysis/valueComparator.js';
import { ClaimMatcher, areOrthogonalPredicates } from '../src/analysis/claimMatcher.js';
import { ContradictionEngine } from '../src/analysis/contradictionEngine.js';
import { Claim } from '../src/domain/entities/claim.js';

describe('Parser Heuristics & False-Positive Elimination Tests', () => {
  let tempDir: string;
  let connector: DocumentConnector;
  let comparator: ValueComparator;
  let matcher: ClaimMatcher;
  let engine: ContradictionEngine;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'contra-fp-test-')));
    connector = new DocumentConnector();
    comparator = new ValueComparator();
    matcher = new ClaimMatcher();
    engine = new ContradictionEngine();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('1. Network & SemVer Disambiguation', () => {
    it('correctly identifies IP addresses and network endpoints', () => {
      expect(isIpOrNetworkAddress('127.0.0.1')).toBe(true);
      expect(isIpOrNetworkAddress('0.0.0.0')).toBe(true);
      expect(isIpOrNetworkAddress('192.168.1.1:8080')).toBe(true);
      expect(isIpOrNetworkAddress('10.0.0.0/16')).toBe(true);
      expect(isIpOrNetworkAddress('localhost')).toBe(true);
      expect(isIpOrNetworkAddress('::1')).toBe(true);

      expect(isIpOrNetworkAddress('v2.0.0')).toBe(false);
      expect(isIpOrNetworkAddress('3.12.0')).toBe(false);
      expect(isIpOrNetworkAddress('8080')).toBe(false);
    });

    it('infers address valueType for host/ip, and quantity for port', () => {
      expect(inferClaimValueType('host', '127.0.0.1')).toBe('address');
      expect(inferClaimValueType('bind_address', '0.0.0.0')).toBe('address');
      expect(inferClaimValueType('server_ip', '192.168.1.100')).toBe('address');
      expect(inferClaimValueType('port', '3000')).toBe('quantity');
      expect(inferClaimValueType('listen_port', '8080')).toBe('quantity');
      expect(inferClaimValueType('node_version', '22.0.0')).toBe('version');
    });

    it('ValueComparator refuses to normalize IP addresses as SemVer', () => {
      expect(comparator.normalizeVersion('127.0.0.1')).toBeNull();
      expect(comparator.cleanSemverRange('127.0.0.1')).toBeNull();

      const comp = comparator.compare('127.0.0.1', '3000');
      expect(comp.valueType).not.toBe('version');
      expect(comp.differenceType).not.toBe('VERSION_MISMATCH');
      expect(comp.differenceType).not.toBe('MAJOR_VERSION_MISMATCH');
    });
  });

  describe('2. Predicate Orthogonality & Section Prefix Isolation', () => {
    it('detects orthogonal predicate pairs (host vs port, min vs max)', () => {
      expect(areOrthogonalPredicates('host', 'port')).toBe(true);
      expect(areOrthogonalPredicates('server_host', 'server_port')).toBe(true);
      expect(areOrthogonalPredicates('bind_address', 'listen_port')).toBe(true);
      expect(areOrthogonalPredicates('min_memory', 'max_memory')).toBe(true);
      expect(areOrthogonalPredicates('db_user', 'db_password')).toBe(true);

      // Non-orthogonal pairs
      expect(areOrthogonalPredicates('port', 'listen_port')).toBe(false);
      expect(areOrthogonalPredicates('node_version', 'runtime_node_version')).toBe(false);
    });

    it('ClaimMatcher rejects matching host against port', () => {
      const match = matcher.match(
        { subject: 'README', predicate: 'host' },
        { subject: 'README', predicate: 'port' },
      );
      expect(match.matches).toBe(false);
      expect(match.predicateSimilarity).toBe(0);
    });

    it('ClaimMatcher prevents section prefix inflation from matching disparate configuration keys', () => {
      // Disparate leaves under identical long section prefix
      const match1 = matcher.match(
        { subject: 'README', predicate: '2_configuration_quantum_config_yaml_host' },
        { subject: 'README', predicate: '2_configuration_quantum_config_yaml_port' },
      );
      expect(match1.matches).toBe(false);

      const match2 = matcher.match(
        { subject: 'README', predicate: '2_configuration_quantum_config_yaml_host' },
        { subject: 'README', predicate: '2_configuration_quantum_config_yaml_persistent_storage' },
      );
      expect(match2.matches).toBe(false);

      const match3 = matcher.match(
        { subject: 'README', predicate: 'system_requirements_compatibility_requirement' },
        { subject: 'README', predicate: 'system_requirements_compatibility_architecture' },
      );
      expect(match3.matches).toBe(false);

      // Same leaf under identical prefix should match
      const matchSame = matcher.match(
        { subject: 'README', predicate: '2_configuration_quantum_config_yaml_port' },
        { subject: 'README', predicate: '2_configuration_quantum_config_yaml_port' },
      );
      expect(matchSame.matches).toBe(true);
    });

    it('ContradictionEngine safely dismisses host vs port or host vs boolean comparisons', () => {
      const claimHost: Claim = {
        id: 'c-host',
        sourceId: 's1',
        subject: 'README',
        predicate: '2_configuration_quantum_config_yaml_host',
        value: '127.0.0.1',
        valueType: 'address',
        sourceRole: 'configuration',
        isHistorical: false,
        confidence: 1.0,
        observedAt: new Date(),
        createdAt: new Date(),
        metadata: {},
      };

      const claimPort: Claim = {
        id: 'c-port',
        sourceId: 's1',
        subject: 'README',
        predicate: '2_configuration_quantum_config_yaml_port',
        value: '3000',
        valueType: 'quantity',
        sourceRole: 'configuration',
        isHistorical: false,
        confidence: 1.0,
        observedAt: new Date(),
        createdAt: new Date(),
        metadata: {},
      };

      const claimStorage: Claim = {
        id: 'c-storage',
        sourceId: 's1',
        subject: 'README',
        predicate: '2_configuration_quantum_config_yaml_persistent_storage',
        value: 'true',
        valueType: 'status',
        sourceRole: 'configuration',
        isHistorical: false,
        confidence: 1.0,
        observedAt: new Date(),
        createdAt: new Date(),
        metadata: {},
      };

      const analysis1 = engine.analyzePair(claimHost, claimPort);
      expect(analysis1.isContradiction).toBe(false);
      expect(analysis1.analysisStatus).toBe('NOT_A_CONTRADICTION');

      const analysis2 = engine.analyzePair(claimHost, claimStorage);
      expect(analysis2.isContradiction).toBe(false);
      expect(analysis2.analysisStatus).toBe('NOT_A_CONTRADICTION');
    });
  });

  describe('3. Markdown Table & Header Alignment', () => {
    it('skips table headers and delimiters, extracting multi-column rows with qualified keys', async () => {
      const mdPath = path.join(tempDir, 'spec.md');
      fs.writeFileSync(
        mdPath,
        `# System Requirements

| Requirement | Minimum | Recommended |
| :--- | :--- | :--- |
| Python | 3.12+ | 3.13 |
| Architecture | x86_64, ARM64 | x86_64, ARM64 |
| JS Runtime | None | Node 20+ |
`,
      );

      const fetchResult = await connector.fetch({ filePath: mdPath });
      const claims = await connector.extractClaims(fetchResult);

      // Verify header row was NOT extracted as claim
      const headerClaim = claims.find(
        (c) => c.predicate.includes('requirement') && c.value === 'Minimum',
      );
      expect(headerClaim).toBeUndefined();

      // Verify qualified columns were extracted
      const pyMin = claims.find((c) => c.predicate.includes('python_minimum'));
      expect(pyMin).toBeDefined();
      expect(pyMin?.value).toBe('3.12+');

      const pyRec = claims.find((c) => c.predicate.includes('python_recommended'));
      expect(pyRec).toBeDefined();
      expect(pyRec?.value).toBe('3.13');

      const archMin = claims.find((c) => c.predicate.includes('architecture_minimum'));
      expect(archMin).toBeDefined();
      expect(archMin?.value).toBe('x86_64, ARM64');
    });
  });

  describe('4. Badge & Semantic Prose Extraction', () => {
    it('extracts build status badges and detects contradictory badges', async () => {
      const mdPath = path.join(tempDir, 'badges.md');
      fs.writeFileSync(
        mdPath,
        `# Project Status

[![CI Passing](https://img.shields.io/badge/build-passing-brightgreen)](https://ci.example.com)
[![CI Failing](https://img.shields.io/badge/build-failing-red)](https://ci.example.com)
`,
      );

      const fetchResult = await connector.fetch({ filePath: mdPath });
      const claims = await connector.extractClaims(fetchResult);

      const passingBadge = claims.find(
        (c) => c.predicate === 'build_status' && c.value === 'passing',
      );
      const failingBadge = claims.find(
        (c) => c.predicate === 'build_status' && c.value === 'failing',
      );

      expect(passingBadge).toBeDefined();
      expect(failingBadge).toBeDefined();

      const analysis = engine.analyzePair(
        {
          id: 'c-pass',
          sourceId: 's1',
          subject: 'badges',
          predicate: passingBadge!.predicate,
          value: passingBadge!.value,
          valueType: passingBadge!.valueType,
          sourceRole: 'documentation',
          isHistorical: false,
          confidence: 1.0,
          observedAt: new Date(),
          createdAt: new Date(),
          metadata: {},
        },
        {
          id: 'c-fail',
          sourceId: 's1',
          subject: 'badges',
          predicate: failingBadge!.predicate,
          value: failingBadge!.value,
          valueType: failingBadge!.valueType,
          sourceRole: 'documentation',
          isHistorical: false,
          confidence: 1.0,
          observedAt: new Date(),
          createdAt: new Date(),
          metadata: {},
        },
      );

      expect(analysis.isContradiction).toBe(true);
      expect(analysis.contradictionType).toBe('STATUS_MISMATCH');
    });

    it('extracts license and commercial use assertions', async () => {
      const mdPath = path.join(tempDir, 'license.md');
      fs.writeFileSync(
        mdPath,
        `# License

Licensed under the MIT License.
Commercial use is strictly prohibited without written consent.
`,
      );

      const fetchResult = await connector.fetch({ filePath: mdPath });
      const claims = await connector.extractClaims(fetchResult);

      const licClaim = claims.find((c) => c.predicate === 'license');
      expect(licClaim).toBeDefined();
      expect(licClaim?.value).toBe('MIT');

      const commClaim = claims.find((c) => c.predicate === 'commercial_use');
      expect(commClaim).toBeDefined();
      expect(commClaim?.value).toBe('prohibited');
    });
  });
});
