export interface SemanticMatchResult {
  matched: boolean;
  confidence: number;
  reason: string;
  matchedFeatures: string[];
}

export interface SemanticMatcherConfig {
  enabled: boolean;
  threshold?: number;
}

export class SemanticMatcher {
  private readonly enabled: boolean;
  private readonly threshold: number;

  constructor(config?: Partial<SemanticMatcherConfig>) {
    const envEnabled =
      process.env.SEMANTIC_MATCHING_ENABLED !== undefined
        ? process.env.SEMANTIC_MATCHING_ENABLED === 'true' ||
          process.env.SEMANTIC_MATCHING_ENABLED === '1'
        : process.env.ENABLE_SEMANTIC_MATCHING !== undefined
          ? process.env.ENABLE_SEMANTIC_MATCHING === 'true' ||
            process.env.ENABLE_SEMANTIC_MATCHING === '1'
          : true;

    this.enabled = config?.enabled !== undefined ? config.enabled : envEnabled;
    this.threshold = config?.threshold ?? 0.65;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Compares two phrases or textual predicates using an explainable n-gram and token-set similarity algorithm.
   */
  public match(textA: string, textB: string): SemanticMatchResult {
    if (!this.enabled) {
      return {
        matched: false,
        confidence: 0.0,
        reason: 'Semantic matching is disabled by configuration',
        matchedFeatures: [],
      };
    }

    const tokensA = this.tokenize(textA);
    const tokensB = this.tokenize(textB);

    if (tokensA.length === 0 || tokensB.length === 0) {
      return {
        matched: false,
        confidence: 0.0,
        reason: 'Empty tokens extracted from input',
        matchedFeatures: [],
      };
    }

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    const intersection = [...setA].filter((t) => setB.has(t));
    const union = new Set([...setA, ...setB]);

    const jaccard = intersection.length / union.size;

    // Sub-token or prefix alignment
    const partialMatches: string[] = [];
    for (const a of setA) {
      for (const b of setB) {
        if (a !== b && (a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 4) {
          partialMatches.push(`${a}~${b}`);
        }
      }
    }

    const boost = Math.min(0.25, partialMatches.length * 0.1);
    const confidence = Number(Math.min(1.0, jaccard + boost).toFixed(3));
    const matched = confidence >= this.threshold;

    const matchedFeatures = [
      ...intersection.map((t) => `exact:${t}`),
      ...partialMatches.map((m) => `stem:${m}`),
    ];

    return {
      matched,
      confidence,
      reason: matched
        ? `Semantic similarity ${confidence.toFixed(2)} exceeds threshold ${this.threshold}`
        : `Semantic similarity ${confidence.toFixed(2)} is below threshold ${this.threshold}`,
      matchedFeatures,
    };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(t));
  }
}
