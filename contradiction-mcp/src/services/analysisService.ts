import { DatabaseManager } from '../storage/database.js';
import {
  ContradictionEngine,
  contradictionEngine,
  ContradictionAnalysis,
  ContradictionAnalysisStatus,
} from '../analysis/contradictionEngine.js';
import { ClaimRelationship } from '../analysis/claimRelationship.js';
import { NotFoundError } from '../domain/types/common.js';
import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';

export interface ClaimPairAnalysisResult {
  isContradiction: boolean;
  analysisStatus: ContradictionAnalysisStatus;
  relationship: ClaimRelationship;
  contradictionType: string;
  severity: string;
  confidence: number;
  explanation: string;
  claims: {
    claimA: Claim;
    claimB: Claim;
  };
  sources: {
    sourceA: Source | null;
    sourceB: Source | null;
  };
  evidence: ContradictionAnalysis['evidence'];
}

export interface ExplainClaimRelationshipResult {
  claimA: Claim;
  claimB: Claim;
  relationship: ClaimRelationship;
  analysisStatus: ContradictionAnalysisStatus;
  explanation: string;
  isContradiction: boolean;
  contextFactors: ClaimRelationship['contextFactors'];
  divergenceDimensions: string[];
}

export class AnalysisService {
  private readonly dbManager: DatabaseManager;
  private readonly engine: ContradictionEngine;

  constructor(dbManager: DatabaseManager, engine: ContradictionEngine = contradictionEngine) {
    this.dbManager = dbManager;
    this.engine = engine;
  }

  public analyzeClaimPair(claimAId: string, claimBId: string): ClaimPairAnalysisResult {
    const claimA = this.dbManager.getClaimById(claimAId);
    if (!claimA) {
      throw new NotFoundError('Claim', claimAId);
    }

    const claimB = this.dbManager.getClaimById(claimBId);
    if (!claimB) {
      throw new NotFoundError('Claim', claimBId);
    }

    const sourceA = this.dbManager.getSourceById(claimA.sourceId);
    const sourceB = this.dbManager.getSourceById(claimB.sourceId);

    const analysis = this.engine.analyzePair(claimA, claimB, sourceA, sourceB);

    return {
      isContradiction: analysis.isContradiction,
      analysisStatus: analysis.analysisStatus,
      relationship: analysis.relationship,
      contradictionType: analysis.contradictionType,
      severity: analysis.severity,
      confidence: analysis.confidence,
      explanation: analysis.explanation,
      claims: {
        claimA,
        claimB,
      },
      sources: {
        sourceA,
        sourceB,
      },
      evidence: analysis.evidence,
    };
  }

  public explainClaimRelationship(
    claimAId: string,
    claimBId: string,
  ): ExplainClaimRelationshipResult {
    const claimA = this.dbManager.getClaimById(claimAId);
    if (!claimA) {
      throw new NotFoundError('Claim', claimAId);
    }

    const claimB = this.dbManager.getClaimById(claimBId);
    if (!claimB) {
      throw new NotFoundError('Claim', claimBId);
    }

    const sourceA = this.dbManager.getSourceById(claimA.sourceId);
    const sourceB = this.dbManager.getSourceById(claimB.sourceId);

    const analysis = this.engine.analyzePair(claimA, claimB, sourceA, sourceB);

    return {
      claimA,
      claimB,
      relationship: analysis.relationship,
      analysisStatus: analysis.analysisStatus,
      explanation: analysis.relationship.explanation,
      isContradiction: analysis.isContradiction,
      contextFactors: analysis.relationship.contextFactors,
      divergenceDimensions: analysis.evidence.context?.divergenceDimensions ?? [],
    };
  }
}
