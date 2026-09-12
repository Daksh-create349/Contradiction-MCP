# Contradiction MCP

[![CI](https://github.com/contradiction-mcp/contradiction-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/contradiction-mcp/contradiction-mcp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-2.0.0-blue.svg)](https://modelcontextprotocol.io/)
[![Protocol](https://img.shields.io/badge/Protocol-2026--07--28-purple.svg)](https://modelcontextprotocol.io/)

A production-grade Model Context Protocol (MCP) server designed to continuously detect, track, explain, and resolve conflicting, inconsistent, outdated, or mutually incompatible factual assertions across heterogeneous systems—code repositories, deployment manifests, technical documentation, API specifications, and public web endpoints.

---

## Table of Contents

- [The Problem It Solves](#the-problem-it-solves)
- [Core Capabilities](#core-capabilities)
- [System Architecture](#system-architecture)
- [One-Command Quickstart (All IDEs)](#one-command-quickstart-all-ides)
- [Manual IDE Client Configuration](#manual-ide-client-configuration)
- [Complete Command Reference](#complete-command-reference)
- [Environment Variables](#environment-variables)
- [Step-by-Step Hands-On Testing Tutorial](#step-by-step-hands-on-testing-tutorial)
- [MCP Interface: 21 Tools, 4 Resources, 2 Prompts](#mcp-interface-21-tools-4-resources-2-prompts)
- [Example Tool Payloads & Responses](#example-tool-payloads--responses)
- [Production Operations & Runbook](#production-operations--runbook)
- [Docker & Docker Compose](#docker--docker-compose)
- [Automated Tests & Quality Gates](#automated-tests--quality-gates)
- [Documentation Index](#documentation-index)
- [License](#license)

---

## The Problem It Solves

Modern engineering workflows rely on dispersed, uncoordinated sources of truth:

- **Code repositories**: `package.json`, `Dockerfile`, `.github/workflows/*.yml`
- **Deployment manifests**: Helm charts, Kubernetes YAML, JSON configuration files
- **Technical documentation**: Architecture guides, `README.md`, developer portals
- **Public endpoints**: Web pages, status feeds, API specifications

When information diverges—such as a deployment manifest specifying Node 22 while documentation references Node 18, or two documents listing contradictory port bindings or database engines—silent regressions, operational outages, and flawed decisions occur.

**Contradiction MCP** bridges these silos through automated multi-source ingestion, context-aware contradiction reasoning, source authority and freshness scoring, human-in-the-loop review/resolution workflows, and immutable audit trails.

---

## Core Capabilities

- **Zero Mocks**: Real SQLite storage, real filesystem I/O, real HTTP fetchers with pre-flight DNS validation.
- **Context-Aware Contradiction Engine**: Eliminates false positives by reasoning across environments (`production` vs. `development`), scopes (`file` vs. `deployment`), roles (`deployment` vs. `documentation`), and matrix compatibility sets.
- **SemVer Range Satisfaction**: Detects genuine major/minor incompatibilities using deterministic version algebra.
- **Multi-Source Ingestion**:
  - **GitHub Connector**: Inspects runtime engines, Dockerfiles, workflows, and READMEs.
  - **Local Document Connector**: Ingests JSON, YAML, Markdown, CSV, TXT, and PDF files with exact page- and line-numbered citations and directory root containment.
  - **Public Website Connector**: Web crawler hardened with multi-layer SSRF protection against loopback, private IPv4/IPv6, and cloud metadata endpoints.
- **Scoring & Advisory Intelligence**:
  - `AuthorityScorer`: Evaluates source role hierarchies and trust weights.
  - `FreshnessScorer`: Applies exponential half-life time decay models.
  - `EvidenceEvaluator`: Scores citation directness and snippet quality.
  - `ResolutionAdvisor`: Generates actionable resolution recommendations without mutating state without operator consent.
- **Review & Resolution Workflows**: Full lifecycle transitions (`OPEN`, `REVIEWED`, `RESOLVED`, `DISMISSED`, `REOPENED`) with append-only audit histories.
- **Multi-Transport Support**: Runs over standard Stdio (for Claude Desktop, Antigravity, Cursor) or streamable HTTP/SSE with Bearer API key authentication and rate limiting.

---

## System Architecture

```text
+-----------------------------------------------------------------------------------+
|                                MCP Protocol Layer                                 |
|   - StdioServerTransport (CLI / IDE clients: Claude Desktop, Antigravity, Cursor)  |
|   - Streamable HTTP Transport (POST /mcp with API key auth & sliding rate limits)  |
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
|   Connector (PDF) |            | - AuthorityScorer |            | - Foreign keys    |
| - Website-        |            | - FreshnessScorer |            | - 6 Migrations    |
|   Connector       |            | - EvidenceEvaluator|           | - Full Audit Trail|
| - SSRF Guard      |            | - EntityResolver  |            | - Online Backup   |
+-------------------+            +-------------------+            +-------------------+
```

---

## One-Command Quickstart (All IDEs)

You can automatically configure Contradiction MCP into your favorite editor with a single command:

### Universal CLI Setup (Worldwide)

```bash
# Google Antigravity (configured in ~/.gemini/config/mcp_config.json and workspace)
npx -y contradiction-mcp install antigravity

# Cursor IDE (configured in ~/.cursor/mcp.json and workspace)
npx -y contradiction-mcp install cursor

# Claude Desktop App (configured in claude_desktop_config.json)
npx -y contradiction-mcp install claude

# Claude Code CLI (configured in ~/.claude.json & via claude mcp add)
npx -y contradiction-mcp install claude-code

# Windsurf IDE (configured in ~/.codeium/windsurf/mcp_config.json)
npx -y contradiction-mcp install windsurf

# Configure ALL detected IDEs simultaneously
npx -y contradiction-mcp install all
```

### Local Setup from Cloned Source

```bash
git clone https://github.com/contradiction-mcp/contradiction-mcp.git
cd contradiction-mcp
npm install
npm run build

# Automatically configure in your current environment:
npm run install-mcp
# Or target a specific IDE:
node bin/cli.js install [antigravity|cursor|claude|claude-code|windsurf|all]
```

---

## Manual IDE Client Configuration

If you prefer to configure your MCP client manually, add the following JSON blocks:

### 1. Claude Desktop (`claude_desktop_config.json`)

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "contradiction": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/contradiction-mcp/dist/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DATABASE_PATH": "/ABSOLUTE/PATH/TO/contradiction-mcp/data/contradiction.db",
        "MCP_TRANSPORT": "stdio",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### 2. Google Antigravity (`mcp_config.json`)

- **Global**: `~/.gemini/config/mcp_config.json`
- **Workspace**: `<workspace-root>/.agents/mcp_config.json`

```json
{
  "mcpServers": {
    "contradiction": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/contradiction-mcp/dist/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DATABASE_PATH": "/ABSOLUTE/PATH/TO/contradiction-mcp/data/contradiction.db"
      }
    }
  }
}
```

### 3. Cursor IDE (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "contradiction": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/contradiction-mcp/dist/index.js"]
    }
  }
}
```

### 4. Streamable HTTP Remote Client

To connect multiple agents or team members to a central server:

```json
{
  "mcpServers": {
    "contradiction": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_API_KEY"
      }
    }
  }
}
```

---

## Complete Command Reference

| Command                  | Description                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `npm run build`          | Compiles TypeScript (`tsconfig.build.json`) and copies SQL migrations to `dist/storage/migrations/`. |
| `npm start`              | Runs the compiled production server (`node dist/index.js`).                                          |
| `npm run dev`            | Runs the development server via `tsx` with hot TypeScript execution.                                 |
| `npm test`               | Runs the full Vitest automated test suite (169 tests across 23 files).                               |
| `npm run test:coverage`  | Generates V8 code coverage report in `coverage/` directory.                                          |
| `npm run verify`         | Runs 62 automated end-to-end audit verification gates (protocol, security, heuristics, benchmarks).  |
| `npm run demo`           | Runs the live 17-step demonstration pipeline (multi-source sync -> contradiction -> resolution).     |
| `npm run smoke`          | Launches compiled server and executes real MCP Stdio smoke tests.                                    |
| `npm run live-test`      | Runs stdio smoke test followed by the full Streamable HTTP integration test suite.                   |
| `npm run typecheck`      | Validates static TypeScript typing (`tsc --noEmit`) with 0 errors.                                   |
| `npm run lint`           | Runs ESLint flat config across all source and test files.                                            |
| `npm run format:check`   | Verifies that all code adheres to Prettier formatting rules.                                         |
| `npm run format`         | Auto-formats all project files using Prettier.                                                       |
| `npm run install-mcp`    | Automatically configures MCP settings across Antigravity, Cursor, and Claude.                        |
| `npm run migrate`        | Runs all pending SQLite database migrations (`001` through `006`).                                   |
| `npm run seed`           | Populates the database with realistic multi-source demonstration data.                               |
| `npm run backup`         | Executes an online live SQLite backup to the `backups/` directory.                                   |
| `npm run restore <path>` | Restores the database from a specified backup file.                                                  |
| `npm run health`         | Queries the system health service and outputs JSON status.                                           |
| `npm run security:check` | Runs `npm audit` to inspect dependency security vulnerabilities.                                     |

---

## Environment Variables

| Variable               | Default                   | Description                                                             |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `NODE_ENV`             | `development`             | Runtime mode: `development`, `test`, or `production`.                   |
| `DATABASE_PATH`        | `./data/contradiction.db` | Filepath to SQLite database file or `:memory:`.                         |
| `MCP_TRANSPORT`        | `stdio`                   | Transport mode: `stdio` or `http`.                                      |
| `HTTP_PORT`            | `3000`                    | Port for Streamable HTTP server when `MCP_TRANSPORT=http`.              |
| `HTTP_HOST`            | `127.0.0.1`               | Binding address for HTTP daemon (protected with DNS rebinding guards).  |
| `API_KEY`              | _(optional)_              | Secret bearer token required for HTTP authentication.                   |
| `GITHUB_TOKEN`         | _(optional)_              | Personal Access Token to avoid GitHub API 60 req/hr rate limits.        |
| `LOG_LEVEL`            | `info`                    | Logging verbosity: `debug`, `info`, `warn`, `error`.                    |
| `ALLOWED_ROOTS`        | `.`                       | Comma-separated directory paths permitted for local document ingestion. |
| `MAX_FILE_SIZE_BYTES`  | `10485760` (10MB)         | Max document upload size to protect against memory exhaustion.          |
| `RATE_LIMIT_MAX`       | `100`                     | Maximum requests permitted within rate limit window.                    |
| `RATE_LIMIT_WINDOW_MS` | `60000` (1 min)           | Sliding rate limiter window in milliseconds.                            |

---

## Step-by-Step Hands-On Testing Tutorial

### Tutorial 1: Detecting Real Document Contradictions in 30 Seconds

```bash
cd contradiction-mcp

# 1. Create two documents describing the same API server:
cat << 'EOF' > /tmp/deployment_spec.json
{
  "node_version": "22.0.0",
  "database": "postgres-16"
}
EOF

cat << 'EOF' > /tmp/architecture_guide.md
# Architecture Guide
node_version: 18.0.0
database: postgres-14
EOF

# 2. Run test script to sync and scan:
npx tsx -e '
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";

async function main() {
  const client = new Client({ name: "tester", version: "1.0.0" }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));

  // Ingest Deployment Spec (role: deployment)
  await client.callTool({
    name: "sync_document",
    arguments: { filePath: "/tmp/deployment_spec.json", subject: "api-server", sourceRole: "deployment", environment: "production" }
  });

  // Ingest Architecture Guide (role: documentation)
  await client.callTool({
    name: "sync_document",
    arguments: { filePath: "/tmp/architecture_guide.md", subject: "api-server", sourceRole: "documentation", environment: "production" }
  });

  // Automatically scan knowledge base
  const scan = await client.callTool({ name: "scan_for_contradictions", arguments: {} });
  console.log("\nDISCOVERED CONTRADICTIONS:\n", JSON.stringify(JSON.parse(scan.content[0].text), null, 2));

  await client.close();
}
main();
'
```

### Tutorial 2: Testing Streamable HTTP Daemon with `curl`

```bash
# Terminal 1: Start HTTP daemon
MCP_TRANSPORT=http HTTP_PORT=3000 node dist/index.js

# Terminal 2: Test endpoints
# Liveness probe:
curl http://localhost:3000/health

# Readiness probe (verifies database connectivity):
curl http://localhost:3000/ready

# Live observability metrics:
curl http://localhost:3000/metrics
```

---

## MCP Interface: 21 Tools, 4 Resources, 2 Prompts

### Active MCP Tools (21)

1. **`health_check`**: Checks server execution state, database connection latency, and table counts.
2. **`analyze_claim_pair`**: Runs pairwise contradiction analysis between two specific claim IDs.
3. **`scan_for_contradictions`**: Scans the entire knowledge base for conflicting assertions.
4. **`scan_claim_for_contradictions`**: Incrementally scans candidate pairs for a newly added claim.
5. **`list_contradictions`**: Lists detected contradictions filtered by status (`OPEN`, `REVIEWED`, `RESOLVED`, `DISMISSED`) and severity.
6. **`get_contradiction`**: Retrieves complete contradiction record with both Claim A/B and Source A/B details.
7. **`explain_claim_relationship`**: Explains contextual factors (environments, scopes, roles, SemVer compatibility).
8. **`advise_resolution`**: Heuristically compares authority, freshness, and evidence quality to recommend the winning claim.
9. **`review_contradiction`**: Transitions contradiction to `REVIEWED` status with reviewer identity and notes.
10. **`resolve_contradiction`**: Resolves contradiction by selecting the canonical claim with justification.
11. **`dismiss_contradiction`**: Dismisses expected differences (e.g., dev vs prod matrix) with reason.
12. **`reopen_contradiction`**: Reopens a previously resolved or dismissed contradiction.
13. **`get_contradiction_history`**: Returns the chronological, immutable audit trail of state transitions.
14. **`get_claim_history`**: Returns the history of values and supersessions for a specific claim.
15. **`list_connectors`**: Lists registered ingestion connectors (`github`, `document`, `website`) and capabilities.
16. **`test_github_connection`**: Tests accessibility and rate-limit headroom for a GitHub repository.
17. **`sync_github_repository`**: Ingests package.json, Dockerfile, README, and workflows from GitHub.
18. **`sync_document`**: Ingests local files (.json, .yaml, .md, .csv, .txt, .pdf) with exact line/page citations.
19. **`sync_website`**: Ingests web URLs with pre-flight SSRF protection.
20. **`sync_source`**: Generic single-source synchronization trigger.
21. **`sync_sources`**: Bounded-concurrency batch synchronization.

### Active MCP Resources (4)

- **`health://metrics`**: Static snapshot of server uptime, tool invocations, and contradiction tallies.
- **`contradiction://{id}`**: Dynamic resource returning live contradiction data for a specific ID.
- **`claim://{id}`**: Dynamic resource returning factual claim details, context, and provenance.
- **`source://{id}`**: Dynamic resource returning source metadata, type, and trust score.

### Active MCP Prompts (2)

- **`investigate_contradiction`**: Interactive agent prompt guiding investigation, contextual analysis, and resolution.
- **`review_source_consistency`**: Agent prompt guiding cross-source consistency audits.

---

## Example Tool Payloads & Responses

### 1. Ingesting a Document (`sync_document`)

**Input Arguments**:

```json
{
  "filePath": "/tmp/deployment_spec.json",
  "subject": "api-server",
  "scope": "deployment",
  "environment": "production",
  "sourceRole": "deployment"
}
```

**Output**:

```json
{
  "success": true,
  "sourceId": "76be8d2f-1e3b-48fd-922f-1b499251ac2b",
  "claimsCreated": 2,
  "claimsUpdated": 0
}
```

### 2. Scanning for Contradictions (`scan_for_contradictions`)

**Input Arguments**: `{}`
**Output**:

```json
{
  "status": "completed",
  "claimsScanned": 4,
  "candidatePairs": 2,
  "contradictionsFound": 2,
  "contradictions": [
    {
      "contradictionType": "VERSION_MISMATCH",
      "severity": "HIGH",
      "confidence": 1.0,
      "explanation": "Both claims describe the node_version for 'api-server'. However, architecture_guide.md reports '18.0.0' while deployment_spec.json reports '22.0.0'. Classified as VERSION_MISMATCH with HIGH severity.",
      "priorityScore": 0.93,
      "contradictionId": "2f1691be-9c1f-4e93-a86a-ef0c0ba54f9d"
    }
  ]
}
```

### 3. Asking for Resolution Advice (`advise_resolution`)

**Input Arguments**:

```json
{
  "contradictionId": "2f1691be-9c1f-4e93-a86a-ef0c0ba54f9d"
}
```

**Output**:

```json
{
  "recommendedClaimId": "a779fa4b-c680-482c-8f31-daf470aaaab7",
  "recommendedValue": "22.0.0",
  "confidenceScore": 0.88,
  "reasoning": "Claim B represents a higher-confidence candidate for current truth because it carries higher operational authority (0.85 vs 0.65) as deployment configuration and is equally fresh.",
  "authorityScoreA": 0.65,
  "authorityScoreB": 0.85
}
```

---

## Production Operations & Runbook

### Online Live Backup & Restore

Contradiction MCP supports zero-downtime SQLite online backups:

```bash
# Create live backup:
npm run backup
# Output: Backup created: ./backups/contradiction-backup-2026-09-12T04-35-42Z.db

# Restore from backup:
npm run restore ./backups/contradiction-backup-2026-09-12T04-35-42Z.db
```

### Operational Health & Readiness Probes

When deployed behind a load balancer (Kubernetes, AWS ECS, Cloud Run):

- **Liveness probe**: `GET /health` (returns 200 if Node.js process is active)
- **Readiness probe**: `GET /ready` (returns 200 if SQLite database connection is live and migrations are applied; returns 503 if database is unreachable)

---

## Docker & Docker Compose

### Run via Docker

```bash
# Build production image (multi-stage, non-root user):
docker build -t contradiction-mcp:latest .

# Run container with persistent data volume:
docker run -d \
  --name contradiction-mcp \
  -p 3000:3000 \
  -v contradiction-data:/app/data \
  -e MCP_TRANSPORT=http \
  -e HTTP_PORT=3000 \
  contradiction-mcp:latest
```

### Run via Docker Compose

```bash
docker compose up -d
docker compose ps
docker compose logs -f
```

---

## Automated Tests & Quality Gates

Contradiction MCP enforces strict production quality gates:

```bash
# 1. Typecheck: 0 TypeScript errors
npm run typecheck

# 2. Lint: ESLint flat config with 0 errors
npm run lint

# 3. Format Check: 100% Prettier compliant
npm run format:check

# 4. Automated Tests: 169 tests across 23 suites passing
npm test

# 5. Coverage: V8 test coverage
npm run test:coverage

# 6. Comprehensive Verification: 62 automated protocol & security gates
npm run verify

# 7. Live Demonstration: 17-step live pipeline
npm run demo
```

---

## Documentation Index

- [Architecture Guide](docs/architecture.md): Layered design, protocol topology, and component contracts.
- [Security Model](docs/security.md): SSRF defenses, directory containment, path traversal prevention, and auth scopes.
- [Connectors Reference](docs/connectors.md): GitHub, Document (PDF/JSON/YAML/CSV/TXT), and Website connectors.
- [Database & Migrations](docs/database.md): Schema definitions, audit tables, and WAL configuration.
- [Operations & Runbook](docs/operations.md): Backups, rate limiting, scheduling, and graceful shutdown.
- [Testing Strategy](docs/testing.md): Zero-mock philosophy, test suite itemization, and benchmarks.
- [Practical Examples](docs/examples.md): Detailed workflows for real-world contradiction scenarios.

---

## License

MIT © Contradiction MCP Contributors
