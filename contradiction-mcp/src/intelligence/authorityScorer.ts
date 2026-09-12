import { Claim } from '../domain/entities/claim.js';
import { Source } from '../domain/entities/source.js';

export interface AuthorityScoreBreakdown {
  roleScore: number;
  trustScore: number;
  locationScore: number;
  directnessScore: number;
}

export interface AuthorityScoreResult {
  score: number;
  breakdown: AuthorityScoreBreakdown;
  reasoning: string[];
}

export class AuthorityScorer {
  /**
   * Deterministically calculates an authority score between 0.0 and 1.0 for a claim
   * based on source role, source trust, document location/type, and directness of evidence.
   */
  public scoreAuthority(claim: Claim, source?: Source | null): AuthorityScoreResult {
    const reasoning: string[] = [];

    // 1. Source Role Score (weight: 0.40)
    let roleScore: number;
    const role = (claim.sourceRole || 'unknown').toLowerCase();
    switch (role) {
      case 'authoritative':
        roleScore = 1.0;
        reasoning.push('Explicit authoritative role designation (score: 1.00)');
        break;
      case 'deployment':
        roleScore = 0.95;
        reasoning.push(
          'Deployment specification role provides primary operational truth (score: 0.95)',
        );
        break;
      case 'configuration':
        roleScore = 0.9;
        reasoning.push('Configuration source role indicates runtime authority (score: 0.90)');
        break;
      case 'documentation':
        roleScore = 0.55;
        reasoning.push(
          'Documentation source role is secondary to operational configuration (score: 0.55)',
        );
        break;
      case 'generated':
        roleScore = 0.45;
        reasoning.push('Generated or synthetic artifact (score: 0.45)');
        break;
      case 'example':
        roleScore = 0.25;
        reasoning.push('Example or template code has low production authority (score: 0.25)');
        break;
      case 'historical':
        roleScore = 0.15;
        reasoning.push('Historical marker significantly degrades authority (score: 0.15)');
        break;
      default:
        roleScore = 0.5;
        reasoning.push('Default/unknown role score applied (score: 0.50)');
        break;
    }

    // 2. Source Trust Score (weight: 0.25)
    const trustScore = source?.trustScore ?? 1.0;
    reasoning.push(`Source '${source?.name || 'unknown'}' trust score: ${trustScore.toFixed(2)}`);

    // 3. Document Location / Type Heuristic (weight: 0.20)
    let locationScore: number;
    const metadata = claim.metadata || {};
    const filePath = typeof metadata.filePath === 'string' ? metadata.filePath.toLowerCase() : '';
    const uri = typeof metadata.uri === 'string' ? metadata.uri.toLowerCase() : '';

    if (filePath.endsWith('dockerfile') || filePath.includes('.github/workflows')) {
      locationScore = 0.95;
      reasoning.push(`Location '${filePath}' is a deployment/CI pipeline spec (score: 0.95)`);
    } else if (
      filePath.endsWith('package.json') ||
      filePath.endsWith('pom.xml') ||
      filePath.endsWith('cargo.toml')
    ) {
      locationScore = 0.9;
      reasoning.push(`Location '${filePath}' is a project manifest specification (score: 0.90)`);
    } else if (
      filePath.endsWith('.env') ||
      filePath.endsWith('.yaml') ||
      filePath.endsWith('.json')
    ) {
      locationScore = 0.85;
      reasoning.push(`Location '${filePath}' is structured configuration (score: 0.85)`);
    } else if (filePath.endsWith('.md') || filePath.endsWith('.txt') || uri.includes('/docs/')) {
      locationScore = 0.5;
      reasoning.push(`Location '${filePath || uri}' is documentation text (score: 0.50)`);
    } else {
      locationScore = 0.6;
      reasoning.push('Generic file location score (score: 0.60)');
    }

    // 4. Evidence Directness Score (weight: 0.15)
    let directnessScore = 0.5;
    if (
      metadata.line !== undefined ||
      (metadata.startLine !== undefined && metadata.endLine !== undefined)
    ) {
      directnessScore += 0.25;
      reasoning.push('Exact line provenance provides direct verifiable evidence');
    }
    if (typeof metadata.snippet === 'string' && metadata.snippet.trim().length > 0) {
      directnessScore += 0.25;
      reasoning.push('Verbatim snippet available');
    }
    directnessScore = Math.min(1.0, directnessScore);

    // Weighted composite authority score
    const score = Number(
      (roleScore * 0.4 + trustScore * 0.25 + locationScore * 0.2 + directnessScore * 0.15).toFixed(
        4,
      ),
    );

    return {
      score,
      breakdown: {
        roleScore,
        trustScore,
        locationScore,
        directnessScore,
      },
      reasoning,
    };
  }
}
