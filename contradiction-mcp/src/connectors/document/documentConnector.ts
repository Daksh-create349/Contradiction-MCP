import fs from 'node:fs';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { Connector, ConnectorMetadata, ConnectionTestResult } from '../types/connector.js';
import { FetchResult, ExtractedClaim } from '../types/fetchResult.js';
import { ValidationError, NotFoundError } from '../../domain/types/common.js';
import type { ClaimEnvironment, ClaimScope, ClaimSourceRole } from '../../domain/entities/claim.js';
import { DEFAULT_READ_ONLY_SECURITY, ConnectorSecurityDescriptor } from '../base/security.js';
import { createClaimExternalId } from '../base/connectorUtils.js';
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
      supportedFileTypes: ['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.pdf'],
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
    const subjectBase = (metadata.subject as string) || path.basename(filePath, fileExtension);
    const defaultScope = (metadata.scope as string) || 'file';
    const defaultEnv = (metadata.environment as string) || 'unknown';
    const defaultRole =
      (metadata.sourceRole as string) ||
      (fileExtension === '.json' || fileExtension === '.yaml' || fileExtension === '.yml'
        ? 'configuration'
        : 'documentation');

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
        );
        break;
      case '.md':
      case '.txt':
      default:
        this.extractFromMarkdownOrText(
          lines,
          filePath,
          subjectBase,
          defaultEnv,
          defaultScope,
          defaultRole,
          claims,
        );
        break;
    }

    logger.debug('Extracted claims from document', {
      filePath,
      claimsCount: claims.length,
    });

    return claims;
  }

  private extractFromJson(
    content: string,
    filePath: string,
    subjectBase: string,
    env: string,
    scope: string,
    sourceRole: string,
    claims: ExtractedClaim[],
  ): void {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) return;

      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          const predicate = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          const valueStr = String(val);
          const externalId = createClaimExternalId('document', filePath, predicate);

          claims.push({
            subject: subjectBase,
            predicate,
            value: valueStr,
            valueType:
              typeof val === 'number'
                ? 'quantity'
                : typeof val === 'boolean'
                  ? 'status'
                  : 'configuration',
            environment: env,
            scope,
            sourceRole,
            isHistorical: false,
            observedAt: new Date(),
            externalId,
            provenance: {
              connector: 'document',
              filePath,
              extractionMethod: 'json_parse',
              observedAt: new Date().toISOString(),
              evidence: `"${key}": ${JSON.stringify(val)}`,
            },
          });
        }
      }
    } catch {
      // If JSON parse fails, fallback to line extraction
    }
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
          const externalId = createClaimExternalId('document', filePath, predicate);

          claims.push({
            subject: subjectBase,
            predicate,
            value: rawVal,
            valueType: 'configuration',
            environment: env,
            scope,
            sourceRole,
            isHistorical: false,
            observedAt: new Date(),
            externalId,
            provenance: {
              connector: 'document',
              filePath,
              lineRange: [i + 1, i + 1],
              extractionMethod: method,
              observedAt: new Date().toISOString(),
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

          claims.push({
            subject: rowSubject,
            predicate,
            value: val,
            valueType: !isNaN(Number(val)) ? 'quantity' : 'configuration',
            environment: env,
            scope,
            sourceRole,
            isHistorical: false,
            observedAt: new Date(),
            externalId,
            provenance: {
              connector: 'document',
              filePath,
              lineRange: [i + 1, i + 1],
              extractionMethod: 'csv_parse',
              observedAt: new Date().toISOString(),
              evidence: `${header}: ${val}`,
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
  ): void {
    // Matches patterns like:
    // - Node: 20
    // - **Node.js**: v18.12.0
    // - port = 8080
    // - `version`: 1.2.3
    const mdPattern =
      /(?:^|\s)(?:[-*]|\d+\.)?\s*(?:\*{1,2}|`|__)?([a-zA-Z0-9_\s.-]{2,30}?)(?:\*{1,2}|`|__)?\s*[:=]\s*(?:\*{1,2}|`|__)?([a-zA-Z0-9_./@~^><=-]{1,40})(?:\*{1,2}|`|__)?(?:\s|$)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = mdPattern.exec(line);
      if (match) {
        const key = match[1]
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_');
        const val = match[2].trim();

        // Skip markdown links or noisy words
        if (key.length > 2 && val.length > 0 && !val.startsWith('http')) {
          const externalId = createClaimExternalId('document', filePath, key);

          claims.push({
            subject: subjectBase,
            predicate: key,
            value: val,
            valueType: key.includes('version')
              ? 'version'
              : key.includes('port')
                ? 'quantity'
                : 'configuration',
            environment: env,
            scope,
            sourceRole,
            isHistorical: false,
            observedAt: new Date(),
            externalId,
            provenance: {
              connector: 'document',
              filePath,
              lineRange: [i + 1, i + 1],
              extractionMethod: 'markdown_pattern',
              observedAt: new Date().toISOString(),
              evidence: line.trim(),
            },
          });
        }
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
              `p${page.pageNumber}`,
            );

            claims.push({
              subject: subjectBase,
              predicate: key,
              value: val,
              valueType: key.includes('version')
                ? 'version'
                : key.includes('port')
                  ? 'quantity'
                  : 'configuration',
              environment: env as ClaimEnvironment,
              scope: scope as ClaimScope,
              sourceRole: sourceRole as ClaimSourceRole,
              isHistorical: false,
              observedAt: new Date(),
              externalId,
              provenance: {
                connector: 'document',
                filePath,
                page: page.pageNumber,
                lineRange: [i + 1, i + 1],
                extractionMethod: 'pdf_extractor',
                observedAt: new Date().toISOString(),
                evidence: line.trim(),
              },
            });
          }
        }
      }
    }
  }
}
