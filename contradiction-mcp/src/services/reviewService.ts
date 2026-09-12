import { DatabaseManager } from '../storage/database.js';
import { Contradiction, ContradictionHistoryEntry } from '../domain/entities/contradiction.js';
import { NotFoundError, ValidationError } from '../domain/types/common.js';
import { logger } from '../utils/logger.js';

export interface ResolveContradictionOptions {
  resolvedBy: string;
  reason: string;
  chosenClaimId?: string | null;
  resolutionSource?: string;
  notes?: string;
}

export interface ReviewContradictionOptions {
  reviewedBy: string;
  notes?: string;
}

export interface DismissContradictionOptions {
  dismissedBy: string;
  reason: string;
  notes?: string;
}

export interface ReopenContradictionOptions {
  reopenedBy: string;
  reason?: string;
  notes?: string;
}

export class ReviewService {
  constructor(private readonly dbManager: DatabaseManager) {}

  public reviewContradiction(
    contradictionId: string,
    options: ReviewContradictionOptions,
  ): Contradiction {
    const existing = this.dbManager.getContradictionById(contradictionId);
    if (!existing) {
      throw new NotFoundError('Contradiction', contradictionId);
    }

    logger.info('Marking contradiction as reviewed', {
      contradictionId,
      reviewedBy: options.reviewedBy,
    });

    return this.dbManager.updateContradictionStatus(contradictionId, 'REVIEWED', {
      resolvedBy: options.reviewedBy,
      auditNotes: options.notes,
    });
  }

  public resolveContradiction(
    contradictionId: string,
    options: ResolveContradictionOptions,
  ): Contradiction {
    const existing = this.dbManager.getContradictionById(contradictionId);
    if (!existing) {
      throw new NotFoundError('Contradiction', contradictionId);
    }

    if (!options.reason || options.reason.trim().length === 0) {
      throw new ValidationError('A resolution reason is required to resolve a contradiction');
    }

    if (options.chosenClaimId) {
      if (
        options.chosenClaimId !== existing.claimAId &&
        options.chosenClaimId !== existing.claimBId
      ) {
        throw new ValidationError(
          `chosenClaimId '${options.chosenClaimId}' must match either claimA (${existing.claimAId}) or claimB (${existing.claimBId})`,
        );
      }
    }

    logger.info('Resolving contradiction', {
      contradictionId,
      resolvedBy: options.resolvedBy,
      chosenClaimId: options.chosenClaimId,
    });

    return this.dbManager.updateContradictionStatus(contradictionId, 'RESOLVED', {
      reason: options.reason,
      resolvedBy: options.resolvedBy,
      resolutionSource: options.resolutionSource || 'manual_review',
      chosenClaimId: options.chosenClaimId,
      auditNotes: options.notes,
      resolvedAt: new Date(),
    });
  }

  public dismissContradiction(
    contradictionId: string,
    options: DismissContradictionOptions,
  ): Contradiction {
    const existing = this.dbManager.getContradictionById(contradictionId);
    if (!existing) {
      throw new NotFoundError('Contradiction', contradictionId);
    }

    if (!options.reason || options.reason.trim().length === 0) {
      throw new ValidationError('A dismissal reason is required to dismiss a contradiction');
    }

    logger.info('Dismissing contradiction', {
      contradictionId,
      dismissedBy: options.dismissedBy,
      reason: options.reason,
    });

    return this.dbManager.updateContradictionStatus(contradictionId, 'DISMISSED', {
      reason: options.reason,
      resolvedBy: options.dismissedBy,
      auditNotes: options.notes,
    });
  }

  public reopenContradiction(
    contradictionId: string,
    options: ReopenContradictionOptions,
  ): Contradiction {
    const existing = this.dbManager.getContradictionById(contradictionId);
    if (!existing) {
      throw new NotFoundError('Contradiction', contradictionId);
    }

    logger.info('Reopening contradiction', {
      contradictionId,
      reopenedBy: options.reopenedBy,
    });

    return this.dbManager.updateContradictionStatus(contradictionId, 'OPEN', {
      reason: options.reason || 'Reopened for investigation',
      resolvedBy: options.reopenedBy,
      auditNotes: options.notes,
      resolvedAt: null,
      chosenClaimId: null,
    });
  }

  public getContradictionHistory(contradictionId: string): ContradictionHistoryEntry[] {
    const existing = this.dbManager.getContradictionById(contradictionId);
    if (!existing) {
      throw new NotFoundError('Contradiction', contradictionId);
    }

    return this.dbManager.getContradictionHistory(contradictionId);
  }
}
