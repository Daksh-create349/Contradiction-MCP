import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DocumentConnector } from '../../src/connectors/document/documentConnector.js';
import { DatabaseManager } from '../../src/storage/database.js';
import { HealthService } from '../../src/services/healthService.js';
import { loadConfig } from '../../src/config/env.js';
import { createMcpServer } from '../../src/server.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

describe('Production Security Audits', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;
  let healthService: HealthService;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'contra-sec-test-')));
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();

    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      SERVER_NAME: 'Contradiction MCP Security Test',
      SERVER_VERSION: '0.1.0',
    });
    healthService = new HealthService(dbManager, config);
  });

  afterEach(() => {
    dbManager.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Document Root Containment & Path Traversal', () => {
    it('rejects parent directory traversal attacks (../)', async () => {
      const sandbox = path.join(tempDir, 'sandbox');
      fs.mkdirSync(sandbox);
      const secretFile = path.join(tempDir, 'secret.env');
      fs.writeFileSync(secretFile, 'API_KEY=supersecret123');

      const connector = new DocumentConnector({ allowedRoots: [sandbox] });

      const maliciousPath = path.join(sandbox, '..', 'secret.env');
      await expect(connector.fetch({ filePath: maliciousPath })).rejects.toThrow(
        /outside allowed document directories/,
      );
    });

    it('rejects symlink escapes pointing outside allowed document root', async () => {
      const sandbox = path.join(tempDir, 'sandbox');
      fs.mkdirSync(sandbox);
      const targetOutside = path.join(tempDir, 'outside_data.json');
      fs.writeFileSync(targetOutside, JSON.stringify({ key: 'val' }));

      const symlinkPath = path.join(sandbox, 'escaped_symlink.json');
      try {
        fs.symlinkSync(targetOutside, symlinkPath);
      } catch {
        // Skip if OS permissions restrict symlink creation
        return;
      }

      const connector = new DocumentConnector({ allowedRoots: [sandbox] });
      await expect(connector.fetch({ filePath: symlinkPath })).rejects.toThrow(
        /outside allowed document directories/,
      );
    });

    it('rejects files exceeding configured maxFileSizeBytes limit', async () => {
      const largeFile = path.join(tempDir, 'large.txt');
      const largeContent = 'a'.repeat(2048);
      fs.writeFileSync(largeFile, largeContent);

      const connector = new DocumentConnector({ maxFileSizeBytes: 1024 });
      await expect(connector.fetch({ filePath: largeFile })).rejects.toThrow(
        /exceeds maximum allowed limit/,
      );
    });
  });

  describe('Scope-Based Authorization Guard', () => {
    it('blocks mutating actions when client has only read scope', async () => {
      const readOnlyServer = createMcpServer({
        healthService,
        dbManager,
        clientScopes: ['read'],
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'read-client', version: '1.0.0' });

      await Promise.all([readOnlyServer.connect(serverTransport), client.connect(clientTransport)]);

      // Read tools should work
      const listRes = (await client.callTool({
        name: 'list_contradictions',
        arguments: {},
      })) as any;
      expect(listRes.isError).toBeFalsy();

      // Mutating tools should fail with authorization error
      const resolveRes = (await client.callTool({
        name: 'resolve_contradiction',
        arguments: {
          contradictionId: 'test-id',
          resolvedBy: 'test-user',
          reason: 'chosen_claim',
        },
      })) as any;

      expect(resolveRes.isError).toBe(true);
      const parsed = JSON.parse(resolveRes.content[0].text);
      expect(parsed.code).toBe('AUTHORIZATION_ERROR');
      expect(parsed.error).toContain("requires 'resolve' or 'admin' scope");

      await client.close();
      await readOnlyServer.close();
    });

    it('allows mutating actions when client has admin scope', async () => {
      const adminServer = createMcpServer({
        healthService,
        dbManager,
        clientScopes: ['admin'],
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'admin-client', version: '1.0.0' });

      await Promise.all([adminServer.connect(serverTransport), client.connect(clientTransport)]);

      // Admin calling resolve on non-existent contradiction gets NotFoundError, NOT AuthorizationError
      const resolveRes = (await client.callTool({
        name: 'resolve_contradiction',
        arguments: {
          contradictionId: 'missing-uuid',
          resolvedBy: 'admin-user',
          reason: 'chosen_claim',
        },
      })) as any;

      expect(resolveRes.isError).toBe(true);
      const parsed = JSON.parse(resolveRes.content[0].text);
      expect(parsed.code).toBe('NOT_FOUND');

      await client.close();
      await adminServer.close();
    });
  });

  describe('SQL Injection Defenses', () => {
    it('handles malicious SQL injection strings in contradiction filters safely', () => {
      const injectionPayloads = [
        "' OR '1'='1",
        "'; DROP TABLE contradictions; --",
        'UNION SELECT * FROM sqlite_master --',
        "1' AND 1=0 UNION ALL SELECT 1,2,3,4,5,6,7,8,9,10,11,12 --",
      ];

      for (const payload of injectionPayloads) {
        // Querying with injection payload in type filter
        const results = dbManager.listContradictions({ type: payload });
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(0);

        // Verify table was not dropped or altered
        const raw = dbManager
          .getRawDb()
          .prepare('SELECT count(*) as count FROM contradictions')
          .get() as any;
        expect(typeof raw.count).toBe('number');
      }
    });

    it('handles malicious SQL injection strings in claim queries safely', () => {
      const payload = "'; DELETE FROM claims; --";
      const results = dbManager.listClaims({ subject: payload });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);

      const raw = dbManager.getRawDb().prepare('SELECT count(*) as count FROM claims').get() as any;
      expect(typeof raw.count).toBe('number');
    });
  });
});
