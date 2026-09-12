import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager } from '../src/storage/database.js';
import { ConnectorRegistry } from '../src/connectors/connectorRegistry.js';
import { DocumentConnector } from '../src/connectors/document/documentConnector.js';
import { SyncService } from '../src/connectors/syncService.js';
import { DiscoveryService } from '../src/discovery/discoveryService.js';

describe('Batch Synchronization & Concurrency Safety Tests', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;
  let registry: ConnectorRegistry;
  let syncService: SyncService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contra-batch-sync-'));
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();
    registry = new ConnectorRegistry();
    const docConnector = new DocumentConnector();
    registry.register(docConnector);
    const discoveryService = new DiscoveryService(dbManager);
    syncService = new SyncService(dbManager, registry, discoveryService);
  });

  afterEach(() => {
    dbManager.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('synchronizes multiple sources in batch with bounded concurrency', async () => {
    // Create 3 document files
    const file1 = path.join(tempDir, 'file1.json');
    const file2 = path.join(tempDir, 'file2.json');
    const file3 = path.join(tempDir, 'file3.json');

    fs.writeFileSync(file1, JSON.stringify({ version: '1.0' }));
    fs.writeFileSync(file2, JSON.stringify({ version: '2.0' }));
    fs.writeFileSync(file3, JSON.stringify({ version: '3.0' }));

    const batchRes = await syncService.syncSources(
      [
        { connector: 'document', input: { filePath: file1 } },
        { connector: 'document', input: { filePath: file2 } },
        { connector: 'document', input: { filePath: file3 } },
      ],
      { concurrency: 2 },
    );

    expect(batchRes.sourcesRequested).toBe(3);
    expect(batchRes.sourcesSucceeded).toBe(3);
    expect(batchRes.sourcesFailed).toBe(0);
    expect(batchRes.claimsCreated).toBe(3);
    expect(batchRes.results.length).toBe(3);
  });

  it('isolates failures so valid sources succeed even if one fails', async () => {
    const validFile = path.join(tempDir, 'valid.json');
    fs.writeFileSync(validFile, JSON.stringify({ port: 8080 }));

    const batchRes = await syncService.syncSources(
      [
        { connector: 'document', input: { filePath: validFile } },
        { connector: 'document', input: { filePath: path.join(tempDir, 'non-existent.json') } },
      ],
      { concurrency: 2 },
    );

    expect(batchRes.sourcesRequested).toBe(2);
    expect(batchRes.sourcesSucceeded).toBe(1);
    expect(batchRes.sourcesFailed).toBe(1);
    expect(batchRes.claimsCreated).toBe(1);
  });
});
