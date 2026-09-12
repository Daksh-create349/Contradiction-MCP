# Contradiction MCP: Security Model & Hardening

## 1. Threat Model & Principles

Contradiction MCP operates in sensitive developer environments where it ingests code, manifests, and web pages. It enforces defense-in-depth principles across all components:

1. **Zero Unvalidated Input Execution**: No user or connector string is passed to `eval`, dynamic SQL, or shell interpreters.
2. **Read-Only Defaults**: All connectors declare immutable read-only security descriptors. No connector modifies remote repositories or documents.
3. **Strict Network Isolation & SSRF Defenses**: Network access is blocked for filesystem connectors and strictly validated for outbound web requests.
4. **Comprehensive Auditability**: All administrative actions and state transitions are logged with operator attribution.

---

## 2. Server-Side Request Forgery (SSRF) Guard

The `WebsiteConnector` enforces multi-layer SSRF validation via `src/connectors/website/ssrfGuard.ts`:

- **Protocol Enforcement**: Only `http:` and `https:` schemes are permitted. File, FTP, Gopher, and custom schemes are rejected.
- **Loopback & Private Network Blocking**:
  - `127.0.0.0/8` (IPv4 loopback)
  - `::1` (IPv6 loopback)
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 private subnets)
  - `169.254.0.0/16` (Link-local addresses)
  - `169.254.169.254` (Cloud metadata endpoint for AWS, GCP, Azure)
  - `fc00::/7` (IPv6 Unique Local Addresses)
  - `fe80::/10` (IPv6 Link-Local Addresses)
- **DNS Resolution Pre-flight**: Hostnames are resolved via Node `dns.promises.lookup` prior to connection. The resolved IP is inspected against the subnet blocklist.
- **Redirect Re-validation**: In the event of HTTP redirects (301, 302, 307, 308), the target location header is re-validated through the entire SSRF check before following.

---

## 3. Storage & SQL Injection Defenses

- All database queries are executed via prepared statements using parameter bindings (`?`).
- Schema migrations run sequentially with strict foreign-key integrity.
- Filesystem paths for database backups and local document ingestion undergo path resolution and containment checks.
- Maximum document file size limit (10MB) prevents memory exhaustion and zip-bomb style denial of service.

---

## 4. HTTP Transport Security

When running in HTTP/SSE daemon mode (`src/httpServer.ts`):

- **Authentication**: Optional Bearer API Key enforcement via `CONTRADICTION_API_KEY`.
- **Security Headers**: Injects `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Content-Security-Policy: default-src 'none'`.
- **Rate Limiting**: Sliding-window rate limiter limits clients to 100 requests per minute by default (configurable via `CONTRADICTION_RATE_LIMIT_MAX_REQUESTS`).
- **Bounded Request Payloads**: Request body limit capped at 1MB to prevent buffer overflow or DoS attacks.
