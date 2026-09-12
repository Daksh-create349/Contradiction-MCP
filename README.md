# Contradiction MCP

[![CI](https://github.com/contradiction-mcp/contradiction-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/contradiction-mcp/contradiction-mcp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-2.0.0-blue.svg)](https://modelcontextprotocol.io/)
[![Protocol](https://img.shields.io/badge/Protocol-2026--07--28-purple.svg)](https://modelcontextprotocol.io/)

A production-grade Model Context Protocol (MCP) server designed to continuously detect, track, explain, and resolve conflicting, inconsistent, outdated, or mutually incompatible factual assertions across heterogeneous systems—code repositories, deployment manifests, technical documentation, API specifications, and public web endpoints.

---

## The Problem It Solves

Modern engineering and knowledge workflows rely on dispersed, uncoordinated sources of truth:

- **Code repositories**: `package.json`, `Dockerfile`, `.github/workflows/*.yml`
- **Deployment manifests**: Helm charts, Kubernetes YAML, JSON configuration files
- **Technical documentation**: Architecture guides, `README.md`, developer portals
- **Public endpoints**: Web pages, status feeds, API specifications

When information between these systems diverges—such as a deployment manifest specifying Node 22 while documentation references Node 18, or two documents listing contradictory port bindings or pricing tiers—silent regressions, operational outages, and flawed decisions occur.

**Contradiction MCP** bridges these silos through automated ingestion, context-aware contradiction reasoning, source authority and freshness scoring, human-in-the-loop review/resolution workflows, and immutable audit trails.

---

## Core Capabilities

- **Zero Mocks**: Real SQLite storage, real filesystem I/O, real HTTP fetchers with pre-flight DNS validation.
- **Context-Aware Contradiction Engine**: Eliminates false positives by reasoning across environments (`production` vs. `development`), scopes (`file` vs. `deployment`), roles (`deployment` vs. `documentation`), and matrix compatibility sets.
- **SemVer Range Satisfaction**: Detects genuine major/minor incompatibilities using deterministic version algebra.
- **Multi-Source Ingestion**:
  - **GitHub Connector**: Inspects runtime engines, Dockerfiles, workflows, and READMEs.
  - **Local Document Connector**: Ingests JSON, YAML, Markdown, CSV, and PDF files with exact page- and line-numbered citations and directory root containment.
  - **Public Website Connector**: Web crawler hardened with multi-layer SSRF protection against loopback and cloud metadata endpoints.
- **Scoring & Advisory Intelligence**:
  - `AuthorityScorer`: Evaluates source role hierarchies and trust weights.
  - `FreshnessScorer`: Applies exponential half-life time decay models.
  - `EvidenceEvaluator`: Scores citation directness and snippet quality.
  - `ResolutionAdvisor`: Generates actionable resolution recommendations without mutating state without operator consent.
- **Review & Resolution Workflows**: Full lifecycle transitions (`OPEN`, `REVIEWED`, `RESOLVED`, `DISMISSED`, `REOPENED`) with append-only audit histories.
- **Multi-Transport Support**: Runs over standard Stdio (for Claude Desktop, Antigravity, Cursor) or streamable HTTP/SSE with Bearer API key authentication and rate limiting.

---

## System Architecture

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

## MCP Interface Reference

### 21 Active MCP Tools

| Tool Name                       | Category     | Description                                                          |
| ------------------------------- | ------------ | -------------------------------------------------------------------- |
| `health_check`                  | System       | Health status, database latency, uptime, and connector counts        |
| `analyze_claim_pair`            | Analysis     | Deterministic pairwise contradiction analysis between two claim IDs  |
| `scan_for_contradictions`       | Discovery    | Automated knowledge-base-wide scan with candidate indexing           |
| `scan_claim_for_contradictions` | Discovery    | Incremental contradiction scan for a newly added claim               |
| `list_contradictions`           | Discovery    | Filter contradictions by status, severity, and limit                 |
| `get_contradiction`             | Discovery    | Full contradiction details with Claim A/B and Source A/B records     |
| `explain_claim_relationship`    | Analysis     | Deep breakdown of context factors, environment, and SemVer bounds    |
| `advise_resolution`             | Intelligence | Advisory recommendation comparing authority, freshness, and evidence |
| `review_contradiction`          | Governance   | Marks contradiction as under review with operator notes              |
| `resolve_contradiction`         | Governance   | Resolves contradiction with winning claim and audit reason           |
| `dismiss_contradiction`         | Governance   | Dismisses false-positive or expected discrepancy with rationale      |
| `reopen_contradiction`          | Governance   | Reopens a previously resolved or dismissed contradiction             |
| `get_contradiction_history`     | Audit        | Immutable chronological history of all lifecycle transitions         |
| `get_claim_history`             | Audit        | Append-only audit history of claim values and supersessions          |
| `list_connectors`               | Ingestion    | Lists registered connectors, status, and capabilities                |
| `test_github_connection`        | Ingestion    | Tests accessibility and rate limits for GitHub repository            |
| `sync_github_repository`        | Ingestion    | Syncs repository files, extracts claims, and runs discovery          |
| `sync_document`                 | Ingestion    | Ingests local file (JSON/YAML/MD/CSV) with line provenance           |
| `sync_website`                  | Ingestion    | Ingests web URL with SSRF protection and claim extraction            |
| `sync_source`                   | Ingestion    | Generic single-source synchronization                                |
| `sync_sources`                  | Ingestion    | Bounded-concurrency batch synchronization                            |

### 4 MCP Resources

- `contradiction://{id}`: Live contradiction payload and constituent claim details.
- `claim://{id}`: Claim details, provenance, and contextual attributes.
- `source://{id}`: Source metadata, URI, and trust score.
- `health://metrics`: Server uptime, tool invocations, and contradiction counters.

### 2 MCP Prompts

- `investigate_contradiction`: Step-by-step guidance for investigating and resolving a contradiction.
- `review_source_consistency`: Step-by-step guidance for reviewing cross-source consistency.

---

## Quickstart & Setup

### Prerequisites

- Node.js >= 20.0.0
- npm >= 9.0.0

### Quick Setup: One Command for Any IDE Worldwide

Users worldwide can auto-install Contradiction MCP into their editor with one command:

```bash
# Install to Google Antigravity
npx -y contradiction-mcp install antigravity

# Install to Cursor IDE
npx -y contradiction-mcp install cursor

# Install to Claude Desktop
npx -y contradiction-mcp install claude

# Install to Claude Code CLI
npx -y contradiction-mcp install claude-code

# Install to Windsurf
npx -y contradiction-mcp install windsurf

# Install across ALL detected IDEs simultaneously
npx -y contradiction-mcp install all
```

Or if cloned locally from source:

```bash
npm install && npm run build
node bin/cli.js install [antigravity|cursor|claude|claude-code|all]
```

### Running via Stdio (IDE & Desktop Clients)

```bash
node dist/index.js
```

### Running as Streamable HTTP Daemon

```bash
MCP_TRANSPORT=http HTTP_PORT=3000 node dist/index.js
```

### Docker Deployment

```bash
docker build -t contradiction-mcp:latest .
docker compose up -d
```

---

## Documentation Index

- [Architecture Guide](docs/architecture.md): Layered design and component interaction.
- [Security Model](docs/security.md): Threat model, SSRF defenses, and SQL injection prevention.
- [Connectors Reference](docs/connectors.md): GitHub, Document, and Website connector details.
- [Database & Migrations](docs/database.md): Schema design and audit table specifications.
- [Operations & Runbook](docs/operations.md): Docker deployment, health checks, and backups.
- [Testing Guide](docs/testing.md): Zero-mock policy, test suites, and acceptance testing.
- [Practical Examples](docs/examples.md): Step-by-step walkthroughs of common scenarios.

---

## Verification & Quality Gates

```bash
# Typecheck (0 errors)
npm run typecheck

# Lint (0 errors, 0 warnings)
npm run lint

# Code Formatting Check
npm run format:check

# Automated Tests (169 passing tests across 23 suites)
npm test

# Production Build
npm run build

# Live MCP Stdio & Streamable HTTP Smoke Verification
npm run live-test
```

---

## License

MIT © Contradiction MCP Contributors
