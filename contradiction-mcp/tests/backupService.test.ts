import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager } from '../src/storage/database.js';
import { BackupService } from '../src/storage/backupService.js';

describe('BackupService Tests', () => {
  let tempDir: string;
  let dbPath: string;
  let dbManager: DatabaseManager;
  let backupService: BackupService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contra-backup-test-'));
    dbPath = path.join(tempDir, 'live.db');
    dbManager = new DatabaseManager(dbPath);
    dbManager.initialize();
    backupService = new BackupService(dbManager);

    // Seed test records
    const source = dbManager.createSource({
      type: 'github',
      name: 'backup-test-repo',
    });
    dbManager.createClaim({
      sourceId: source.id,
      subject: 'Service',
      predicate: 'runtime',
      value: 'node22',
      valueType: 'version',
    });
  });

  afterEach(() => {
    dbManager.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates, verifies, and restores a valid database backup', async () => {
    // 1. Create backup
    const backupDir = path.join(tempDir, 'backups');
    const backupFile = await backupService.createBackup(backupDir);

    expect(fs.existsSync(backupFile)).toBe(true);
    expect(fs.statSync(backupFile).size).toBeGreaterThan(0);

    // 2. Verify backup
    const verification = backupService.verifyBackup(backupFile);
    expect(verification.valid).toBe(true);
    expect(verification.tablesCount).toBeGreaterThanOrEqual(3);
    expect(verification.integrity).toEqual(['ok']);

    // 3. Restore to a new location
    const restoredPath = path.join(tempDir, 'restored.db');
    backupService.restoreBackup(backupFile, restoredPath);

    expect(fs.existsSync(restoredPath)).toBe(true);

    // 4. Verify data in restored database
    const restoredDb = new DatabaseManager(restoredPath);
    restoredDb.initialize();

    const claims = restoredDb.listClaims();
    expect(claims.length).toBe(1);
    expect(claims[0].predicate).toBe('runtime');
    expect(claims[0].value).toBe('node22');

    restoredDb.close();
  });

  it('detects corrupted or invalid backup files', () => {
    const corruptFile = path.join(tempDir, 'corrupt.db');
    fs.writeFileSync(corruptFile, 'THIS IS NOT A VALID SQLITE DATABASE FILE HEADER');

    const result = backupService.verifyBackup(corruptFile);
    expect(result.valid).toBe(false);
  });
});
