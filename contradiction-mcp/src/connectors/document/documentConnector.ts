import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';
import { PDFParse } from 'pdf-parse';
import { Connector, ConnectorMetadata, ConnectionTestResult } from '../types/connector.js';
import { FetchResult, ExtractedClaim } from '../types/fetchResult.js';
import { ValidationError, NotFoundError } from '../../domain/types/common.js';
import type { ClaimEnvironment, ClaimScope, ClaimSourceRole } from '../../domain/entities/claim.js';
import { DEFAULT_READ_ONLY_SECURITY, ConnectorSecurityDescriptor } from '../base/security.js';
import { createClaimExternalId, inferClaimValueType } from '../base/connectorUtils.js';
import { logger } from '../../utils/logger.js';

export interface DocumentInput {
  filePath: string;
  sourceName?: string;
  subject?: string;
  scope?: string;
  environment?: string;
  sourceRole?: string;
}

export interface PdfPageData {
  pageNumber: number;
  text: string;
  lines: string[];
}

export interface DocumentRawData {
  filePath: string;
  fileExtension: string;
  fileSizeBytes: number;
  content: string;
  lines: string[];
  pdfPages?: PdfPageData[];
}

export interface DocumentConnectorOptions {
  allowedRoots?: string[];
  maxFileSizeBytes?: number;
}

export class DocumentConnector implements Connector<DocumentInput, DocumentRawData> {
  public readonly type = 'document' as const;
  private readonly allowedRoots?: string[];
  private readonly maxFileSizeBytes: number;

  public readonly metadata: ConnectorMetadata = {
    type: 'document',
    displayName: 'Local Document Connector',
    description:
      'Reads and extracts factual claims from local text, Markdown, JSON, YAML, CSV, and PDF files.',
    authRequirement: 'none',
    enabled: true,
    capabilities: {
      supportsIncrementalSync: false,
      supportsFileInspection: true,
      supportedFileTypes: [
        '.md',
        '.txt',
        '.json',
        '.yaml',
        '.yml',
        '.csv',
        '.pdf',
        '.docx',
        '.eml',
      ],
    },
  };

  public readonly security: ConnectorSecurityDescriptor = {
    ...DEFAULT_READ_ONLY_SECURITY,
    requiresNetwork: false,
    sensitivityLevel: 'INTERNAL',
  };

  constructor(options?: DocumentConnectorOptions) {
    this.allowedRoots = options?.allowedRoots;
    this.maxFileSizeBytes = options?.maxFileSizeBytes ?? 10 * 1024 * 1024;
  }

  private validatePath(resolved: string): string {
    let realPath: string;
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      throw new NotFoundError('File', resolved);
    }

    if (this.allowedRoots && this.allowedRoots.length > 0) {
      const isAllowed = this.allowedRoots.some((root) => {
        const resolvedRoot = path.resolve(root);
        return realPath === resolvedRoot || realPath.startsWith(resolvedRoot + path.sep);
      });
      if (!isAllowed) {
        throw new ValidationError(
          `Access denied: path '${resolved}' is outside allowed document directories`,
        );
      }
    }

    return realPath;
  }

  public async testConnection(input?: DocumentInput): Promise<ConnectionTestResult> {
    if (!input || !input.filePath) {
      return {
        accessible: true,
        authenticated: true,
        targetFound: false,
        details: {
          message: 'Document connector ready; specify filePath to inspect specific document',
        },
      };
    }

    try {
      const resolved = path.resolve(input.filePath);
      const realPath = this.validatePath(resolved);
      const stat = fs.statSync(realPath);
      if (!stat.isFile()) {
        return {
          accessible: false,
          authenticated: true,
          targetFound: false,
          error: `Path is not a regular file: ${resolved}`,
        };
      }

      return {
        accessible: true,
        authenticated: true,
        targetFound: true,
        details: {
          path: realPath,
          sizeBytes: stat.size,
          lastModified: stat.mtime.toISOString(),
        },
      };
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

  public async fetch(input: DocumentInput): Promise<FetchResult<DocumentRawData>> {
    if (!input || !input.filePath) {
      throw new ValidationError('Document filePath is required');
    }

    const resolved = path.resolve(input.filePath);
    const realPath = this.validatePath(resolved);
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      throw new ValidationError(`Target path is not a file: ${resolved}`);
    }

    if (stat.size > this.maxFileSizeBytes) {
      throw new ValidationError(
        `Document file size ${stat.size} bytes exceeds maximum allowed limit (${this.maxFileSizeBytes} bytes)`,
      );
    }

    const ext = path.extname(realPath).toLowerCase();
    let content: string;
    let lines: string[];
    let pdfPages: PdfPageData[] | undefined;

    if (ext === '.pdf') {
      try {
        const buffer = fs.readFileSync(realPath);
        const parser = new PDFParse({ data: buffer });
        const textResult = await parser.getText();
        content = textResult.text || '';
        lines = content.split(/\r?\n/);
        pdfPages = (textResult.pages || []).map((p) => ({
          pageNumber: p.num,
          text: p.text,
          lines: p.text.split(/\r?\n/),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ValidationError(`Failed to parse PDF file '${resolved}': ${msg}`);
      }
    } else if (ext === '.docx') {
      try {
        const xml = child_process.execFileSync('unzip', ['-p', realPath, 'word/document.xml'], {
          encoding: 'utf-8',
          maxBuffer: this.maxFileSizeBytes,
        });

        const extractedLines: string[] = [];

        // 1. Extract table rows (<w:tr>) first to capture tabular specifications and key-value matrices
        const tableRows = xml.match(/<w:tr\b[^>]*>.*?<\/w:tr>/gs) || [];
        for (const tr of tableRows) {
          const cells = tr.match(/<w:tc\b[^>]*>.*?<\/w:tc>/gs) || [];
          const cellTexts = cells
            .map((cell) => {
              const tMatches = cell.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) || [];
              return tMatches
                .map((t) => t.replace(/<[^>]+>/g, ''))
                .join('')
                .trim();
            })
            .filter(Boolean);

          if (cellTexts.length >= 2) {
            extractedLines.push(`- ${cellTexts[0]}: ${cellTexts.slice(1).join(' ')}`);
          } else if (cellTexts.length === 1) {
            extractedLines.push(cellTexts[0]);
          }
        }

        // 2. Extract regular paragraphs outside tables
        const xmlWithoutTables = xml.replace(/<w:tbl\b[^>]*>.*?<\/w:tbl>/gs, '');
        const paragraphs = xmlWithoutTables.match(/<w:p\b[^>]*>.*?<\/w:p>/gs) || [];
        for (const p of paragraphs) {
          const textMatches = p.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g);
          if (!textMatches) continue;
          const text = textMatches
            .map((t) => t.replace(/<[^>]+>/g, ''))
            .join('')
            .trim();
          if (text) {
            extractedLines.push(text);
          }
        }

        // De-duplicate contiguous identical lines
        lines = extractedLines.filter((l, idx) => idx === 0 || l !== extractedLines[idx - 1]);
        content = lines.join('\n');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ValidationError(`Failed to parse DOCX file '${resolved}': ${msg}`);
      }
    } else {
      content = fs.readFileSync(realPath, 'utf-8');
      lines = content.split(/\r?\n/);
    }

    const sourceName = input.sourceName || path.basename(realPath);

    return {
      sourceIdentifier: `document:${realPath}`,
      sourceName,
      sourceUri: `file://${realPath}`,
      fetchedAt: new Date(),
      rawData: {
        filePath: realPath,
        fileExtension: ext,
        fileSizeBytes: stat.size,
        content,
        lines,
        pdfPages,
      },
      metadata: {
        filePath: realPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        subject: input.subject,
        scope: input.scope || 'file',
        environment: input.environment || 'unknown',
        sourceRole: input.sourceRole || 'documentation',
      },
    };
  }

  public async extractClaims(fetchResult: FetchResult<DocumentRawData>): Promise<ExtractedClaim[]> {
    const { rawData, metadata } = fetchResult;
    const { filePath, fileExtension, lines, content } = rawData;
    const claims: ExtractedClaim[] = [];

    // Auto-detect H1 subject if subject is not explicitly set
    const subjectBase = (metadata.subject as string) || path.basename(filePath, fileExtension);
    const defaultScope = (metadata.scope as string) || 'file';
    const defaultEnv = (metadata.environment as string) || 'unknown';
    const defaultRole =
      (metadata.sourceRole as string) ||
      (fileExtension === '.json' || fileExtension === '.yaml' || fileExtension === '.yml'
        ? 'configuration'
        : 'documentation');
    const mtimeDate = metadata.mtime ? new Date(metadata.mtime as string) : new Date();

    switch (fileExtension) {
      case '.json':
        this.extractFromJson(
          content,
          filePath,
          subjectBase,
          defaultEnv,
          defaultScope,
          defaultRole,
          claims,
          mtimeDate,
        );
        break;
      case '.yaml':
      case '.yml':
        this.extractFromYamlOrText(
          lines,
          filePath,
          subjectBase,
          defaultEnv,
          defaultScope,
          defaultRole,
          claims,
          'yaml_parse',
          mtimeDate,
        );
        break;
      case '.csv':
        this.extractFromCsv(
          lines,
          filePath,
          subjectBase,
          defaultEnv,
          defaultScope,
          defaultRole,
          claims,
          mtimeDate,
        );
        break;
      case '.pdf':
        this.extractFromPdf(
          rawData,
          filePath,
          subjectBase,
          defaultEnv,
          defaultScope,
          defaultRole,
          claims,
          mtimeDate,
        );
        break;
      case '.eml':
        this.extractFromEmail(
          lines,
          filePath,
          subjectBase,
          defaultEnv,
          defaultScope,
          defaultRole,
          claims,
          mtimeDate,
        );
        break;
      case '.docx':
      case '.md':
      case '.txt':
      default:
        // Check if file is formatted as an email even with .txt extension
        if (lines.length > 3 && lines.slice(0, 8).some((l) => /^From:\s+/i.test(l))) {
          this.extractFromEmail(
            lines,
            filePath,
            subjectBase,
            defaultEnv,
            defaultScope,
            defaultRole,
            claims,
            mtimeDate,
          );
        } else {
          this.extractFromMarkdownOrText(
            lines,
            filePath,
            subjectBase,
            defaultEnv,
            defaultScope,
            defaultRole,
            claims,
            mtimeDate,
          );
        }
        break;
    }

    logger.debug('Extracted claims from document', {
      filePath,
      claimsCount: claims.length,
    });

    return claims;
  }

  private extractFromEmail(
    lines: string[],
    filePath: string,
    subjectBase: string,
    env: string,
    scope: string,
    sourceRole: string,
    claims: ExtractedClaim[],
    observedAt: Date,
  ): void {
    let emailDate: Date | null = null;
    const bodyLines: string[] = [];
    let isBody = false;

    for (const line of lines) {
      if (!isBody) {
        if (line.trim() === '') {
          isBody = true;
          continue;
        }
        const dateMatch = line.match(/^Date:\s*(.+)$/i);
        if (dateMatch) {
          const parsed = Date.parse(dateMatch[1]);
          if (!isNaN(parsed)) {
            emailDate = new Date(parsed);
          }
        }
      } else {
        bodyLines.push(line);
      }
    }

    this.extractFromMarkdownOrText(
      bodyLines.length > 0 ? bodyLines : lines,
      filePath,
      subjectBase,
      env,
      scope,
      sourceRole,
      claims,
      emailDate || observedAt,
    );
  }

  private extractFromJson(
    content: string,
    filePath: string,
    subjectBase: string,
    env: string,
    scope: string,
    sourceRole: string,
    claims: ExtractedClaim[],
    observedAt: Date,
  ): void {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) return;

      const flatEntries = this.flattenJsonObject(parsed as Record<string, unknown>);
      let index = 0;
      for (const [key, val] of flatEntries) {
        index++;
        const predicate = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const valueStr = String(val);
        const externalId = createClaimExternalId('document', filePath, predicate, String(index));

        claims.push({
          subject: subjectBase,
          predicate,
          value: valueStr,
          valueType: inferClaimValueType(predicate, valueStr),
          environment: env,
          scope,
          sourceRole,
          isHistorical: false,
          observedAt,
          externalId,
          provenance: {
            connector: 'document',
            filePath,
            extractionMethod: 'json_parse',
            observedAt: observedAt.toISOString(),
            evidence: `"${key}": ${JSON.stringify(val)}`,
          },
        });
      }
    } catch {
      // Fallback
    }
  }

  private flattenJsonObject(
    obj: Record<string, unknown>,
    prefix = '',
    depth = 0,
  ): Array<[string, string | number | boolean]> {
    const entries: Array<[string, string | number | boolean]> = [];
    for (const [k, v] of Object.entries(obj)) {
      const compositeKey = prefix ? `${prefix}_${k}` : k;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        // Always emit the full composite key (namespaced path) for uniqueness.
        // Only emit a bare leaf alias at depth 0 (top-level keys are unambiguous).
        // For nested keys (depth > 0), the bare leaf is ambiguous across sections
        // (e.g. api_gateway.port vs cache.port) and causes false-positive pairs.
        entries.push([compositeKey, v]);
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        entries.push(
          ...this.flattenJsonObject(v as Record<string, unknown>, compositeKey, depth + 1),
        );
      } else if (Array.isArray(v)) {
        // For env-style arrays [{name, value}], extract name=value pairs
        for (const item of v) {
          if (
            typeof item === 'object' &&
            item !== null &&
            'name' in item &&
            'value' in item &&
            typeof (item as Record<string, unknown>).name === 'string'
          ) {
            const envItem = item as { name: string; value: unknown };
            const leafKey = envItem.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
            const leafVal = String(envItem.value);
            entries.push([leafKey, leafVal]);
          }
        }
      }
    }
    return entries;
  }

  private extractFromYamlOrText(
    lines: string[],
    filePath: string,
    subjectBase: string,
    env: string,
    scope: string,
    sourceRole: string,
    claims: ExtractedClaim[],
    method: string,
    observedAt: Date = new Date(),
  ): void {
    const kvRegex = /^\s*([a-zA-Z0-9_-]+)\s*[:=]\s*(['"]?)([^'"#\r\n]+)\2\s*(?:#.*)?$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = kvRegex.exec(line);
      if (match) {
        const rawKey = match[1].trim();
        const rawVal = match[3].trim();
        if (rawVal.length > 0 && !rawVal.startsWith('{') && !rawVal.startsWith('[')) {
          const predicate = rawKey.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          const externalId = createClaimExternalId('document', filePath, predicate, String(i + 1));
          const valueType = inferClaimValueType(predicate, rawVal);

          claims.push({
            subject: subjectBase,
            predicate,
            value: rawVal,
            valueType,
            environment: env,
            scope,
            sourceRole,
            isHistorical: false,
            observedAt,
            externalId,
            provenance: {
              connector: 'document',
              filePath,
              lineRange: [i + 1, i + 1],
              extractionMethod: method,
              observedAt: observedAt.toISOString(),
              evidence: line.trim(),
            },
          });
        }
      }
    }
  }

  private extractFromCsv(
    lines: string[],
    filePath: string,
    subjectBase: string,
    env: string,
    scope: string,
    sourceRole: string,
    claims: ExtractedClaim[],
    observedAt: Date = new Date(),
  ): void {
    if (lines.length < 2) return;
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values = line.split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
      const rowSubject = values[0] || `${subjectBase}_row_${i}`;

      for (let c = 1; c < Math.min(headers.length, values.length); c++) {
        const header = headers[c];
        const val = values[c];
        if (header && val) {
          const predicate = header.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          const externalId = createClaimExternalId(
            'document',
            filePath,
            predicate,
            `${rowSubject}:${i + 1}`,
          );
          const valueType = inferClaimValueType(predicate, val);

          claims.push({
            subject: rowSubject,
            predicate,
            value: val,
            valueType,
            environment: env,
            scope,
            sourceRole,
            isHistorical: false,
            observedAt,
            externalId,
            provenance: {
              connector: 'document',
              filePath,
              lineRange: [i + 1, i + 1],
              extractionMethod: 'csv_row',
              observedAt: observedAt.toISOString(),
              evidence: line,
            },
          });
        }
      }
    }
  }

  private extractFromMarkdownOrText(
    lines: string[],
    filePath: string,
    subjectBase: string,
    env: string,
    scope: string,
    sourceRole: string,
    claims: ExtractedClaim[],
    observedAt: Date = new Date(),
  ): void {
    // Anchored key-value pattern supporting bold, code, lists, and multi-token values with spaces
    const directKvPattern =
      /^\s*(?:[-*+]|\d+\.)?\s*(?:\*{1,2}|`|__)?([a-zA-Z0-9_\s.-]{2,50}?)(?:\*{1,2}|`|__)?\s*[:=]\s*(?:\*{1,2}|`|__)?([^\r\n#]{1,160}?)(?:\*{1,2}|`|__)?(?:\s+#.*)?$/;

    // Markdown table row pattern
    const tablePattern = /^\s*\|\s*([^|:\r\n]{2,50}?)\s*\|\s*([^|\r\n]{1,160}?)\s*\|/;

    let currentSection: string | null = null;
    let currentTableHeaders: string[] | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;

      const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
      if (headingMatch) {
        const rawHeading = headingMatch[2].trim();
        const genericSections =
          /^(overview|introduction|getting started|summary|table of contents|notes|appendix|prerequisites|requirements|runtime requirements|deployment profile|deployment requirements|technology stack|service configuration|configuration|specifications|specs|monitoring|security|hardware requirements)/i;
        if (!genericSections.test(rawHeading)) {
          let s = rawHeading
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
          s = s.replace(/_(cluster|layer|service|server|component|section)$/, '');
          currentSection = s;
        } else {
          currentSection = null;
        }
        continue;
      }

      let key: string | null = null;
      let val: string | null = null;
      let method = 'markdown_pattern';

      // 0. Check markdown badges (e.g. build: passing vs failing)
      const badgeMatches = line.matchAll(
        /!\[([^\]]*)\]\((https?:\/\/[^\s)]*(?:shields\.io\/badge\/|github\.com\/[^\s)]*\/badge\.svg|[a-z0-9_-]+-badge)[^\s)]*)\)/gi,
      );
      for (const bMatch of badgeMatches) {
        const alt = (bMatch[1] || '').trim();
        const url = (bMatch[2] || '').trim();

        let badgeSubject = 'build';
        let badgeStatus: string | null = null;

        const shieldsMatch = url.match(/shields\.io\/badge\/([^?#]+)/i);
        if (shieldsMatch) {
          const decoded = decodeURIComponent(shieldsMatch[1]);
          const parts = decoded.split('-');
          if (parts.length >= 2) {
            badgeSubject = parts[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
            badgeStatus = parts[1].toLowerCase();
          }
        } else if (/badge\.svg/i.test(url)) {
          if (/passing|success/i.test(url) || /passing|success/i.test(alt)) {
            badgeStatus = 'passing';
          } else if (/failing|failed|error/i.test(url) || /failing|failed|error/i.test(alt)) {
            badgeStatus = 'failing';
          }
        }

        if (alt && !badgeStatus) {
          const altParts = alt.split(/[:\s-]+/);
          if (altParts.length >= 2) {
            badgeSubject = altParts[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
            badgeStatus = altParts[1].toLowerCase();
          }
        }

        if (badgeStatus) {
          const badgeKey = `${badgeSubject}_status`;
          let finalKey = badgeKey;
          if (currentSection && !badgeKey.startsWith(currentSection)) {
            finalKey = `${currentSection}_${badgeKey}`;
          }
          const externalId = createClaimExternalId('document', filePath, finalKey, String(i + 1));
          claims.push({
            subject: subjectBase,
            predicate: finalKey,
            value: badgeStatus,
            valueType: 'status',
            environment: env,
            scope,
            sourceRole,
            isHistorical: false,
            observedAt,
            externalId,
            provenance: {
              connector: 'document',
              filePath,
              lineRange: [i + 1, i + 1],
              extractionMethod: 'markdown_badge',
              observedAt: observedAt.toISOString(),
              evidence: line.trim(),
            },
          });
        }
      }

      // 1. Check direct KV (bold labels, lists, etc.)
      const directMatch = directKvPattern.exec(line);
      if (directMatch) {
        const rawK = directMatch[1].trim();
        const rawV = directMatch[2].trim();
        if (rawK && rawV && !rawK.startsWith('#') && !rawK.includes('---')) {
          const lowerK = rawK.toLowerCase();
          if (
            lowerK === 'specification' ||
            lowerK === 'property' ||
            lowerK === 'setting' ||
            lowerK === 'key' ||
            lowerK === 'parameter' ||
            lowerK === 'attribute'
          ) {
            continue;
          }

          key = rawK.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          val = rawV.replace(/^[*`_"'\s]+|[*`_"'\s]+$/g, '').trim();

          const qtyMatch = val.match(
            /(?:at\s+least|minimum|requires|is)?\s*(\d+(?:\.\d+)?\s*(?:gb|mb|tb|kb|g|m|b|ms|s|sec|seconds|minutes|hours))\b/i,
          );
          if (val.length > 20 && qtyMatch) {
            val = qtyMatch[1].trim();
          }
        }
      }

      // 2. Check markdown table row
      const isTableRow = /^\s*\|.*\|\s*$/.test(line);
      const isDelimiter = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);

      if (isDelimiter) {
        continue;
      }

      if (isTableRow && !key) {
        // Check if next line is a delimiter: if so, current line is the table header row!
        if (
          i + 1 < lines.length &&
          /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])
        ) {
          let trimmed = line.trim();
          if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
          if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
          currentTableHeaders = trimmed.split('|').map((h) =>
            h
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, '_')
              .replace(/_+/g, '_')
              .replace(/^_|_$/g, ''),
          );
          continue; // Skip emitting claim for the header row!
        }

        let trimmed = line.trim();
        if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
        if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
        const cells = trimmed.split('|').map((c) => c.trim());

        const tableBlacklist = new Set([
          'property',
          'setting',
          'key',
          'parameter',
          'attribute',
          'specification',
          'requirement',
          'requirements',
          'component',
          'minimum',
          'recommended',
          'default',
          'description',
          'notes',
          'feature',
          'variable',
          'option',
          'name',
          'field',
          'spec',
        ]);

        const rawK = cells[0]
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');

        if (cells.length >= 2 && !tableBlacklist.has(rawK) && !cells[0].includes('---')) {
          // If multi-column table with headers
          if (currentTableHeaders && currentTableHeaders.length > 2 && cells.length > 2) {
            for (let cIdx = 1; cIdx < cells.length; cIdx++) {
              const rawCol = currentTableHeaders[cIdx] || `col_${cIdx}`;
              const colClean = rawCol.replace(/_+/g, '_');
              const cellVal = cells[cIdx].replace(/^[*`_"'\s]+|[*`_"'\s]+$/g, '').trim();
              if (cellVal && cellVal !== '-' && !cellVal.includes('---')) {
                const compositeKey = `${rawK}_${colClean}`;
                let finalKey = compositeKey;
                if (currentSection && !compositeKey.startsWith(currentSection)) {
                  finalKey = `${currentSection}_${compositeKey}`;
                }
                const externalId = createClaimExternalId(
                  'document',
                  filePath,
                  finalKey,
                  String(i + 1),
                );
                const valueType = inferClaimValueType(finalKey, cellVal);
                claims.push({
                  subject: subjectBase,
                  predicate: finalKey,
                  value: cellVal,
                  valueType,
                  environment: env,
                  scope,
                  sourceRole,
                  isHistorical: false,
                  observedAt,
                  externalId,
                  provenance: {
                    connector: 'document',
                    filePath,
                    lineRange: [i + 1, i + 1],
                    extractionMethod: 'markdown_table',
                    observedAt: observedAt.toISOString(),
                    evidence: line.trim(),
                  },
                });
              }
            }
            continue;
          }

          // Standard 2-column table row
          key = rawK;
          val = cells[1].replace(/^[*`_"'\s]+|[*`_"'\s]+$/g, '').trim();
          method = 'markdown_table';
        }
      } else if (!isTableRow) {
        currentTableHeaders = null;
      }

      // 3. Check prose assertion heuristics
      if (!key) {
        const proseRamMatch = line.match(
          /(?:requires|minimum|needs|min|memory\s+is|ram\s+is|memory:?|ram:?)\s*(?:at\s+least)?\s*(\d+(?:\.\d+)?\s*(?:gb|mb|tb|kb|g|m|b))\s*(?:of\s+)?(?:ram|memory)?/i,
        );
        if (proseRamMatch) {
          key = 'min_memory';
          val = proseRamMatch[1].trim();
          method = 'prose_heuristic';
        } else {
          const prosePortMatch = line.match(
            /(?:runs|listens|hosted|serves|serving|started)\s+(?:on|at)\s+(?:http\s+)?port\s+(\d{2,5})/i,
          );
          if (prosePortMatch) {
            key = 'port';
            val = prosePortMatch[1].trim();
            method = 'prose_heuristic';
          } else {
            const proseNodeMatch = line.match(
              /(?:requires|using|uses|built\s+with|runtime\s+is)?\s*(?:node|node\.js|nodejs)\s+(?:version\s+)?([v=~^><\d.]+)/i,
            );
            if (proseNodeMatch) {
              key = 'node_version';
              val = proseNodeMatch[1].trim();
              method = 'prose_heuristic';
            } else {
              const prosePyMatch = line.match(
                /(?:requires|using|uses)?\s*(?:python|python3)\s+(?:version\s+)?([v=~^><\d.]+)/i,
              );
              if (prosePyMatch) {
                key = 'python_version';
                val = prosePyMatch[1].trim();
                method = 'prose_heuristic';
              } else {
                const proseDbMatch = line.match(
                  /(?:database|db|datastore)\s+(?:is|engine\s+is|backend\s+is|type\s+is|using|uses)\s+(postgres|postgresql|mysql|sqlite|redis|mongodb|mariadb)/i,
                );
                if (proseDbMatch) {
                  key = 'db_engine';
                  val = proseDbMatch[1].trim();
                  method = 'prose_heuristic';
                } else {
                  const proseTimeoutMatch = line.match(
                    /(?:timeout|deadline)\s+(?:is|of|set\s+to)\s*(\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds|m|min|minutes))/i,
                  );
                  if (proseTimeoutMatch) {
                    key = 'timeout';
                    val = proseTimeoutMatch[1].trim();
                    method = 'prose_heuristic';
                  } else {
                    const proseCapacityMatch = line.match(
                      /(?:max|maximum|limit|capacity\s+of)\s*(\d+)\s*(?:concurrent\s+)?(?:users|connections|clients|workers)/i,
                    );
                    if (proseCapacityMatch) {
                      key = 'max_users';
                      val = proseCapacityMatch[1].trim();
                      method = 'prose_heuristic';
                    } else {
                      const proseLicenseMatch = line.match(
                        /(?:licensed?\s+under|license:?)\s*(?:the\s+)?(MIT|Apache(?:-2\.0)?|BSD|GPL|ISC|Proprietary)\b/i,
                      );
                      if (proseLicenseMatch) {
                        key = 'license';
                        val = proseLicenseMatch[1].trim();
                        method = 'prose_heuristic';
                      } else {
                        const proseCommercialMatch = line.match(
                          /(?:commercial\s+use\s+(?:is\s+)?(strictly\s+prohibited|forbidden|prohibited|not\s+allowed|allowed|permitted))/i,
                        );
                        if (proseCommercialMatch) {
                          key = 'commercial_use';
                          val = /prohibited|forbidden|not/i.test(proseCommercialMatch[1])
                            ? 'prohibited'
                            : 'allowed';
                          method = 'prose_heuristic';
                        } else {
                          const proseZeroConfigMatch = line.match(
                            /\b(zero[- ]configuration|no\s+configuration\s+required)\b/i,
                          );
                          if (proseZeroConfigMatch) {
                            key = 'configuration_required';
                            val = 'false';
                            method = 'prose_heuristic';
                          } else {
                            const proseReqConfigMatch = line.match(
                              /requires\s+(\d+)\s+(?:yaml|configuration|config)\s+files/i,
                            );
                            if (proseReqConfigMatch) {
                              key = 'configuration_files_count';
                              val = proseReqConfigMatch[1].trim();
                              method = 'prose_heuristic';
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (key && val && key.length > 2 && val.length > 0 && !val.startsWith('http')) {
        let finalKey = key;
        if (currentSection && !key.startsWith(currentSection)) {
          finalKey = `${currentSection}_${key}`;
        }
        const externalId = createClaimExternalId('document', filePath, finalKey, String(i + 1));
        const valueType = inferClaimValueType(finalKey, val);

        claims.push({
          subject: subjectBase,
          predicate: finalKey,
          value: val,
          valueType,
          environment: env,
          scope,
          sourceRole,
          isHistorical: false,
          observedAt,
          externalId,
          provenance: {
            connector: 'document',
            filePath,
            lineRange: [i + 1, i + 1],
            extractionMethod: method,
            observedAt: observedAt.toISOString(),
            evidence: line.trim(),
          },
        });
      }
    }
  }

  private extractFromPdf(
    rawData: DocumentRawData,
    filePath: string,
    subjectBase: string,
    env: string,
    scope: string,
    sourceRole: string,
    claims: ExtractedClaim[],
    fileMtime?: Date,
  ): void {
    if (!rawData.pdfPages || rawData.pdfPages.length === 0) {
      this.extractFromMarkdownOrText(
        rawData.lines,
        filePath,
        subjectBase,
        env,
        scope,
        sourceRole,
        claims,
        fileMtime,
      );
      return;
    }

    const pattern = /^([a-zA-Z0-9_\s-]+)[:=]\s*(.+)$/;

    for (const page of rawData.pdfPages) {
      for (let i = 0; i < page.lines.length; i++) {
        const line = page.lines[i];
        if (!line || line.trim().startsWith('#')) continue;

        const match = pattern.exec(line.trim());
        if (match) {
          const key = match[1]
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_');
          const val = match[2].trim().replace(/^["'`]|["'`]$/g, '');

          if (key.length > 2 && val.length > 0 && !val.startsWith('http')) {
            const externalId = createClaimExternalId(
              'document',
              filePath,
              key,
              `p${page.pageNumber}_l${i + 1}`,
            );
            const valueType = inferClaimValueType(key, val);

            claims.push({
              subject: subjectBase,
              predicate: key,
              value: val,
              valueType,
              environment: env as ClaimEnvironment,
              scope: scope as ClaimScope,
              sourceRole: sourceRole as ClaimSourceRole,
              isHistorical: false,
              observedAt: fileMtime || new Date(),
              externalId,
              provenance: {
                connector: 'document',
                filePath,
                page: page.pageNumber,
                lineRange: [i + 1, i + 1],
                extractionMethod: 'pdf_extractor',
                observedAt: (fileMtime || new Date()).toISOString(),
                evidence: line.trim(),
              },
            });
          }
        }
      }
    }
  }
}
