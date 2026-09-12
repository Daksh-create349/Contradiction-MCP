import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { DatabaseManager } from './storage/database.js';
import { HealthService } from './services/healthService.js';
import { AnalysisService } from './services/analysisService.js';
import { DiscoveryService } from './discovery/discoveryService.js';
import { ConnectorRegistry } from './connectors/connectorRegistry.js';
import { GitHubClient } from './connectors/github/githubClient.js';
import { GitHubConnector } from './connectors/github/githubConnector.js';
import { DocumentConnector } from './connectors/document/documentConnector.js';
import { WebsiteConnector } from './connectors/website/websiteConnector.js';
import { SyncService } from './connectors/syncService.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  logger.info('Starting Contradiction MCP server...', {
    env: config.NODE_ENV,
    server: config.SERVER_NAME,
    version: config.SERVER_VERSION,
  });

  const dbManager = new DatabaseManager(config.DATABASE_PATH);

  try {
    dbManager.initialize();
  } catch (error) {
    logger.error('Failed to start server due to database initialization failure', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const healthService = new HealthService(dbManager, config);
  const analysisService = new AnalysisService(dbManager);
  const discoveryService = new DiscoveryService(dbManager);

  // Initialize connector registry and register connectors
  const connectorRegistry = new ConnectorRegistry();
  const githubClient = new GitHubClient({ token: config.GITHUB_TOKEN });
  const githubConnector = new GitHubConnector(githubClient);
  connectorRegistry.register(githubConnector);

  const documentConnector = new DocumentConnector();
  connectorRegistry.register(documentConnector);

  const websiteConnector = new WebsiteConnector();
  connectorRegistry.register(websiteConnector);

  const syncService = new SyncService(dbManager, connectorRegistry, discoveryService);

  const server = createMcpServer({
    healthService,
    analysisService,
    discoveryService,
    dbManager,
    connectorRegistry,
    syncService,
    name: config.SERVER_NAME,
    version: config.SERVER_VERSION,
  });

  let httpServer: import('./httpServer.js').McpHttpServer | null = null;

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    try {
      if (httpServer) {
        await httpServer.stop();
      }
      await server.close();
      dbManager.close();
      logger.info('Contradiction MCP server stopped cleanly');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown', { error: String(err) });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (config.MCP_TRANSPORT === 'http') {
    const { McpHttpServer } = await import('./httpServer.js');
    httpServer = new McpHttpServer({
      server,
      healthService,
      port: config.HTTP_PORT,
      host: config.HTTP_HOST,
      apiKey: config.API_KEY,
    });
    await httpServer.start();
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Contradiction MCP server running and listening via stdio transport');
  }
}

main().catch((error) => {
  logger.error('Fatal error in server process', { error: String(error) });
  process.exit(1);
});
