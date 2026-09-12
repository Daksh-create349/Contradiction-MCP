import crypto from 'node:crypto';
import { Connector, ConnectorMetadata, ConnectionTestResult } from '../types/connector.js';
import { FetchResult, ExtractedClaim } from '../types/fetchResult.js';
import { ValidationError } from '../../domain/types/common.js';
import { DEFAULT_READ_ONLY_SECURITY, ConnectorSecurityDescriptor } from '../base/security.js';
import { inferClaimValueType } from '../base/connectorUtils.js';
import { validateSafeUrl, SsrfError } from './ssrfGuard.js';
import { logger } from '../../utils/logger.js';

export interface WebsiteInput {
  url: string;
  sourceName?: string;
  scope?: string;
  environment?: string;
  timeoutMs?: number;
}

export interface WebsiteRawData {
  url: string;
  canonicalUrl?: string;
  title: string;
  statusCode: number;
  contentType: string;
  headers: Record<string, string>;
  textSnippet: string;
  extractedLines: string[];
}

export class WebsiteConnector implements Connector<WebsiteInput, WebsiteRawData> {
  public readonly type = 'website' as const;
  public readonly metadata: ConnectorMetadata = {
    type: 'website',
    displayName: 'Public Website Connector',
    description:
      'Fetches explicit public web URLs with strict SSRF defenses and extracts factual consistency claims.',
    authRequirement: 'none',
    enabled: true,
    capabilities: {
      supportsIncrementalSync: false,
      supportsFileInspection: false,
      supportedFileTypes: ['html', 'txt'],
    },
  };

  public readonly security: ConnectorSecurityDescriptor = {
    ...DEFAULT_READ_ONLY_SECURITY,
    requiresNetwork: true,
    allowedProtocols: ['http:', 'https:'],
    ssrfProtected: true,
    sensitivityLevel: 'PUBLIC',
  };

  public async testConnection(input?: WebsiteInput): Promise<ConnectionTestResult> {
    if (!input || !input.url) {
      return {
        accessible: true,
        authenticated: true,
        targetFound: false,
        details: { message: 'Website connector ready; provide url to test specific web page' },
      };
    }

    try {
      await validateSafeUrl(input.url);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs || 8000);

      try {
        const res = await fetch(input.url, {
          method: 'HEAD',
          signal: controller.signal,
          headers: { 'User-Agent': 'ContradictionMCP/0.1.0' },
        });

        return {
          accessible: res.ok,
          authenticated: true,
          targetFound: res.ok,
          details: {
            url: input.url,
            statusCode: res.status,
            contentType: res.headers.get('content-type') || 'unknown',
          },
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        accessible: false,
        authenticated: true,
        targetFound: false,
        error: msg,
      };
    }
  }

  public async fetch(input: WebsiteInput): Promise<FetchResult<WebsiteRawData>> {
    if (!input || !input.url) {
      throw new ValidationError('URL parameter is required for website connector');
    }

    // SSRF verification
    const safeUrl = await validateSafeUrl(input.url);
    const timeoutMs = input.timeoutMs || 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      logger.info('Fetching web page', { url: safeUrl.toString() });

      const response = await fetch(safeUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual', // Manual redirect check for SSRF on redirect target
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; ContradictionMCP/0.1.0; +https://github.com/mcp/contradiction)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        },
      });

      // Handle Redirects with SSRF validation
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new ValidationError(
            `Received redirect status ${response.status} without Location header`,
          );
        }
        const redirectUrl = new URL(location, safeUrl.toString()).toString();
        logger.info('Following redirect with SSRF verification', {
          from: safeUrl.toString(),
          to: redirectUrl,
        });
        await validateSafeUrl(redirectUrl);

        // Fetch redirected resource
        return this.fetch({ ...input, url: redirectUrl });
      }

      if (!response.ok) {
        throw new ValidationError(
          `HTTP error fetching ${input.url}: ${response.status} ${response.statusText}`,
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('text/plain') &&
        !contentType.includes('json')
      ) {
        throw new ValidationError(
          `Unsupported content-type '${contentType}'. Only HTML/plain text is supported.`,
        );
      }

      const text = await response.text();
      const MAX_SIZE = 5 * 1024 * 1024;
      if (text.length > MAX_SIZE) {
        throw new ValidationError(
          `Downloaded page content length ${text.length} exceeds maximum limit of 5MB`,
        );
      }

      const title = this.extractTitle(text) || safeUrl.hostname;
      const cleanLines = this.extractCleanLines(text);

      return {
        sourceIdentifier: `website:${safeUrl.toString()}`,
        sourceName: input.sourceName || title,
        sourceUri: safeUrl.toString(),
        fetchedAt: new Date(),
        rawData: {
          url: safeUrl.toString(),
          title,
          statusCode: response.status,
          contentType,
          headers: Object.fromEntries(response.headers.entries()),
          textSnippet: cleanLines.slice(0, 5).join(' '),
          extractedLines: cleanLines,
        },
        metadata: {
          url: safeUrl.toString(),
          title,
          scope: input.scope || 'public_web',
          environment: input.environment || 'production',
          sourceRole: 'documentation',
        },
      };
    } catch (error) {
      if (error instanceof SsrfError) {
        logger.error('SSRF attack blocked by website connector', {
          url: input.url,
          error: error.message,
        });
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch website', { url: input.url, error: msg });
      throw new ValidationError(`Failed to fetch web resource: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  public async extractClaims(fetchResult: FetchResult<WebsiteRawData>): Promise<ExtractedClaim[]> {
    const { rawData, metadata } = fetchResult;
    const { url, title, extractedLines } = rawData;
    const claims: ExtractedClaim[] = [];
    const subject = title.replace(/[^a-zA-Z0-9_\s-]/g, '').trim() || 'Website';
    const env = (metadata.environment as string) || 'production';
    const scope = (metadata.scope as string) || 'public_web';

    const kvRegex =
      /^\s*[-*•]?\s*(?:\*{1,2}|`|__)?([a-zA-Z0-9_\s.-]{2,50}?)(?:\*{1,2}|`|__)?\s*[:=]\s*(?:\*{1,2}|`|__)?([^\r\n#]{1,160}?)(?:\*{1,2}|`|__)?(?:\s+#.*)?$/;

    for (let i = 0; i < extractedLines.length; i++) {
      const line = extractedLines[i].trim();
      if (!line) continue;

      let rawKey: string | null = null;
      let rawVal: string | null = null;
      let method = 'html_text_pattern';

      const match = kvRegex.exec(line);
      if (match) {
        const k = match[1].trim();
        const v = match[2].trim();
        if (k && v && !k.startsWith('#') && !k.includes('---')) {
          rawKey = k.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          rawVal = v.replace(/^[*`_"'\s]+|[*`_"'\s]+$/g, '').trim();

          const qtyMatch = rawVal.match(
            /(?:at\s+least|minimum|requires|is)?\s*(\d+(?:\.\d+)?\s*(?:gb|mb|tb|kb|g|m|b|ms|s|sec|seconds|minutes|hours))\b/i,
          );
          if (rawVal.length > 20 && qtyMatch) {
            rawVal = qtyMatch[1].trim();
          }
        }
      }

      // Prose assertion heuristics
      if (!rawKey) {
        const proseRamMatch = line.match(
          /(?:requires|minimum|needs)\s*(?:at\s+least)?\s*(\d+(?:\.\d+)?\s*(?:gb|mb|tb))\s*(?:of\s+)?(?:ram|memory)/i,
        );
        if (proseRamMatch) {
          rawKey = 'minimum_ram';
          rawVal = proseRamMatch[1].trim();
          method = 'prose_heuristic';
        } else {
          const prosePortMatch = line.match(/(?:runs|listens)\s+on\s+port\s+(\d{2,5})/i);
          if (prosePortMatch) {
            rawKey = 'port';
            rawVal = prosePortMatch[1].trim();
            method = 'prose_heuristic';
          } else {
            const proseNodeMatch = line.match(
              /(?:requires\s+)?(?:node|node\.js|nodejs)\s+(?:version\s+)?([v=~^><\d.]+)/i,
            );
            if (proseNodeMatch) {
              rawKey = 'node_version';
              rawVal = proseNodeMatch[1].trim();
              method = 'prose_heuristic';
            } else {
              const prosePyMatch = line.match(
                /(?:requires\s+)?(?:python|py)\s+(?:version\s+)?([v=~^><\d.]+)/i,
              );
              if (prosePyMatch) {
                rawKey = 'python_version';
                rawVal = prosePyMatch[1].trim();
                method = 'prose_heuristic';
              } else {
                const proseDbMatch = line.match(
                  /(?:requires|uses|connects\s+to)\s+(postgres(?:ql)?|mysql|redis|mongodb|sqlite)\s+(?:database|db)?/i,
                );
                if (proseDbMatch) {
                  rawKey = 'database';
                  rawVal = proseDbMatch[1].trim();
                  method = 'prose_heuristic';
                }
              }
            }
          }
        }
      }

      if (
        rawKey &&
        rawVal &&
        rawKey.length > 2 &&
        rawVal.length > 0 &&
        !rawVal.startsWith('http')
      ) {
        const externalId = crypto
          .createHash('sha256')
          .update(`website:${url}:${rawKey}:${rawVal}:${i}`)
          .digest('hex');
        const valueType = inferClaimValueType(rawKey, rawVal);

        claims.push({
          subject,
          predicate: rawKey,
          value: rawVal,
          valueType,
          environment: env,
          scope,
          sourceRole: 'documentation',
          isHistorical: false,
          observedAt: new Date(),
          externalId,
          provenance: {
            connector: 'website',
            url,
            filePath: url,
            extractionMethod: method,
            observedAt: new Date().toISOString(),
            evidence: line,
          },
        });
      }
    }

    logger.debug('Extracted claims from website', { url, count: claims.length });
    return claims;
  }

  private extractTitle(html: string): string {
    const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    return match ? match[1].trim() : '';
  }

  private extractCleanLines(html: string): string[] {
    // Strip script and style blocks
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

    // Parse HTML table rows into key: value formatted lines
    cleaned = cleaned.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, rowContent) => {
      const cells: string[] = [];
      const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const text = cellMatch[1].replace(/<[^>]+>/g, ' ').trim();
        if (text) cells.push(text);
      }
      if (cells.length >= 2) {
        return `\n${cells[0]}: ${cells[1]}\n`;
      }
      return '\n' + cells.join(' ') + '\n';
    });

    const stripped = cleaned.replace(/<[^>]+>/g, '\n');

    return stripped
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 3 && !l.startsWith('//') && !l.startsWith('/*'));
  }
}
