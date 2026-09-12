# Contradiction MCP: System Architecture

## 1. High-Level Architecture Overview

Contradiction MCP is an enterprise-grade Model Context Protocol (MCP) server that continuously detects, tracks, reviews, and resolves factual contradictions across heterogeneous software assets (code repositories, deployment manifests, technical documentation, API specifications, and public websites).

The system is constructed with a clean, decoupled layered architecture:

```
+-----------------------------------------------------------------------------------+
|                                MCP Protocol Layer                                 |
|   - StdioServerTransport (CLI / IDE clients: Claude Desktop, Antigravity, Cursor)  |
|   - Streamable HTTP Transport (SSE / POST /mcp with API key auth & rate limiting)  |
|   - 21 MCP Tools | 4 Resources | 2 Prompt Templates                               |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                             Operational & Domain Services                         |
|   - AnalysisService        - ReviewService          - SyncService                 |
|   - DiscoveryService       - HealthService          - MetricsService              |
|   - BackupService          - SchedulerService       - RateLimiter                 |
+-----------------------------------------------------------------------------------+
         |                                |                                |
         v                                v                                v
+-------------------+            +-------------------+            +-------------------+
|  Ingestion Layer  |            |  Intelligence &   |            |   Storage Layer   |
|   (Connectors)    |            |   Analysis Core   |            |     (SQLite)      |
| - GitHubConnector |            | - Contradiction-  |            | - better-sqlite3  |
| - Document-       |            |   Classifier      |            | - WAL mode        |
|   Connector       |            | - AuthorityScorer |            | - Foreign keys    |
| - Website-        |            | - FreshnessScorer |            | - 6 Migrations    |
|   Connector       |            | - EvidenceEvaluator|           | - Full Audit Trail|
| - SSRF Guard      |            | - EntityResolver  |            | - Online Backup   |
+-------------------+            +-------------------+            +-------------------+
```

---

## 2. Ingestion & Connector Architecture

The connector subsystem abstracts external data sources through a unified contract (`Connector<TInput, TRawData>`):

- **GitHub Connector**: Communicates with the GitHub REST API (or local mock/fixture trees in testing) to inspect runtime versions, environment variables, dependencies, and port bindings across `Dockerfile`, `package.json`, `README.md`, and `.github/workflows/*.yml`.
- **Local Document Connector**: Ingests files directly from the local filesystem (`.json`, `.yaml`, `.yml`, `.md`, `.txt`, `.csv`), parsing factual key-value declarations and recording exact line-numbered provenance.
- **Website Connector**: Crawls designated HTTP/HTTPS URLs with strict SSRF defenses, extracting factual text statements and configuration parameters.
- **SyncService**: Coordinates bounded-concurrency batch synchronization, idempotently creating/updating source records and claims, followed by incremental discovery passes.

---

## 3. Analysis & Intelligence Engine

The core analysis pipeline avoids naive combinatorial explosion through indexed candidate generation:

1. **Candidate Generation**: Claims are indexed by normalized subject and predicate compatibility.
2. **Context Analyzer**: Evaluates environment tags (`production`, `staging`, `development`), scope hierarchy (`global`, `service`, `file`), and temporal validity windows to eliminate false positives.
3. **Contradiction Classifier**: Employs deterministic comparator logic across types:
   - `VALUE_MISMATCH`: Mutually incompatible numeric, boolean, or categorical values.
   - `VERSION_MISMATCH`: SemVer compatibility and major/minor range mismatches.
   - `TEMPORAL_MISMATCH`: Stale information superseded by newer documentation or configurations.
   - `AUTHORITY_MISMATCH`: Low-trust informal documentation contradicting authoritative production manifests.
   - `CONFIGURATION_MISMATCH`: Port, host, or environment configuration disparities.
4. **Scoring & Resolution Advisory**:
   - `AuthorityScorer`: Evaluates source role (`deployment` > `configuration` > `specification` > `documentation` > `informal`) and trust weight.
   - `FreshnessScorer`: Applies exponential half-life decay to timestamps.
   - `EvidenceEvaluator`: Scores line-level citation quality, snippet length, and extraction directness.
   - `ResolutionAdvisor`: Produces actionable, advisory-only resolution recommendations without mutating state without operator consent.

---

## 4. Storage & Audit Architecture

Data persistence is managed via `better-sqlite3` with ACID transactional guarantees:

- SQLite WAL (Write-Ahead Logging) mode and `PRAGMA foreign_keys = ON`.
- Normalized relational schema:
  - `sources`: Source metadata, URIs, trust scores, fetch timestamps.
  - `claims`: Canonical subject-predicate-value facts with metadata, validity windows, and source references.
  - `claim_history`: Complete append-only audit trail recording every state change and supersession.
  - `contradictions`: Identified conflict pairs with severity, status, and classification.
  - `contradiction_history`: Immutable transition log (`REVIEWED`, `RESOLVED`, `DISMISSED`, `REOPENED`) capturing operator IDs, timestamps, chosen claim IDs, and rationale.

---

## 5. MCP Protocol Implementation & Security Model

Contradiction MCP implements the official MCP TypeScript SDK v2 specification (`2026-07-28`):

- **Package Architecture**: Powered by modular split packages (`@modelcontextprotocol/server@2.0.0`, `@modelcontextprotocol/client@2.0.0`, `@modelcontextprotocol/node@2.0.0`, `@modelcontextprotocol/core@2.0.0`).
- **Dual Transports**:
  - `StdioServerTransport`: High-performance inter-process communication for desktop agents and IDEs (Claude Desktop, Antigravity, Cursor).
  - `NodeStreamableHTTPServerTransport`: Production-grade Streamable HTTP daemon with stateless request handling, rate limiting, and HTTP security headers (`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`).
- **Endpoint Topology**:
  - `/mcp` & `/`: Core JSON-RPC 2.0 Streamable HTTP endpoint.
  - `/health`: Liveness endpoint returning server metadata, SDK version (`@modelcontextprotocol/server`), and protocol version (`2026-07-28`).
  - `/ready`: Kubernetes-compatible readiness probe validating database connectivity and migration state.
  - `/metrics`: System metrics snapshot (uptime, tool invocations, sync counts, contradiction tallies).
- **Scope-Based Authorization Guard**: Fine-grained capability checks across operations:
  - `read`: Query contradictions, claims, sources, and metrics.
  - `analyze`: Pairwise comparison and context relationship explanation.
  - `sync`: External data ingestion and source synchronizations.
  - `review`: Marking contradictions as reviewed.
  - `resolve`: Authoritatively resolving or dismissing contradictions.
  - `admin`: Superuser access encompassing all operations.
