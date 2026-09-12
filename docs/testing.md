# Contradiction MCP: Testing Strategy & Verification

## 1. Zero-Mock Policy

In accordance with strict production requirements, production code never contains mocks or simulated stubs. Real SQLite databases (`:memory:` or on-disk), real filesystem operations, real network fetchers with SSRF guards, and real cryptographic hash functions are used throughout.

---

## 2. Test Suites Overview

The test harness uses `Vitest` with 23 dedicated test files covering 169 automated unit, integration, and acceptance tests (0 skipped, 0 todo, 0 failed):

1. `tests/contextAnalysis.test.ts`: Multi-environment compatibility matrices, historical documentation, scope disambiguation (22 tests).
2. `tests/analysis.test.ts`: Pairwise contradiction detection, SemVer rules, numeric thresholds (2 tests).
3. `tests/domain.test.ts`: Entities, Zod validations, immutability, and state transitions (2 tests).
4. `tests/syncService.test.ts`: External sync coordination, incremental discovery, touch tracking (6 tests).
5. `tests/githubExtractor.test.ts`: GitHub claim extraction logic, manifest parsers, workflow matrices (22 tests).
6. `tests/health.test.ts`: Health and readiness checks, database latency, table counts (4 tests).
7. `tests/discovery.test.ts`: Automated discovery engine, candidate grouping, indexing, ranking (20 tests).
8. `tests/intelligence.test.ts`: Authority scoring, freshness decay, evidence evaluation, entity resolution (7 tests).
9. `tests/mcpClientHarness.test.ts`: End-to-end MCP protocol client exercise over `InMemoryTransport` verifying tools, resources, and prompts (11 tests).
10. `tests/githubClient.test.ts`: Real GitHub REST client request mapping, headers, timeouts, and rate limits (9 tests).
11. `tests/performance.test.ts`: Performance benchmarks and candidate pair scaling (5 tests).
12. `tests/connectorRegistry.test.ts`: Dynamic connector registration, discovery, health checking (6 tests).
13. `tests/documentConnector.test.ts`: Real file parsing across JSON, Markdown, YAML, CSV, PDF with line/page provenance (13 tests).
14. `tests/contradictionReview.test.ts`: Lifecycle state machine (`REVIEWED`, `RESOLVED`, `DISMISSED`, `REOPENED`) and audit trail (4 tests).
15. `tests/mcpConnectors.test.ts`: Connector-specific MCP tools (`test_github_connection`, `sync_github_repository`) (3 tests).
16. `tests/mcpDiscovery.test.ts`: Discovery MCP tools (`scan_for_contradictions`, `get_contradiction`) (2 tests).
17. `tests/mcpTool.test.ts`: Core MCP tools (`health_check`, `analyze_claim_pair`) (2 tests).
18. `tests/backupService.test.ts`: SQLite online live backup, verification, and restore integrity checks (3 tests).
19. `tests/websiteConnector.test.ts`: SSRF defense verification, private IP rejection, metadata endpoint blocking (3 tests).
20. `tests/security/securityAudits.test.ts`: SQL injection, path traversal, auth scope bypass, oversized input protection (7 tests).
21. `tests/protocol/mcpStreamableHttp.test.ts`: Real NodeStreamableHTTPServerTransport and StreamableHTTPClientTransport with auth and rate limits (8 tests).
22. `tests/acceptance/productPipeline.test.ts`: End-to-end multi-source ingestion pipeline: Document ingestion -> Claim extraction -> Contradiction discovery -> Authority resolution advisory -> Human review -> Resolution -> Post-sync idempotency (1 test).
23. `tests/batchSync.test.ts`: Multi-source batch ingestion with bounded concurrency and failure isolation (2 tests).

**Total Verified Tests**: Exactly 169 passed across 23 test suites.

---

## 3. Running Verification

```bash
# Run typecheck
npm run typecheck

# Run linter
npm run lint

# Check formatting
npm run format:check

# Run full test suite
npm test

# Build production bundle
npm run build

# Run live stdio MCP smoke test against compiled binary
npx tsx src/scripts/liveMcpSmoke.ts
```
