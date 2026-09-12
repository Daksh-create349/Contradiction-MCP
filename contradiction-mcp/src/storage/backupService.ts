import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DatabaseManager } from './database.js';
import { DatabaseError } from '../domain/types/common.js';
import { logger } from '../utils/logger.js';

export interface BackupVerificationResult {
  valid: boolean;
  tablesCount: number;
  integrity: string[];
  error?: string;
}

export class BackupService {
  constructor(private readonly dbManager: DatabaseManager) {}

  public async createBackup(targetDirectory: string): Promise<string> {
    if (!fs.existsSync(targetDirectory)) {
      fs.mkdirSync(targetDirectory, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `contradiction-backup-${timestamp}.db`;
    const targetPath = path.resolve(targetDirectory, backupFileName);

    logger.info('Initiating database backup', { targetPath });
    try {
      await this.dbManager.backup(targetPath);
      logger.info('Database backup completed successfully', { targetPath });
      return targetPath;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create database backup', { targetPath, error: msg });
      throw new DatabaseError(`Backup failed: ${msg}`, error);
    }
  }

  public verifyBackup(backupPath: string): BackupVerificationResult {
    if (!fs.existsSync(backupPath)) {
      return {
        valid: false,
        tablesCount: 0,
        integrity: [],
        error: `Backup file does not exist: ${backupPath}`,
      };
    }

    let tempDb: Database.Database | null = null;
    try {
      tempDb = new Database(backupPath, { readonly: true });
      const integrityRows = tempDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      const integrity = integrityRows.map((r) => r.integrity_check);
      const isIntegrityOk = integrity.length === 1 && integrity[0] === 'ok';

      const tablesRow = tempDb
        .prepare(
          "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .get() as { count: number };

      return {
        valid: isIntegrityOk,
        tablesCount: tablesRow.count,
        integrity,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        tablesCount: 0,
        integrity: [],
        error: msg,
      };
    } finally {
      if (tempDb && tempDb.open) {
        tempDb.close();
      }
    }
  }

  public restoreBackup(backupPath: string, destinationDbPath: string): void {
    const verification = this.verifyBackup(backupPath);
    if (!verification.valid) {
      throw new DatabaseError(
        `Cannot restore invalid backup at ${backupPath}: ${verification.error || 'Integrity check failed'}`,
      );
    }

    logger.warn('Restoring database from verified backup', { backupPath, destinationDbPath });
    try {
      // Create destination folder if needed
      const destDir = path.dirname(destinationDbPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.copyFileSync(backupPath, destinationDbPath);
      logger.info('Database restored successfully', { backupPath, destinationDbPath });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Failed to restore database from ${backupPath}: ${msg}`, error);
    }
  }
}
