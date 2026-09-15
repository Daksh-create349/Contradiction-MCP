import { Claim } from '../domain/entities/claim.js';

export interface EvidenceQualityResult {
  quality: 'STRONG' | 'MODERATE' | 'WEAK' | 'INDIRECT';
  score: number;
  hasLineProvenance: boolean;
  hasVerbatimSnippet: boolean;
  extractionMethod: string;
  reasons: string[];
}

export class EvidenceEvaluator {
  /**
   * Assesses the empirical solidity and verifiable directness of a claim's evidence.
   */
  public evaluateEvidence(claim: Claim): EvidenceQualityResult {
    const reasons: string[] = [];
    let score = 0.4;

    const metadata = claim.metadata || {};
    const snippet =
      typeof metadata.snippet === 'string'
        ? metadata.snippet.trim()
        : typeof metadata.evidence === 'string'
          ? metadata.evidence.trim()
          : '';
    const hasSnippet = snippet.length > 0;
    const lineRange = Array.isArray(metadata.lineRange) ? (metadata.lineRange as unknown[]) : null;
    const hasLineRange = lineRange !== null && lineRange.length > 0;
    const hasLine =
      metadata.line !== undefined ||
      (metadata.startLine !== undefined && metadata.endLine !== undefined) ||
      hasLineRange;

    const extractionMethod =
      typeof metadata.extractionMethod === 'string' ? metadata.extractionMethod : 'heuristic';

    if (hasLine) {
      score += 0.25;
      const lineStr =
        metadata.line !== undefined
          ? `line ${metadata.line}`
          : lineRange
            ? lineRange[0] === lineRange[1]
              ? `line ${String(lineRange[0])}`
              : `lines ${String(lineRange[0])}-${String(lineRange[1])}`
            : `lines ${metadata.startLine}-${metadata.endLine}`;
      reasons.push(`Claim verified with exact line provenance: ${lineStr}`);
    } else {
      reasons.push('Claim lacks exact line number citation');
    }

    if (hasSnippet) {
      score += 0.25;
      reasons.push(`Claim includes verbatim source snippet (${snippet.length} chars)`);
    } else {
      reasons.push('No textual evidence snippet captured');
    }

    if (extractionMethod === 'json_parse' || extractionMethod === 'ast') {
      score += 0.1;
      reasons.push(`Structured deterministic extraction method: ${extractionMethod}`);
    } else if (extractionMethod === 'regex' || extractionMethod === 'yaml_parse') {
      score += 0.05;
      reasons.push(`Pattern-based extraction method: ${extractionMethod}`);
    }

    score = Math.min(1.0, score);

    let quality: 'STRONG' | 'MODERATE' | 'WEAK' | 'INDIRECT';
    if (score >= 0.8) {
      quality = 'STRONG';
    } else if (score >= 0.6) {
      quality = 'MODERATE';
    } else if (score >= 0.4) {
      quality = 'WEAK';
    } else {
      quality = 'INDIRECT';
    }

    return {
      quality,
      score: Number(score.toFixed(2)),
      hasLineProvenance: hasLine,
      hasVerbatimSnippet: hasSnippet,
      extractionMethod,
      reasons,
    };
  }
}
