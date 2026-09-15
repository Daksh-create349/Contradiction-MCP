import semver from 'semver';

export interface ValueComparisonResult {
  comparable: boolean;
  equal: boolean;
  compatible?: boolean;
  normalizedA: string;
  normalizedB: string;
  valueType: string;
  differenceStrength: number; // 0.0 (identical) to 1.0 (completely distinct/opposed)
  differenceType?: string;
  details?: Record<string, unknown>;
}

export class ValueComparator {
  public compare(valA: string, valB: string, explicitValueType?: string): ValueComparisonResult {
    // Basic null/empty guards
    const rawA = (valA ?? '').trim();
    const rawB = (valB ?? '').trim();

    if (rawA === '' && rawB === '') {
      return {
        comparable: true,
        equal: true,
        compatible: true,
        normalizedA: '',
        normalizedB: '',
        valueType: explicitValueType || 'string',
        differenceStrength: 0.0,
      };
    }

    if (rawA === '' || rawB === '') {
      return {
        comparable: true,
        equal: false,
        compatible: false,
        normalizedA: rawA,
        normalizedB: rawB,
        valueType: explicitValueType || 'string',
        differenceStrength: 1.0,
        differenceType: 'EMPTY_VS_NONEMPTY',
      };
    }

    const valueType = (explicitValueType || this.inferValueType(rawA, rawB)).toLowerCase();

    switch (valueType) {
      case 'version':
        return this.compareVersions(rawA, rawB);
      case 'date':
        return this.compareDates(rawA, rawB);
      case 'price':
        return this.comparePrices(rawA, rawB);
      case 'number':
      case 'quantity':
        return this.compareNumbers(rawA, rawB, valueType);
      case 'status':
        return this.compareStatuses(rawA, rawB);
      case 'boolean':
        return this.compareBooleans(rawA, rawB);
      default:
        return this.compareStrings(rawA, rawB, valueType);
    }
  }

  private inferValueType(a: string, b: string): string {
    if (this.isLikelyVersion(a) && this.isLikelyVersion(b)) return 'version';
    if (this.isLikelyDate(a) && this.isLikelyDate(b)) return 'date';
    if (this.isLikelyPrice(a) || this.isLikelyPrice(b)) return 'price';
    if (this.isLikelyNumber(a) && this.isLikelyNumber(b)) return 'number';
    return 'string';
  }

  // --- VERSION COMPARISON ---

  private isLikelyVersion(str: string): boolean {
    const s = str.trim();
    // Bare integers without dots or version operators are numbers/quantities, not versions
    if (/^\d+$/.test(s)) return false;

    return (
      (/\bv?\d+(\.\d+)+\b/i.test(s) && /(version|node|v\d|\d+\.\d+|[><=~^])/i.test(s)) ||
      Boolean(semver.valid(s)) ||
      (Boolean(semver.validRange(s)) && /[\^~><=v.]/.test(s))
    );
  }

  public cleanSemverRange(val: string): string | null {
    const cleaned = val
      .replace(/^(?:requires?|prerequisites?|node(?:\.js)?|version|v)?\s*[:=]?\s*/i, '')
      .trim();
    if (semver.validRange(cleaned)) {
      return cleaned;
    }
    return null;
  }

  public normalizeVersion(val: string): { canonical: string; segments: number[] } | null {
    // Extract semver-like sequence (e.g., "Node 22" -> "22", "v20.10.0" -> "20.10.0")
    const match = val.match(/\b(?:v|version)?\s*(\d+(?:\.\d+)*)\b/i);
    if (!match) return null;

    const versionStr = match[1];
    const segments = versionStr.split('.').map(Number);
    return {
      canonical: segments.join('.'),
      segments,
    };
  }

  private compareVersions(a: string, b: string): ValueComparisonResult {
    const parsedA = this.normalizeVersion(a);
    const parsedB = this.normalizeVersion(b);

    // Exact string match or identical canonical representation
    if (a === b && parsedA) {
      return {
        comparable: true,
        equal: true,
        compatible: true,
        normalizedA: parsedA.canonical,
        normalizedB: parsedA.canonical,
        valueType: 'version',
        differenceStrength: 0.0,
        details: {
          versionA: parsedA.canonical,
          versionB: parsedA.canonical,
          majorA: parsedA.segments[0],
          majorB: parsedA.segments[0],
        },
      };
    }

    const rangeRegex = /[><=~^\s*|]/;
    const cleanRangeA = this.cleanSemverRange(a);
    const cleanRangeB = this.cleanSemverRange(b);
    const hasRangeOpA = cleanRangeA !== null && rangeRegex.test(cleanRangeA);
    const hasRangeOpB = cleanRangeB !== null && rangeRegex.test(cleanRangeB);

    // 1. One is a SemVer range and the other is a concrete version
    if (hasRangeOpA && !hasRangeOpB && cleanRangeA) {
      const coercedB = semver.coerce(b);
      if (coercedB && semver.valid(coercedB.version)) {
        const satisfies = semver.satisfies(coercedB.version, cleanRangeA);
        return {
          comparable: true,
          equal: false,
          compatible: satisfies,
          normalizedA: parsedA?.canonical || cleanRangeA,
          normalizedB: coercedB.version,
          valueType: 'version',
          differenceStrength: satisfies ? 0.0 : 1.0,
          differenceType: satisfies ? 'RANGE_SATISFIED' : 'RANGE_VIOLATION',
          details: { range: cleanRangeA, version: coercedB.version, satisfies },
        };
      }
    }

    if (!hasRangeOpA && hasRangeOpB && cleanRangeB) {
      const coercedA = semver.coerce(a);
      if (coercedA && semver.valid(coercedA.version)) {
        const satisfies = semver.satisfies(coercedA.version, cleanRangeB);
        return {
          comparable: true,
          equal: false,
          compatible: satisfies,
          normalizedA: coercedA.version,
          normalizedB: parsedB?.canonical || cleanRangeB,
          valueType: 'version',
          differenceStrength: satisfies ? 0.0 : 1.0,
          differenceType: satisfies ? 'RANGE_SATISFIED' : 'RANGE_VIOLATION',
          details: { range: cleanRangeB, version: coercedA.version, satisfies },
        };
      }
    }

    // 2. Both are SemVer ranges
    if (hasRangeOpA && hasRangeOpB && cleanRangeA && cleanRangeB) {
      const intersects = semver.intersects(cleanRangeA, cleanRangeB);
      return {
        comparable: true,
        equal: cleanRangeA === cleanRangeB,
        compatible: intersects,
        normalizedA: parsedA?.canonical || cleanRangeA,
        normalizedB: parsedB?.canonical || cleanRangeB,
        valueType: 'version',
        differenceStrength: intersects ? 0.0 : 1.0,
        differenceType: intersects ? 'RANGES_INTERSECT' : 'DISJOINT_RANGES',
        details: { rangeA: cleanRangeA, rangeB: cleanRangeB, intersects },
      };
    }

    // 3. Fallback to exact / segment version comparison
    if (!parsedA || !parsedB) {
      return this.compareStrings(a, b, 'version');
    }

    const equal = parsedA.canonical === parsedB.canonical;
    const majorA = parsedA.segments[0];
    const majorB = parsedB.segments[0];
    const majorMismatch = majorA !== majorB;

    return {
      comparable: true,
      equal,
      compatible: equal,
      normalizedA: parsedA.canonical,
      normalizedB: parsedB.canonical,
      valueType: 'version',
      differenceStrength: equal ? 0.0 : majorMismatch ? 1.0 : 0.6,
      differenceType: equal
        ? undefined
        : majorMismatch
          ? 'MAJOR_VERSION_MISMATCH'
          : 'MINOR_VERSION_MISMATCH',
      details: {
        versionA: parsedA.canonical,
        versionB: parsedB.canonical,
        majorA,
        majorB,
      },
    };
  }

  // --- DATE COMPARISON ---

  private isLikelyDate(str: string): boolean {
    return !isNaN(Date.parse(str)) && /\d/.test(str);
  }

  public normalizeDate(val: string, preferredFormat?: 'MM/DD' | 'DD/MM'): string | null {
    // Check if ISO format YYYY-MM-DD
    const isoMatch = val.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (isoMatch) {
      const year = isoMatch[1];
      const month = isoMatch[2].padStart(2, '0');
      const day = isoMatch[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // Check for DD/MM/YYYY or MM/DD/YYYY format
    const slashMatch = val.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (slashMatch) {
      const p1 = Number(slashMatch[1]);
      const p2 = Number(slashMatch[2]);
      const year = slashMatch[3];

      const formatPref =
        preferredFormat ||
        (process.env.DATE_FORMAT === 'DD/MM/YYYY' || process.env.DATE_FORMAT === 'DD/MM'
          ? 'DD/MM'
          : 'MM/DD');

      if (p1 > 12 && p2 <= 12) {
        // Unambiguously DD/MM/YYYY
        return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
      } else if (p2 > 12 && p1 <= 12) {
        // Unambiguously MM/DD/YYYY
        return `${year}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
      } else if (formatPref === 'DD/MM') {
        return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
      } else {
        return `${year}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
      }
    }

    const timestamp = Date.parse(val);
    if (isNaN(timestamp)) {
      return null;
    }

    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private compareDates(a: string, b: string): ValueComparisonResult {
    const normA = this.normalizeDate(a);
    const normB = this.normalizeDate(b);

    if (!normA || !normB) {
      return {
        comparable: false,
        equal: a.trim().toLowerCase() === b.trim().toLowerCase(),
        normalizedA: a.trim(),
        normalizedB: b.trim(),
        valueType: 'date',
        differenceStrength: 0.5,
        differenceType: 'UNPARSEABLE_DATE',
      };
    }

    const equal = normA === normB;
    const timeA = new Date(normA).getTime();
    const timeB = new Date(normB).getTime();
    const dayDiff = Math.abs((timeA - timeB) / (1000 * 60 * 60 * 24));

    return {
      comparable: true,
      equal,
      normalizedA: normA,
      normalizedB: normB,
      valueType: 'date',
      differenceStrength: equal ? 0.0 : Math.min(1.0, 0.4 + dayDiff * 0.1),
      differenceType: equal ? undefined : 'DATE_MISMATCH',
      details: { dayDifference: dayDiff },
    };
  }

  // --- PRICE / CURRENCY COMPARISON ---

  private isLikelyPrice(str: string): boolean {
    return /[$\u20AC\u00A3\u00A5\u20B9]|(?:\b(?:INR|USD|EUR|GBP|JPY|CAD|AUD)\b)/i.test(str);
  }

  public normalizePrice(val: string): { amount: number; currency?: string } | null {
    // Explicit Unicode character escape codes prevent charset corruption across environments
    const currencyMap: Record<string, string> = {
      '\u20B9': 'INR', // ₹
      INR: 'INR',
      $: 'USD',
      USD: 'USD',
      '\u20AC': 'EUR', // €
      EUR: 'EUR',
      '\u00A3': 'GBP', // £
      GBP: 'GBP',
      '\u00A5': 'JPY', // ¥
      JPY: 'JPY',
      CAD: 'CAD',
      AUD: 'AUD',
    };

    let currency: string | undefined;
    for (const [symbol, code] of Object.entries(currencyMap)) {
      if (val.toUpperCase().includes(symbol)) {
        currency = code;
        break;
      }
    }

    // Extract numeric amount, removing commas
    const numericStr = val.replace(/[^0-9.]/g, '');
    const amount = parseFloat(numericStr);
    if (isNaN(amount)) return null;

    return { amount, currency };
  }

  private comparePrices(a: string, b: string): ValueComparisonResult {
    const parsedA = this.normalizePrice(a);
    const parsedB = this.normalizePrice(b);

    if (!parsedA || !parsedB) {
      return this.compareStrings(a, b, 'price');
    }

    const normStrA = `${parsedA.currency ? parsedA.currency + ' ' : ''}${parsedA.amount}`;
    const normStrB = `${parsedB.currency ? parsedB.currency + ' ' : ''}${parsedB.amount}`;

    // If currencies are both present and differ, this is a currency mismatch
    if (parsedA.currency && parsedB.currency && parsedA.currency !== parsedB.currency) {
      return {
        comparable: true,
        equal: false,
        normalizedA: normStrA,
        normalizedB: normStrB,
        valueType: 'price',
        differenceStrength: 1.0,
        differenceType: 'CURRENCY_MISMATCH',
        details: { currencyA: parsedA.currency, currencyB: parsedB.currency },
      };
    }

    const equal = Math.abs(parsedA.amount - parsedB.amount) < 0.001;
    const diff = Math.abs(parsedA.amount - parsedB.amount);

    return {
      comparable: true,
      equal,
      normalizedA: normStrA,
      normalizedB: normStrB,
      valueType: 'price',
      differenceStrength: equal ? 0.0 : 0.9,
      differenceType: equal ? undefined : 'AMOUNT_MISMATCH',
      details: {
        amountA: parsedA.amount,
        amountB: parsedB.amount,
        difference: diff,
      },
    };
  }

  // --- NUMBER / QUANTITY COMPARISON ---

  private isLikelyNumber(str: string): boolean {
    return /^[-+]?[\d,]+(?:\.\d+)?\s*(?:b|kb|mb|gb|tb|ms|s|sec|m|min|h|hr|hours)?$/i.test(
      str.trim(),
    );
  }

  public normalizeQuantity(val: string): { amount: number; unit?: string; display: string } | null {
    const trimmed = val.trim().replace(/,/g, '').toLowerCase();
    const match = trimmed.match(/^([-+]?\d+(?:\.\d+)?)\s*([a-z]*)$/i);
    if (!match) return null;

    const amount = parseFloat(match[1]);
    const rawUnit = match[2] ? match[2].toLowerCase() : undefined;

    if (isNaN(amount)) return null;

    // Memory / Data size (normalize to bytes)
    if (rawUnit) {
      if (['b', 'bytes', 'byte'].includes(rawUnit))
        return { amount, unit: 'bytes', display: `${amount} B` };
      if (['kb', 'k'].includes(rawUnit))
        return { amount: amount * 1024, unit: 'bytes', display: `${amount} KB` };
      if (['mb', 'm'].includes(rawUnit))
        return { amount: amount * 1024 * 1024, unit: 'bytes', display: `${amount} MB` };
      if (['gb', 'g'].includes(rawUnit))
        return { amount: amount * 1024 * 1024 * 1024, unit: 'bytes', display: `${amount} GB` };
      if (['tb', 't'].includes(rawUnit))
        return {
          amount: amount * 1024 * 1024 * 1024 * 1024,
          unit: 'bytes',
          display: `${amount} TB`,
        };

      // Duration / Time (normalize to milliseconds)
      if (['ms', 'millisecond', 'milliseconds'].includes(rawUnit))
        return { amount, unit: 'ms', display: `${amount} ms` };
      if (['s', 'sec', 'second', 'seconds'].includes(rawUnit))
        return { amount: amount * 1000, unit: 'ms', display: `${amount} s` };
      if (['m', 'min', 'minute', 'minutes'].includes(rawUnit))
        return { amount: amount * 60 * 1000, unit: 'ms', display: `${amount} min` };
      if (['h', 'hr', 'hour', 'hours'].includes(rawUnit))
        return { amount: amount * 3600 * 1000, unit: 'ms', display: `${amount} h` };
    }

    return { amount, unit: rawUnit, display: String(amount) };
  }

  private compareNumbers(a: string, b: string, valueType: string): ValueComparisonResult {
    const qA = this.normalizeQuantity(a);
    const qB = this.normalizeQuantity(b);

    if (qA && qB && qA.unit && qB.unit && qA.unit === qB.unit) {
      const equal = Math.abs(qA.amount - qB.amount) < 0.000001;
      return {
        comparable: true,
        equal,
        normalizedA: qA.display,
        normalizedB: qB.display,
        valueType,
        differenceStrength: equal ? 0.0 : 0.85,
        differenceType: equal ? undefined : 'NUMERIC_MISMATCH',
        details: {
          numberA: qA.amount,
          numberB: qB.amount,
          difference: Math.abs(qA.amount - qB.amount),
        },
      };
    }

    const numA = parseFloat(a.trim().replace(/,/g, ''));
    const numB = parseFloat(b.trim().replace(/,/g, ''));

    if (isNaN(numA) || isNaN(numB)) {
      return this.compareStrings(a, b, valueType);
    }

    const equal = Math.abs(numA - numB) < 0.000001;
    return {
      comparable: true,
      equal,
      normalizedA: String(numA),
      normalizedB: String(numB),
      valueType,
      differenceStrength: equal ? 0.0 : 0.85,
      differenceType: equal ? undefined : 'NUMERIC_MISMATCH',
      details: {
        numberA: numA,
        numberB: numB,
        difference: Math.abs(numA - numB),
      },
    };
  }

  // --- STATUS COMPARISON ---

  private compareStatuses(a: string, b: string): ValueComparisonResult {
    const normA = a.trim().toLowerCase();
    const normB = b.trim().toLowerCase();

    const equal = normA === normB;
    return {
      comparable: true,
      equal,
      normalizedA: normA,
      normalizedB: normB,
      valueType: 'status',
      differenceStrength: equal ? 0.0 : 0.95,
      differenceType: equal ? undefined : 'STATUS_MISMATCH',
    };
  }

  // --- BOOLEAN COMPARISON ---

  private normalizeBoolean(val: string): boolean | null {
    const v = val.trim().toLowerCase();
    if (['true', 'yes', '1', 'enabled', 'active', 'on'].includes(v)) return true;
    if (['false', 'no', '0', 'disabled', 'inactive', 'off'].includes(v)) return false;
    return null;
  }

  private compareBooleans(a: string, b: string): ValueComparisonResult {
    const boolA = this.normalizeBoolean(a);
    const boolB = this.normalizeBoolean(b);

    if (boolA === null || boolB === null) {
      return this.compareStrings(a, b, 'boolean');
    }

    const equal = boolA === boolB;
    return {
      comparable: true,
      equal,
      normalizedA: String(boolA),
      normalizedB: String(boolB),
      valueType: 'boolean',
      differenceStrength: equal ? 0.0 : 1.0,
      differenceType: equal ? undefined : 'BOOLEAN_MISMATCH',
    };
  }

  // --- STRING FALLBACK COMPARISON ---

  private compareStrings(a: string, b: string, valueType: string): ValueComparisonResult {
    const cleanA = a.trim().replace(/\s+/g, ' ');
    const cleanB = b.trim().replace(/\s+/g, ' ');

    const lowerA = cleanA.toLowerCase();
    const lowerB = cleanB.toLowerCase();

    const exactMatch = cleanA === cleanB;
    const caseInsensitiveMatch = lowerA === lowerB;

    return {
      comparable: true,
      equal: caseInsensitiveMatch,
      normalizedA: cleanA,
      normalizedB: cleanB,
      valueType,
      differenceStrength: caseInsensitiveMatch ? 0.0 : 0.8,
      differenceType: caseInsensitiveMatch ? undefined : 'VALUE_MISMATCH',
      details: {
        exactMatch,
        caseInsensitiveMatch,
      },
    };
  }
}

export const valueComparator = new ValueComparator();
