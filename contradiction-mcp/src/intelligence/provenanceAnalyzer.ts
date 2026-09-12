import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';

export interface ProvenanceTrace {
  sourceId: string;
  sourceType: string;
  sourceName: string;
  sourceUri?: string | null;
  filePath?: string | null;
  commitHash?: string | null;
  observedAt: Date;
  isTraceable: boolean;
  summary: string;
}

export class ProvenanceAnalyzer {
  /**
   * Traces and validates the chain of custody for a given claim.
   */
  public analyzeProvenance(claim: Claim, source?: Source | null): ProvenanceTrace {
    const metadata = claim.metadata || {};
    const filePath = typeof metadata.filePath === 'string' ? metadata.filePath : null;
    const commitHash =
      typeof metadata.commitSha === 'string'
        ? metadata.commitSha
        : typeof metadata.commit === 'string'
          ? metadata.commit
          : null;

    const sourceUri = source?.uri || (typeof metadata.uri === 'string' ? metadata.uri : null);
    const isTraceable = Boolean(source && (sourceUri || filePath));

    const locationDesc = filePath ? ` at ${filePath}` : sourceUri ? ` at ${sourceUri}` : '';
    const commitDesc = commitHash ? ` (rev ${commitHash.substring(0, 7)})` : '';

    const summary = source
      ? `Extracted from ${source.type} source '${source.name}'${locationDesc}${commitDesc}, observed ${claim.observedAt.toISOString()}`
      : `Unlinked claim observed ${claim.observedAt.toISOString()}`;

    return {
      sourceId: claim.sourceId,
      sourceType: source?.type || 'unknown',
      sourceName: source?.name || 'unknown',
      sourceUri,
      filePath,
      commitHash,
      observedAt: claim.observedAt,
      isTraceable,
      summary,
    };
  }
}
