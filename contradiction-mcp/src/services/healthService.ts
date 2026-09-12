import { DatabaseManager, DatabaseHealth } from '../storage/database.js';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  server: {
    name: string;
    version: string;
    environment: string;
    uptimeSeconds: number;
  };
  mcp: {
    implementation: string;
    protocolVersion: string;
    status: 'ready';
  };
  database: DatabaseHealth;
  timestamp: string;
}

export interface HealthServiceConfig {
  SERVER_NAME: string;
  SERVER_VERSION: string;
  NODE_ENV: string;
  [key: string]: unknown;
}

export class HealthService {
  private readonly dbManager: DatabaseManager;
  private readonly config: HealthServiceConfig;
  private readonly startTime: number;

  constructor(dbManager: DatabaseManager, config: HealthServiceConfig) {
    this.dbManager = dbManager;
    this.config = config;
    this.startTime = Date.now();
  }

  public async getHealth(): Promise<HealthCheckResult> {
    const dbHealth = this.dbManager.checkHealth();
    const isHealthy = dbHealth.status === 'connected';

    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      server: {
        name: this.config.SERVER_NAME,
        version: this.config.SERVER_VERSION,
        environment: this.config.NODE_ENV,
        uptimeSeconds,
      },
      mcp: {
        implementation: '@modelcontextprotocol/server',
        protocolVersion: '2026-07-28',
        status: 'ready',
      },
      database: dbHealth,
      timestamp: new Date().toISOString(),
    };
  }

  public getLiveness(): { status: 'alive'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'alive',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  public getReadiness(): {
    status: 'ready' | 'not_ready';
    databaseConnected: boolean;
    tablesCount: number;
    latencyMs: number;
    timestamp: string;
  } {
    const dbHealth = this.dbManager.checkHealth();
    const isReady = dbHealth.status === 'connected';

    return {
      status: isReady ? 'ready' : 'not_ready',
      databaseConnected: isReady,
      tablesCount: dbHealth.tablesCount,
      latencyMs: dbHealth.latencyMs,
      timestamp: new Date().toISOString(),
    };
  }
}
