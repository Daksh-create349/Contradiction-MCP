export interface EntityMatchResult {
  isMatch: boolean;
  confidence: number;
  matchType: 'EXACT' | 'NORMALIZED' | 'ALIAS' | 'SUFFIX_PREFIX' | 'URL_HOST' | 'NONE';
  reason: string;
  isAmbiguous: boolean;
}

export interface CandidateMatch {
  candidate: string;
  confidence: number;
  matchType: string;
}

export interface EntityResolverOptions {
  customAliases?: Record<string, string[]>;
  minConfidenceThreshold?: number;
}

export class EntityResolver {
  private readonly defaultAliases: Map<string, Set<string>> = new Map();

  constructor() {
    this.registerDefaultAliases();
  }

  private registerDefaultAliases(): void {
    const aliasGroups = [
      ['api', 'api-server', 'backend', 'api_service', 'core-api'],
      ['frontend', 'web', 'ui', 'client', 'web-app', 'webapp'],
      ['gateway', 'api-gateway', 'platform-gateway-service', 'ingress'],
      ['auth', 'authentication', 'auth-service', 'idp', 'identity'],
      ['db', 'database', 'postgres', 'postgresql', 'mysql', 'sqlite'],
    ];

    for (const group of aliasGroups) {
      const set = new Set(group.map((s) => this.normalize(s)));
      for (const item of group) {
        this.defaultAliases.set(this.normalize(item), set);
      }
    }
  }

  /**
   * Canonicalizes an entity name by stripping delimiters, common redundant words, and casing.
   */
  public normalize(raw: string): string {
    if (!raw) return '';
    return raw
      .trim()
      .toLowerCase()
      .replace(/^(@[a-z0-9_-]+\/)/i, '') // strip npm scopes
      .replace(/^(https?:\/\/)?(www\.)?/i, '') // strip web protocols
      .replace(/[._\-\s/]+/g, '') // remove separators
      .replace(/(service|server|daemon|app|application|client|pkg|package)$/i, ''); // strip redundant noun suffixes
  }

  /**
   * Compares two entity references across sources.
   */
  public resolveEntityMatch(
    entityA: string,
    entityB: string,
    options?: EntityResolverOptions,
  ): EntityMatchResult {
    const rawA = (entityA || '').trim();
    const rawB = (entityB || '').trim();

    if (!rawA || !rawB) {
      return {
        isMatch: false,
        confidence: 0.0,
        matchType: 'NONE',
        reason: 'Empty entity string provided',
        isAmbiguous: false,
      };
    }

    // 1. Exact string match
    if (rawA === rawB) {
      return {
        isMatch: true,
        confidence: 1.0,
        matchType: 'EXACT',
        reason: 'Exact verbatim entity name match',
        isAmbiguous: false,
      };
    }

    // 2. Exact case-insensitive match
    if (rawA.toLowerCase() === rawB.toLowerCase()) {
      return {
        isMatch: true,
        confidence: 0.98,
        matchType: 'EXACT',
        reason: 'Exact case-insensitive match',
        isAmbiguous: false,
      };
    }

    // 3. Normalized representation match
    const normA = this.normalize(rawA);
    const normB = this.normalize(rawB);

    if (normA && normB && normA === normB) {
      return {
        isMatch: true,
        confidence: 0.92,
        matchType: 'NORMALIZED',
        reason: `Normalized representations match ('${normA}')`,
        isAmbiguous: false,
      };
    }

    // 4. Custom & Built-in Aliases check
    if (options?.customAliases) {
      for (const [key, aliases] of Object.entries(options.customAliases)) {
        const normKey = this.normalize(key);
        const normAliases = aliases.map((a) => this.normalize(a));
        const all = [normKey, ...normAliases];
        if (all.includes(normA) && all.includes(normB)) {
          return {
            isMatch: true,
            confidence: 0.95,
            matchType: 'ALIAS',
            reason: `Matched via custom configured alias group '${key}'`,
            isAmbiguous: false,
          };
        }
      }
    }

    const defaultSetA = this.defaultAliases.get(normA);
    if (defaultSetA && defaultSetA.has(normB)) {
      return {
        isMatch: true,
        confidence: 0.88,
        matchType: 'ALIAS',
        reason: 'Matched via standard industry service alias dictionary',
        isAmbiguous: false,
      };
    }

    // 5. Substring / Prefix / Suffix inclusion with caution
    if (normA.length >= 4 && normB.length >= 4) {
      if (normA.includes(normB) || normB.includes(normA)) {
        const ratio = Math.min(normA.length, normB.length) / Math.max(normA.length, normB.length);
        if (ratio >= 0.6) {
          return {
            isMatch: true,
            confidence: Number((0.7 + ratio * 0.15).toFixed(2)),
            matchType: 'SUFFIX_PREFIX',
            reason: `Significant component substring overlap ('${normA}' and '${normB}')`,
            isAmbiguous: ratio < 0.75,
          };
        }
      }
    }

    // No confident match
    return {
      isMatch: false,
      confidence: 0.1,
      matchType: 'NONE',
      reason: `Entities '${rawA}' and '${rawB}' do not correspond deterministically`,
      isAmbiguous: false,
    };
  }

  /**
   * Evaluates query against multiple candidate entities, sorting by confidence.
   */
  public findMatches(
    query: string,
    candidates: string[],
    options?: EntityResolverOptions,
  ): CandidateMatch[] {
    const minThreshold = options?.minConfidenceThreshold ?? 0.7;
    const matches: CandidateMatch[] = [];

    for (const candidate of candidates) {
      const res = this.resolveEntityMatch(query, candidate, options);
      if (res.isMatch && res.confidence >= minThreshold) {
        matches.push({
          candidate,
          confidence: res.confidence,
          matchType: res.matchType,
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }
}
