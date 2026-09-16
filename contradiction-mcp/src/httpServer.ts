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
  server: McpServer;
  healthService: HealthService;
  port: number;
  host: string;
  apiKey?: string;
  rateLimiter?: RateLimiter;
}

export class McpHttpServer {
  private httpServer: http.Server | null = null;
  private readonly server: McpServer;
  private readonly healthService: HealthService;
  private readonly port: number;
  private readonly host: string;
  private readonly apiKey?: string;
  private readonly rateLimiter: RateLimiter;
  private transport: NodeStreamableHTTPServerTransport | null = null;

  constructor(options: HttpServerOptions) {
    this.server = options.server;
    this.healthService = options.healthService;
    this.port = options.port;
    this.host = options.host;
    this.apiKey = options.apiKey;
    this.rateLimiter = options.rateLimiter ?? new RateLimiter({ windowMs: 60000, maxRequests: 60 });
  }

  public async start(): Promise<void> {
    this.transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless Streamable HTTP
    });

    await this.server.connect(this.transport);

    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();

    this.httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const startTime = performance.now();
      const clientIp = req.socket.remoteAddress || 'unknown';
      const url = req.url || '/';

      // Security and Cross-Origin Resource Sharing (CORS) Headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
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

        if (token !== this.apiKey && url !== '/health' && url !== '/ready') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }));
          return;
        }
      }

      // 1. Health endpoint (Liveness)
      if (
        (url === '/health' || url === '/status') &&
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
      if (url === '/ready' && (req.method === 'GET' || req.method === 'HEAD')) {
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
      if (url === '/metrics' && (req.method === 'GET' || req.method === 'HEAD')) {
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
      if (url.startsWith('/mcp') || url === '/') {
        try {
          await this.transport!.handleRequest(req, res);
          const duration = Math.round(performance.now() - startTime);
          logger.debug('Handled MCP Streamable HTTP request', { url, durationMs: duration });
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
      res.end(JSON.stringify({ error: `Not found: ${url}` }));
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
    if (this.transport) {
      await this.transport.close();
    }
    logger.info('Contradiction MCP HTTP Server stopped');
  }
}
