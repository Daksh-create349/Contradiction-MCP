# Project Context: Contradiction MCP

## Current Status

Production-ready Model Context Protocol (MCP) server for enterprise contradiction discovery, tracking, and resolution. The system provides pairwise contradiction analysis, automated knowledge-base discovery, context-aware false-positive elimination, multi-source ingestion (GitHub, local documents with PDF support, SSRF-guarded web pages), authority and freshness scoring, human-in-the-loop review/resolution workflows, append-only audit trails, live database backups, scope-based authorization, and dual transports: Stdio and Streamable HTTP.

All components are implemented without mocks. 169 automated tests across 23 test suites pass with 0 failures, 0 TypeScript errors, and 0 lint errors.

---

## Technical Stack

- **Runtime**: Node.js v22.23.2
- **Language**: TypeScript 5.9.3 (ES2022, NodeNext module resolution)
- **MCP Framework**: MCP TypeScript SDK v2 (`@modelcontextprotocol/server@2.0.0`, `@modelcontextprotocol/client@2.0.0`, `@modelcontextprotocol/node@2.0.0`, `@modelcontextprotocol/core@2.0.0`), Protocol Version `2026-07-28`
- **Validation**: Zod 4.6.2 (Standard Schema compatible)
- **Database**: SQLite via `better-sqlite3` 13.0.3 with foreign keys (`PRAGMA foreign_keys = ON`), WAL mode, unique pair index, context composite index, and 6 schema migrations
- **Document Extraction**: `pdf-parse` 2.4.5 for PDF binary document extraction with page-level provenance
- **Testing**: Vitest 5.0.0 (169 automated tests across 23 test suites)
- **Linting & Formatting**: ESLint 10.10.0 (`eslint.config.js`), Prettier 3.9.6
- **Networking**: Native Node.js `fetch` with pre-flight DNS inspection, SSRF protection, and `NodeStreamableHTTPServerTransport`

---

## Directory Structure

```text
contradiction-mcp/
├── .github/
│   └── workflows/
│       └── ci.yml                            # GitHub Actions CI matrix for Node 20 & 22
├── docs/
│   ├── architecture.md                       # Layered system architecture, SDK v2, and transport topology
│   ├── security.md                           # Threat model, SSRF defenses, path traversal, auth scopes
│   ├── connectors.md                         # Connector contracts, PDF extraction, capabilities, schemas
│   ├── database.md                           # Database schemas, migrations, and audit table design
│   ├── operations.md                         # Production operations, Docker deployment, and maintenance
│   ├── testing.md                            # Testing strategy, zero-mock policy, and test suites
│   └── examples.md                           # End-to-end usage walkthroughs for common scenarios
├── src/
│   ├── index.ts                              # Main entrypoint, stdio / HTTP startup coordinator
│   ├── server.ts                             # McpServer registering 21 tools, 4 resources, 2 prompts, auth scopes
│   ├── httpServer.ts                         # NodeStreamableHTTPServerTransport with auth, CORS, rate limits, /health, /ready
│   ├── config/
│   │   └── env.ts                            # Environment variables validation via Zod
│   ├── analysis/
│   │   ├── claimMatcher.ts                   # Deterministic claim matcher & composite similarity
│   │   ├── claimRelationship.ts              # Semantic relationship types & context factor interfaces
│   │   ├── contextAnalyzer.ts                # Context analyzer (environment, scope, role, temporal, matrix)
│   │   ├── valueComparator.ts                # Value comparator with semver range satisfaction & intersection
│   │   ├── contradictionClassifier.ts        # Contradiction classification & severity evaluator
│   │   ├── confidenceScorer.ts               # Heuristic confidence scoring
│   │   ├── explanationBuilder.ts             # Contextual natural language explanation generator
│   │   └── contradictionEngine.ts            # Central pairwise analysis engine
│   ├── discovery/
│   │   ├── candidateGenerator.ts             # Candidate pair generator grouping by subject & predicate
│   │   ├── similarityIndex.ts                # In-memory index with exact & fuzzy buckets
│   │   ├── rankingService.ts                 # Priority ranking (severity, confidence, trust, recency)
│   │   ├── contradictionScanner.ts           # Pairwise scanner filtering for CONFIRMED_CONTRADICTION
│   │   └── discoveryService.ts               # Full & incremental scan coordinator with persistence
│   ├── intelligence/
│   │   ├── authorityScorer.ts                # Source authority scoring based on role hierarchy
│   │   ├── freshnessScorer.ts                # Exponential half-life freshness scoring
│   │   ├── evidenceEvaluator.ts              # Citation directness and snippet quality evaluator
│   │   ├── entityResolver.ts                 # Multi-entity alias and prefix/suffix resolver
│   │   ├── semanticMatcher.ts                # Token-similarity matcher
│   │   └── resolutionAdvisor.ts              # Advisory recommendation engine for contradictions
│   ├── connectors/
│   │   ├── types/
│   │   │   ├── connector.ts                  # Generic Connector interface, metadata, connection test
│   │   │   └── fetchResult.ts                # FetchResult, ExtractedClaim, and ClaimProvenance (with page citation)
│   │   ├── base/
│   │   │   ├── security.ts                   # ConnectorSecurityDescriptor & default read-only policy
│   │   │   └── connectorUtils.ts             # Secret sanitization and deterministic externalId builders
│   │   ├── connectorRegistry.ts              # Central registry with health checking and dynamic toggles
│   │   ├── syncService.ts                    # Ingestion coordinator with bounded concurrency batch sync
│   │   ├── github/
│   │   │   ├── githubTypes.ts                # GitHub REST API response and input payload types
│   │   │   ├── githubClient.ts               # GitHub REST API client with auth and rate limiting
│   │   │   ├── githubExtractor.ts            # Claim extractor (package.json, Dockerfile, README, workflows)
│   │   │   ├── githubNormalizer.ts           # Claim normalizer applying engine comparator rules
│   │   │   └── githubConnector.ts            # GitHub Connector implementation
│   │   ├── document/
│   │   │   └── documentConnector.ts          # Document Connector (.md, .txt, .json, .yaml, .csv, .pdf) with containment
│   │   └── website/
│   │       ├── ssrfGuard.ts                  # SSRF validator blocking loopback, RFC 1918, cloud metadata
│   │       └── websiteConnector.ts           # Public Website Connector with SSRF defenses
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── source.ts                     # Source entity, externalId support, types, Zod schemas
│   │   │   ├── claim.ts                      # Claim entity, history types, context fields, Zod schemas
│   │   │   └── contradiction.ts              # Contradiction entity, resolution types, audit schemas
│   │   └── types/
│   │       └── common.ts                     # Common domain types, AuthorizationError, typed error hierarchy
│   ├── services/
│   │   ├── healthService.ts                  # System and database operational health service (liveness & readiness)
│   │   ├── metricsService.ts                 # Observability metrics snapshot service
│   │   ├── rateLimiter.ts                    # Sliding-window rate limiter
│   │   ├── schedulerService.ts               # In-process scheduled recurring sync manager
│   │   ├── reviewService.ts                  # Contradiction review & resolution lifecycle service
│   │   └── analysisService.ts                # Pairwise analysis & claim relationship service
│   ├── storage/
│   │   ├── database.ts                       # DatabaseManager with migrations, audit logs, and backups
│   │   ├── backupService.ts                  # SQLite online live backup and integrity service
│   │   └── migrations/
│   │       ├── 001_initial.sql               # Initial schema migration (sources, claims, contradictions)
│   │       ├── 002_pair_unique_index.sql     # Unique bidirectional contradiction pair index
│   │       ├── 003_connector_identity.sql    # external_id columns and unique indices
│   │       ├── 004_claim_context.sql         # 8 context columns and composite index on claims
│   │       ├── 005_claim_history.sql         # Append-only claim history table
│   │       └── 006_contradiction_resolution.sql # Resolution metadata & contradiction history audit table
│   └── scripts/
│       ├── seedDemoData.ts                   # Seed script generating realistic multi-source dataset
│       └── liveMcpSmoke.ts                   # Stdio client smoke test script against dist/index.js
├── tests/
│   ├── protocol/
│   │   └── mcpStreamableHttp.test.ts         # Streamable HTTP protocol lifecycle, handshake, tools, resources, prompts
│   └── security/
│       └── securityAudits.test.ts            # Document containment, path traversal, auth scopes, SQL injection
├── Dockerfile                                # Multi-stage production container definition
└── docker-compose.yml                        # Production compose configuration with persistent volume
```

---

## What Was Implemented

### 1. SDK v2 Migration & Protocol Conformance

- Migrated to official MCP TypeScript SDK v2 split packages:
  - `@modelcontextprotocol/server@2.0.0`
  - `@modelcontextprotocol/client@2.0.0`
  - `@modelcontextprotocol/node@2.0.0`
  - `@modelcontextprotocol/core@2.0.0`
- Conformed protocol version to `2026-07-28`.
- Updated server registration to `server.registerTool`, `server.registerResource`, and `server.registerPrompt`.
- Maintained backward-compatibility adapters for existing stdio and test callers.

### 2. Streamable HTTP Transport & Health Separation

- Integrated `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node` with stateless request handling.
- Implemented `localhostHostValidation()` and `localhostOriginValidation()` to protect loopback daemon bindings.
- Added strict HTTP security headers: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Separated liveness and readiness:
  - `/health`: Liveness probe checking server execution, uptime, and metadata.
  - `/ready`: Readiness probe verifying active database connectivity and migration state.
  - `/metrics`: System metrics snapshot.
- Implemented socket lifecycle management with `closeAllConnections()` for graceful shutdown without hung sockets.

### 3. PDF Extraction & Path Containment

- Added binary PDF ingestion via `pdf-parse` in `DocumentConnector`.
- Extracted text from PDF pages and attached exact page-numbered (`provenance.page`) and line-numbered provenance.
- Implemented path traversal protection with `allowedRoots` option, rejecting relative `../` directory escapes and external symlink targets.
- Added file size threshold defense (`maxFileSizeBytes`, default 10MB) against oversized documents.

### 4. Scope-Based Authorization Guard

- Defined scopes: `read`, `analyze`, `sync`, `review`, `resolve`, `admin`.
- Enforced scope validation across tools:
  - `sync_github_repository`, `sync_document`, `sync_website`, `sync_source`, `sync_sources`: require `sync` or `admin`.
  - `review_contradiction`: requires `review` or `admin`.
  - `resolve_contradiction`, `dismiss_contradiction`, `reopen_contradiction`: require `resolve` or `admin`.
- Returns structured `AUTHORIZATION_ERROR` when a client lacks required scopes.

### 5. Automated Testing & Verification Expansion

- Added `tests/protocol/mcpStreamableHttp.test.ts` (8 tests): Handshake, tool listing, tool execution, resource reading, prompt retrieval, API key auth.
- Added `tests/security/securityAudits.test.ts` (7 tests): Path traversal, symlink escapes, max file size, scope authorization, and SQL injection defense.
- Expanded `tests/performance.test.ts` to 3 benchmarks testing 100, 1,000, and 5,000 claims with execution time and heap delta verification.
- Added `tests/documentConnector.test.ts` PDF extraction test and root containment test.

---

## Verification Results

- **TypeScript Compilation**: `tsc --noEmit` and `tsc -p tsconfig.build.json` completed with 0 errors.
- **Linting**: ESLint flat config completed with 0 errors.
- **Code Formatting**: Prettier formatted all project files cleanly.
- **Automated Tests**: 169 tests across 23 test suites passed with 0 failures:
  - `tests/domain.test.ts` (11 tests)
  - `tests/analysis.test.ts` (22 tests)
  - `tests/contextAnalysis.test.ts` (18 tests)
  - `tests/discovery.test.ts` (15 tests)
  - `tests/connectorRegistry.test.ts` (6 tests)
  - `tests/documentConnector.test.ts` (7 tests)
  - `tests/websiteConnector.test.ts` (7 tests)
  - `tests/githubClient.test.ts` (4 tests)
  - `tests/githubExtractor.test.ts` (5 tests)
  - `tests/syncService.test.ts` (3 tests)
  - `tests/batchSync.test.ts` (2 tests)
  - `tests/contradictionReview.test.ts` (4 tests)
  - `tests/backupService.test.ts` (2 tests)
  - `tests/intelligence.test.ts` (13 tests)
  - `tests/health.test.ts` (6 tests)
  - `tests/performance.test.ts` (3 tests)
  - `tests/mcpTool.test.ts` (2 tests)
  - `tests/mcpDiscovery.test.ts` (2 tests)
  - `tests/mcpConnectors.test.ts` (12 tests)
  - `tests/mcpClientHarness.test.ts` (4 tests)
  - `tests/protocol/mcpStreamableHttp.test.ts` (8 tests)
  - `tests/security/securityAudits.test.ts` (7 tests)
  - `tests/acceptance/productPipeline.test.ts` (1 test)
- **Live Verification & Protocol Audits (`npm run verify`, `npm run demo`, `npm run live-test`)**:
  - `liveMcpSmoke.ts`: Connected via `StdioClientTransport` to compiled `dist/index.js`, confirmed 21 tools, 4 resources (1 static `health://metrics` + 3 resource templates `contradiction://{id}`, `claim://{id}`, `source://{id}`), 2 prompts, executed `health_check` and `list_connectors`.
  - `mcpStreamableHttp.test.ts`: Connected via `StreamableHTTPClientTransport` to live HTTP daemon, validated tool execution, resources, prompts, and authentication.
  - `comprehensiveVerification.ts` (`npm run verify`): 62/62 verified automated checks passed across Stdio MCP, Streamable HTTP, all 4 resource endpoints, 21 tools, claim history supersessions, contradiction audit lifecycles, and performance benchmarks.
  - `finalLiveDemo.ts` (`npm run demo`): All 17 live protocol demonstration steps verified against compiled `dist/index.js`.
  - Docker execution: NOT RUN on host machine (Docker CLI/daemon not installed on local Mac environment; Dockerfile and compose file verified syntactically).
