import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectorRegistry } from '../src/connectors/connectorRegistry.js';
import {
  Connector,
  ConnectorMetadata,
  ConnectionTestResult,
} from '../src/connectors/types/connector.js';
import { FetchResult, ExtractedClaim } from '../src/connectors/types/fetchResult.js';
import { ConfigurationError, NotFoundError } from '../src/domain/types/common.js';

class MockTestConnector implements Connector<unknown, unknown> {
  public readonly type: string;
  public readonly metadata: ConnectorMetadata;

  constructor(type = 'test-source') {
    this.type = type;
    this.metadata = {
      type,
      displayName: `Test ${type}`,
      description: 'Mock connector for testing registry',
      authRequirement: 'none',
      enabled: true,
      capabilities: {
        supportsIncrementalSync: true,
        supportsFileInspection: true,
        supportedFileTypes: ['.json', '.md'],
      },
    };
  }

  public async testConnection(): Promise<ConnectionTestResult> {
    return { accessible: true, authenticated: false, targetFound: true };
  }

  public async fetch(): Promise<FetchResult<unknown>> {
    return {
      sourceIdentifier: 'test:1',
      sourceName: 'test-source-1',
      sourceUri: 'https://example.com',
      fetchedAt: new Date(),
      rawData: {},
      metadata: {},
    };
  }

  public async extractClaims(): Promise<ExtractedClaim[]> {
    return [];
  }
}

describe('ConnectorRegistry', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry();
  });

  it('registers and retrieves a connector by source type', () => {
    const connector = new MockTestConnector('github');
    registry.register(connector);

    expect(registry.has('github')).toBe(true);
    expect(registry.has('GITHUB')).toBe(true); // Case-insensitive
    expect(registry.get('github')).toBe(connector);
    expect(registry.get('GITHUB')).toBe(connector);
  });

  it('rejects duplicate registrations with ConfigurationError', () => {
    const c1 = new MockTestConnector('github');
    const c2 = new MockTestConnector('github');

    registry.register(c1);
    expect(() => registry.register(c2)).toThrow(ConfigurationError);
    expect(() => registry.register(c2)).toThrow(
      "Connector for source type 'github' is already registered",
    );
  });

  it('returns undefined when querying an unregistered connector via get()', () => {
    expect(registry.get('slack')).toBeUndefined();
    expect(registry.has('slack')).toBe(false);
  });

  it('throws NotFoundError when querying an unregistered connector via getOrThrow()', () => {
    expect(() => registry.getOrThrow('slack')).toThrow(NotFoundError);
  });

  it('lists metadata for all registered connectors', () => {
    registry.register(new MockTestConnector('github'));
    registry.register(new MockTestConnector('document'));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.type)).toContain('github');
    expect(list.map((m) => m.type)).toContain('document');
  });

  it('clears all connectors successfully', () => {
    registry.register(new MockTestConnector('github'));
    expect(registry.list()).toHaveLength(1);

    registry.clear();
    expect(registry.list()).toHaveLength(0);
    expect(registry.has('github')).toBe(false);
  });
});
