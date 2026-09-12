# Contradiction MCP: Connector Guide

## 1. Connector Subsystem Overview

Connectors are responsible for fetching raw data from external systems, extracting factual assertions (claims), and recording provenance metadata.

All connectors implement the standard interface:

```typescript
export interface Connector<TInput, TRawData> {
  readonly type: string;
  readonly metadata: ConnectorMetadata;
  readonly security: ConnectorSecurityDescriptor;
  testConnection(input?: TInput): Promise<ConnectionTestResult>;
  fetch(input: TInput): Promise<FetchResult<TRawData>>;
  extractClaims(fetchResult: FetchResult<TRawData>): Promise<ExtractedClaim[]>;
}
```

---

## 2. GitHub Connector (`type: 'github'`)

- **Purpose**: Ingests repository metadata and file contents from public or private GitHub repositories.
- **Inputs**:
  - `owner`: Repository owner (user or organization).
  - `repo`: Repository name.
  - `branch` (optional): Branch or commit ref (defaults to default branch).
  - `paths` (optional): Subsets of files to inspect.
- **Target Files Inspected**:
  - `package.json`: Extracts `node_version` (via engines), dependencies, scripts.
  - `Dockerfile`: Extracts base image tags, exposed ports, environment variables.
  - `README.md`: Extracts architecture declarations, ports, and version statements.
  - `.github/workflows/*.yml`: Extracts CI matrix versions and setup actions.
- **Authentication**: Optional personal access token passed via `GITHUB_TOKEN` environment variable to support higher rate limits and private repositories.

---

## 3. Local Document Connector (`type: 'document'`)

- **Purpose**: Ingests files directly from the local filesystem with exact line provenance.
- **Inputs**:
  - `filePath`: Absolute or relative path to file.
  - `sourceName` (optional): Human-readable name for source.
  - `subject` (optional): Subject entity name (defaults to file basename).
  - `scope` (optional): Scope tag (e.g., `deployment`, `file`, `global`).
  - `environment` (optional): Target environment (`production`, `staging`, `development`).
  - `sourceRole` (optional): Role (`deployment`, `configuration`, `specification`, `documentation`).
- **Supported File Types**:
  - `.json`: Parses top-level and nested primitive values.
  - `.yaml`, `.yml`: Parses YAML scalar mappings.
  - `.md`, `.txt`: Extracts key-value pairs (e.g. `node_version: 20`, `port: 8080`) and heading contexts.
  - `.csv`: Extracts tabular key-value rows.
  - `.pdf`: Parses binary PDF documents via `pdf-parse`, generating claims with page-numbered (`provenance.page`) and line-numbered provenance.
- **Security Defenses**:
  - **Directory Root Containment**: When `allowedRoots` is configured, prevents directory traversal attacks (`../`) and symlink escapes pointing outside allowed document directories.
  - **Max File Size Limit**: Enforces `maxFileSizeBytes` (default: 10MB) to prevent memory exhaustion from oversized documents.

---

## 4. Public Website Connector (`type: 'website'`)

- **Purpose**: Crawls designated public HTTP/HTTPS URLs with SSRF protection.
- **Inputs**:
  - `url`: Target web URL.
  - `sourceName` (optional): Descriptive label.
  - `subject` (optional): Subject entity name.
  - `timeoutMs` (optional): HTTP request timeout (default: 10000ms).
- **Security**: Validates URL protocol and hostname through DNS pre-flight to prevent connections to loopback or private RFC 1918 subnets.
