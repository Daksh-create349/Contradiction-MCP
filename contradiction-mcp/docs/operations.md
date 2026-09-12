# Contradiction MCP: Operations & Deployment Guide

## 1. Deployment Modes

Contradiction MCP can be run in two primary modes:

### Mode A: Stdio MCP Server (Default)

Used for direct integration with AI desktop clients and IDEs (e.g. Claude Desktop, Antigravity, Cursor):

```bash
node dist/index.js
```

Configure in Claude Desktop or Antigravity config:

```json
{
  "mcpServers": {
    "contradiction": {
      "command": "node",
      "args": ["/absolute/path/to/contradiction-mcp/dist/index.js"],
      "env": {
        "CONTRADICTION_DB_PATH": "/absolute/path/to/contradiction-mcp/data/contradiction.db"
      }
    }
  }
}
```

### Mode B: Streamable HTTP Daemon

Used for remote microservice deployment and continuous background contradiction monitoring:

```bash
CONTRADICTION_HTTP_ENABLED=true CONTRADICTION_HTTP_PORT=3000 node dist/index.js
```

Endpoints exposed:

- `GET /health`: Health status of server, database latency, and connector counts.
- `GET /metrics`: Observability counters, tool invocation stats, and memory utilization.
- `POST /mcp`: Streamable MCP endpoint supporting SSE connections with optional Bearer API key.

---

## 2. Docker & Container Deployment

Contradiction MCP ships with a multi-stage `Dockerfile` and `docker-compose.yml`:

### Building & Running with Docker

```bash
# Build the container
docker build -t contradiction-mcp:latest .

# Run with docker compose
docker compose up -d
```

The container runs as an unprivileged user (`node`), contains an automated healthcheck, and stores the SQLite database in a persistent named volume mounted at `/app/data`.

---

## 3. Database Maintenance & Backups

The server includes a dedicated `BackupService`:

- Online non-blocking SQLite live backup to specified directories.
- Automated file naming with ISO timestamps (`contradiction-backup-YYYY-MM-DD...db`).
- Retention policy management (`cleanOldBackups(retentionDays)`).
- Integrity verification tool (`PRAGMA integrity_check`).
