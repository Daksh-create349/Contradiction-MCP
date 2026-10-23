import crypto from 'node:crypto';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import {
  NodeStreamableHTTPServerTransport,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import { RateLimiter, RateLimitExceededError } from './services/rateLimiter.js';
import { HealthService } from './services/healthService.js';
import { globalMetrics } from './services/metricsService.js';
import { logger } from './utils/logger.js';

export interface HttpServerOptions {
  /** Factory called once per MCP session to produce a fresh McpServer instance */
  serverFactory: () => McpServer;
  healthService: HealthService;
  port: number;
  host: string;
  apiKey?: string;
  rateLimiter?: RateLimiter;
}

export class McpHttpServer {
  private httpServer: http.Server | null = null;
  private readonly serverFactory: () => McpServer;
  private readonly healthService: HealthService;
  private readonly port: number;
  private readonly host: string;
  private readonly apiKey?: string;
  private readonly rateLimiter: RateLimiter;
  /** Session ID → transport for that session */
  private readonly sessions = new Map<string, NodeStreamableHTTPServerTransport>();

  constructor(options: HttpServerOptions) {
    this.serverFactory = options.serverFactory;
    this.healthService = options.healthService;
    this.port = options.port;
    this.host = options.host;
    this.apiKey = options.apiKey;
    this.rateLimiter = options.rateLimiter ?? new RateLimiter({ windowMs: 60000, maxRequests: 60 });
  }

  public async start(): Promise<void> {
    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();

    this.httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const startTime = performance.now();
      const forwarded = req.headers['x-forwarded-for'];
      const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const clientIp =
        (typeof rawForwarded === 'string' ? rawForwarded.split(',')[0].trim() : undefined) ||
        req.socket.remoteAddress ||
        'unknown';
      const parsedUrl = new URL(req.url || '/', 'http://localhost');
      const pathname = parsedUrl.pathname;

      // Security and Cross-Origin Resource Sharing (CORS) Headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD, DELETE');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-api-key, Accept, mcp-session-id, Last-Event-ID',
      );
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');

      // Preflight OPTIONS requests (required for web browsers & Smithery/Glama Observability)
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Localhost validation if binding to loopback
      if (this.host === '127.0.0.1' || this.host === 'localhost') {
        if (!validateHost(req, res) || !validateOrigin(req, res)) {
          return;
        }
      }

      // Rate Limiting Check
      try {
        this.rateLimiter.check(clientIp);
      } catch (err) {
        if (err instanceof RateLimitExceededError) {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(err.retryAfterSeconds),
          });
          res.end(JSON.stringify({ error: err.message, retryAfter: err.retryAfterSeconds }));
          return;
        }
      }

      // Authentication Check for remote endpoints
      if (this.apiKey) {
        const authHeader = req.headers['authorization'];
        const apiKeyHeader = req.headers['x-api-key'];
        const token =
          apiKeyHeader ||
          (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);

        if (token !== this.apiKey && pathname !== '/health' && pathname !== '/ready') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }));
          return;
        }
      }

      // 1. Health endpoint (Liveness)
      if (
        (pathname === '/health' || pathname === '/status') &&
        (req.method === 'GET' || req.method === 'HEAD')
      ) {
        try {
          const health = await this.healthService.getHealth();
          res.writeHead(health.status === 'healthy' ? 200 : 503, {
            'Content-Type': 'application/json',
          });
          if (req.method === 'HEAD') {
            res.end();
          } else {
            res.end(JSON.stringify(health, null, 2));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'unhealthy', error: msg }));
        }
        return;
      }

      // 2. Readiness endpoint
      if (pathname === '/ready' && (req.method === 'GET' || req.method === 'HEAD')) {
        try {
          const readiness = this.healthService.getReadiness();
          res.writeHead(readiness.status === 'ready' ? 200 : 503, {
            'Content-Type': 'application/json',
          });
          if (req.method === 'HEAD') {
            res.end();
          } else {
            res.end(JSON.stringify(readiness, null, 2));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'not_ready', error: msg }));
        }
        return;
      }

      // 3. Metrics endpoint (Observability)
      if (pathname === '/metrics' && (req.method === 'GET' || req.method === 'HEAD')) {
        const snapshot = globalMetrics.getSnapshot();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          res.end(JSON.stringify(snapshot, null, 2));
        }
        return;
      }

      // 4. MCP Streamable HTTP endpoint (/mcp or root)
      if (pathname.startsWith('/mcp') || pathname === '/') {
        try {
          const transport = await this.getOrCreateTransport(req);
          await transport.handleRequest(req, res);
          const duration = Math.round(performance.now() - startTime);
          logger.debug('Handled MCP Streamable HTTP request', {
            pathname,
            durationMs: duration,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Error handling MCP Streamable HTTP request', { error: msg });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error processing MCP request' }));
          }
        }
        return;
      }

      // 404 for other paths
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Not found: ${pathname}` }));
    });

    return new Promise((resolve) => {
      this.httpServer!.listen(this.port, this.host, () => {
        logger.info(
          `Contradiction MCP HTTP Server listening at http://${this.host}:${this.port}/mcp`,
          {
            port: this.port,
            host: this.host,
            authRequired: Boolean(this.apiKey),
          },
        );
        resolve();
      });
    });
  }

  /**
   * Returns the transport for an existing session (via mcp-session-id header),
   * or creates a fresh server+transport pair for a new initialize request.
   */
  private async getOrCreateTransport(
    req: IncomingMessage,
  ): Promise<NodeStreamableHTTPServerTransport> {
    const sessionIdHeader = req.headers['mcp-session-id'];
    const existingSessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    if (existingSessionId && this.sessions.has(existingSessionId)) {
      return this.sessions.get(existingSessionId)!;
    }

    // New session — create a dedicated server + transport pair
    const sessionServer = this.serverFactory();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, transport);
        logger.debug('MCP session initialized', { sessionId });
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        this.sessions.delete(sid);
        logger.debug('MCP session closed', { sessionId: sid });
      }
    };

    await sessionServer.connect(transport);
    return transport;
  }

  public getPort(): number {
    const address = this.httpServer?.address();
    if (address && typeof address === 'object') {
      return address.port;
    }
    return this.port;
  }

  public async stop(): Promise<void> {
    if (this.httpServer) {
      if (typeof this.httpServer.closeAllConnections === 'function') {
        this.httpServer.closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
    // Close all active sessions
    const closePromises = Array.from(this.sessions.values()).map((t) => t.close().catch(() => {}));
    await Promise.all(closePromises);
    this.sessions.clear();
    logger.info('Contradiction MCP HTTP Server stopped');
  }
}
