import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DocumentConnector } from '../src/connectors/document/documentConnector.js';

describe('DocumentConnector Tests', () => {
  let connector: DocumentConnector;
  let tempDir: string;

  beforeEach(() => {
    connector = new DocumentConnector();
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'contra-doc-test-')));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('tests connection to valid and invalid files', async () => {
    const validFile = path.join(tempDir, 'valid.txt');
    fs.writeFileSync(validFile, 'hello: world');

    const validRes = await connector.testConnection({ filePath: validFile });
    expect(validRes.accessible).toBe(true);
    expect(validRes.targetFound).toBe(true);

    const invalidRes = await connector.testConnection({
      filePath: path.join(tempDir, 'missing.txt'),
    });
    expect(invalidRes.accessible).toBe(false);
    expect(invalidRes.targetFound).toBe(false);
  });

  it('extracts factual claims from a Markdown file with line provenance', async () => {
    const mdPath = path.join(tempDir, 'README.md');
    fs.writeFileSync(
      mdPath,
      `# System Architecture
Node: 22
Port: 8080
**Environment**: production
`,
    );

    const fetchResult = await connector.fetch({ filePath: mdPath });
    expect(fetchResult.rawData.lines.length).toBeGreaterThanOrEqual(4);

    const claims = await connector.extractClaims(fetchResult);
    expect(claims.length).toBeGreaterThanOrEqual(2);

    const nodeClaim = claims.find((c) => c.predicate === 'node');
    expect(nodeClaim).toBeDefined();
    expect(nodeClaim?.value).toBe('22');
    expect(nodeClaim?.provenance.filePath).toBe(mdPath);
    expect(nodeClaim?.provenance.lineRange).toBeDefined();
  });

  it('extracts factual claims from a JSON file', async () => {
    const jsonPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        server_port: 3000,
        version: '1.4.2',
        debug_mode: false,
      }),
    );

    const fetchResult = await connector.fetch({ filePath: jsonPath });
    const claims = await connector.extractClaims(fetchResult);

    expect(claims.length).toBe(3);
    const portClaim = claims.find((c) => c.predicate === 'server_port');
    expect(portClaim?.value).toBe('3000');
    expect(portClaim?.valueType).toBe('quantity');

    const versionClaim = claims.find((c) => c.predicate === 'version');
    expect(versionClaim?.value).toBe('1.4.2');
  });

  it('extracts factual claims from a YAML file', async () => {
    const yamlPath = path.join(tempDir, 'config.yaml');
    fs.writeFileSync(
      yamlPath,
      `runtime: nodejs22
database_host: db.internal.net
max_connections: 100
`,
    );

    const fetchResult = await connector.fetch({ filePath: yamlPath });
    const claims = await connector.extractClaims(fetchResult);

    expect(claims.length).toBe(3);
    const runtimeClaim = claims.find((c) => c.predicate === 'runtime');
    expect(runtimeClaim?.value).toBe('nodejs22');
  });

  it('extracts structured rows from a CSV file', async () => {
    const csvPath = path.join(tempDir, 'services.csv');
    fs.writeFileSync(
      csvPath,
      `service,port,protocol
gateway,443,https
auth,8081,http
`,
    );

    const fetchResult = await connector.fetch({ filePath: csvPath });
    const claims = await connector.extractClaims(fetchResult);

    expect(claims.length).toBe(4);
    const gwPort = claims.find((c) => c.subject === 'gateway' && c.predicate === 'port');
    expect(gwPort?.value).toBe('443');
  });

  it('extracts factual claims from a binary PDF with page-numbered provenance', async () => {
    const pdfPath = path.join(tempDir, 'architecture.pdf');
    const minimalPdf = Buffer.from(
      '%PDF-1.4\n' +
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
        '4 0 obj << /Length 44 >> stream\n' +
        'BT\n' +
        '/F1 12 Tf\n' +
        '72 712 Td\n' +
        '(runtime: nodejs22)\n' +
        'Tj\n' +
        'ET\n' +
        'endstream\n' +
        'endobj\n' +
        '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
        'xref\n' +
        '0 6\n' +
        '0000000000 65535 f \n' +
        '0000000010 00000 n \n' +
        '0000000060 00000 n \n' +
        '0000000117 00000 n \n' +
        '0000000238 00000 n \n' +
        '0000000331 00000 n \n' +
        'trailer << /Size 6 /Root 1 0 R >>\n' +
        'startxref\n' +
        '408\n' +
        '%%EOF',
    );
    fs.writeFileSync(pdfPath, minimalPdf);

    const fetchResult = await connector.fetch({ filePath: pdfPath });
    expect(fetchResult.rawData.pdfPages).toBeDefined();
    expect(fetchResult.rawData.pdfPages?.length).toBe(1);

    const claims = await connector.extractClaims(fetchResult);
    expect(claims.length).toBeGreaterThanOrEqual(1);

    const runtimeClaim = claims.find((c) => c.predicate === 'runtime');
    expect(runtimeClaim).toBeDefined();
    expect(runtimeClaim?.value).toBe('nodejs22');
    expect(runtimeClaim?.provenance.filePath).toBe(pdfPath);
    expect(runtimeClaim?.provenance.page).toBe(1);
    expect(runtimeClaim?.provenance.extractionMethod).toBe('pdf_extractor');
  });

  it('enforces document root containment and rejects path traversal', async () => {
    const containedDir = path.join(tempDir, 'allowed_docs');
    fs.mkdirSync(containedDir);
    const outsideFile = path.join(tempDir, 'secret.txt');
    fs.writeFileSync(outsideFile, 'secret_token: supersecret');

    const restrictedConnector = new DocumentConnector({
      allowedRoots: [containedDir],
    });

    await expect(restrictedConnector.fetch({ filePath: outsideFile })).rejects.toThrow(
      /Access denied.*outside allowed document directories/,
    );

    const insideFile = path.join(containedDir, 'public.txt');
    fs.writeFileSync(insideFile, 'service_port: 8080');

    const result = await restrictedConnector.fetch({ filePath: insideFile });
    expect(result.sourceName).toBe('public.txt');
  });
});
