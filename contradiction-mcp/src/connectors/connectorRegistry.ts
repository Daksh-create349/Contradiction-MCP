import type { SourceType } from '../domain/entities/source.js';
import type { Connector, ConnectorMetadata } from './types/connector.js';
import { ConfigurationError, NotFoundError } from '../domain/types/common.js';
import { logger } from '../utils/logger.js';

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  /**
   * Registers a connector implementation into the registry.
   * Throws ConfigurationError if a connector for this source type is already registered.
   */
  public register(connector: Connector): void {
    const key = connector.type.toLowerCase();
    if (this.connectors.has(key)) {
      throw new ConfigurationError(
        `Connector for source type '${connector.type}' is already registered`,
      );
    }

    this.connectors.set(key, connector);
    logger.info('Registered connector', {
      type: connector.type,
      name: connector.metadata.displayName,
    });
  }

  /**
   * Retrieves a connector by source type, or returns undefined if not found.
   */
  public get(type: SourceType): Connector | undefined {
    return this.connectors.get(type.toLowerCase());
  }

  /**
   * Retrieves a connector by source type, or throws NotFoundError if not found.
   */
  public getOrThrow(type: SourceType): Connector {
    const connector = this.get(type);
    if (!connector) {
      throw new NotFoundError('Connector', type);
    }
    return connector;
  }

  /**
   * Checks whether a connector is registered for the specified source type.
   */
  public has(type: SourceType): boolean {
    return this.connectors.has(type.toLowerCase());
  }

  /**
   * Lists metadata for all registered connectors.
   */
  public list(): ConnectorMetadata[] {
    return Array.from(this.connectors.values()).map((c) => c.metadata);
  }

  /**
   * Enables or disables a registered connector.
   */
  public setEnabled(type: SourceType, enabled: boolean): void {
    const connector = this.getOrThrow(type);
    connector.metadata.enabled = enabled;
    logger.info(`Connector '${type}' ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Evaluates the operational health of registered connectors.
   */
  public async checkHealth(type?: SourceType): Promise<
    Record<
      string,
      {
        status: 'healthy' | 'unhealthy';
        accessible: boolean;
        error?: string;
        metadata: ConnectorMetadata;
      }
    >
  > {
    const results: Record<
      string,
      {
        status: 'healthy' | 'unhealthy';
        accessible: boolean;
        error?: string;
        metadata: ConnectorMetadata;
      }
    > = {};

    const targets = type ? [this.getOrThrow(type)] : Array.from(this.connectors.values());

    for (const connector of targets) {
      try {
        const testRes = await connector.testConnection();
        results[connector.type] = {
          status: testRes.accessible ? 'healthy' : 'unhealthy',
          accessible: testRes.accessible,
          error: testRes.error,
          metadata: connector.metadata,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[connector.type] = {
          status: 'unhealthy',
          accessible: false,
          error: msg,
          metadata: connector.metadata,
        };
      }
    }

    return results;
  }

  /**
   * Clears all registered connectors (useful in unit testing).
   */
  public clear(): void {
    this.connectors.clear();
  }
}
