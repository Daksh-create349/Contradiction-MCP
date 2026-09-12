import { describe, it, expect } from 'vitest';
import { GitHubExtractor } from '../src/connectors/github/githubExtractor.js';
import { GitHubNormalizer } from '../src/connectors/github/githubNormalizer.js';
import { GitHubRepoInfo, GitHubFilePayload } from '../src/connectors/github/githubTypes.js';

describe('GitHubExtractor & GitHubNormalizer', () => {
  const extractor = new GitHubExtractor();
  const normalizer = new GitHubNormalizer();

  const repoInfo: GitHubRepoInfo = {
    owner: 'test-org',
    repo: 'sample-app',
    fullName: 'test-org/sample-app',
    defaultBranch: 'main',
    htmlUrl: 'https://github.com/test-org/sample-app',
    description: 'Sample test application',
  };
  const sourceExternalId = 'github:test-org/sample-app';

  it('extracts node and npm versions, dependencies, and start port from package.json', () => {
    const pkgContent = JSON.stringify(
      {
        name: 'sample-app',
        engines: {
          node: '>=20.0.0',
          npm: '10.2.0',
        },
        dependencies: {
          react: '^18.2.0',
          express: '4.19.2',
        },
        scripts: {
          start: 'node index.js --port 8080',
        },
      },
      null,
      2,
    );

    const file: GitHubFilePayload = {
      path: 'package.json',
      content: pkgContent,
      url: 'https://github.com/test-org/sample-app/blob/main/package.json',
      sha: 'sha-pkg-1',
      size: pkgContent.length,
    };

    const rawClaims = extractor.extractClaims(repoInfo, sourceExternalId, [file]);
    const normalized = normalizer.normalizeClaims(rawClaims);

    expect(normalized).toHaveLength(5); // node, npm, react, express, port

    const nodeClaim = normalized.find((c) => c.predicate === 'node_version');
    expect(nodeClaim).toBeDefined();
    expect(nodeClaim?.value).toBe('>=20.0.0');
    expect(nodeClaim?.normalizedValue).toBe('20.0.0');
    expect(nodeClaim?.valueType).toBe('version');
    expect(nodeClaim?.externalId).toBe('github:test-org/sample-app:package.json:node_version');
    expect(nodeClaim?.provenance.connector).toBe('github');
    expect(nodeClaim?.provenance.filePath).toBe('package.json');
    expect(nodeClaim?.provenance.extractionMethod).toBe('package-engines');
    expect(nodeClaim?.provenance.evidence).toContain('"node"');

    const portClaim = normalized.find((c) => c.predicate === 'port');
    expect(portClaim).toBeDefined();
    expect(portClaim?.value).toBe('8080');
    expect(portClaim?.normalizedValue).toBe('8080');
    expect(portClaim?.valueType).toBe('quantity');
  });

  it('extracts base image version and EXPOSE port from Dockerfile', () => {
    const dockerContent = `
      FROM node:18-alpine AS builder
      WORKDIR /app
      COPY . .
      RUN npm install
      EXPOSE 3000
      CMD ["npm", "start"]
    `.trim();

    const file: GitHubFilePayload = {
      path: 'Dockerfile',
      content: dockerContent,
      url: 'https://github.com/test-org/sample-app/blob/main/Dockerfile',
      sha: 'sha-docker-1',
      size: dockerContent.length,
    };

    const rawClaims = extractor.extractClaims(repoInfo, sourceExternalId, [file]);
    const normalized = normalizer.normalizeClaims(rawClaims);

    expect(normalized).toHaveLength(2); // node_version and port

    const nodeClaim = normalized.find((c) => c.predicate === 'node_version');
    expect(nodeClaim).toBeDefined();
    expect(nodeClaim?.value).toBe('18');
    expect(nodeClaim?.normalizedValue).toBe('18');
    expect(nodeClaim?.provenance.extractionMethod).toBe('dockerfile-base-image');

    const portClaim = normalized.find((c) => c.predicate === 'port');
    expect(portClaim).toBeDefined();
    expect(portClaim?.value).toBe('3000');
    expect(portClaim?.normalizedValue).toBe('3000');
    expect(portClaim?.provenance.extractionMethod).toBe('dockerfile-expose-port');
  });

  it('extracts runtime and port statements from README.md', () => {
    const readmeContent = `
      # Sample App
      This project requires Node.js 22 to run properly.
      The development server is running on port 5432 by default.
    `.trim();

    const file: GitHubFilePayload = {
      path: 'README.md',
      content: readmeContent,
      url: 'https://github.com/test-org/sample-app/blob/main/README.md',
      sha: 'sha-readme-1',
      size: readmeContent.length,
    };

    const rawClaims = extractor.extractClaims(repoInfo, sourceExternalId, [file]);
    const normalized = normalizer.normalizeClaims(rawClaims);

    expect(normalized).toHaveLength(2);

    const nodeClaim = normalized.find((c) => c.predicate === 'node_version');
    expect(nodeClaim).toBeDefined();
    expect(nodeClaim?.value).toBe('22');
    expect(nodeClaim?.normalizedValue).toBe('22');
    expect(nodeClaim?.provenance.extractionMethod).toBe('readme-node-version-pattern');

    const portClaim = normalized.find((c) => c.predicate === 'port');
    expect(portClaim).toBeDefined();
    expect(portClaim?.value).toBe('5432');
    expect(portClaim?.normalizedValue).toBe('5432');
  });

  it('extracts node versions from GitHub Actions workflow', () => {
    const workflowContent = `
      name: CI
      on: [push]
      jobs:
        build:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v4
            - name: Setup Node
              uses: actions/setup-node@v4
              with:
                node-version: [ 20.x, 22.x ]
    `.trim();

    const file: GitHubFilePayload = {
      path: '.github/workflows/ci.yml',
      content: workflowContent,
      url: 'https://github.com/test-org/sample-app/blob/main/.github/workflows/ci.yml',
      sha: 'sha-wf-1',
      size: workflowContent.length,
    };

    const rawClaims = extractor.extractClaims(repoInfo, sourceExternalId, [file]);
    const normalized = normalizer.normalizeClaims(rawClaims);

    expect(normalized.length).toBeGreaterThanOrEqual(2);

    const nodeClaims = normalized.filter((c) => c.predicate === 'node_version');
    expect(nodeClaims.map((c) => c.value)).toEqual(expect.arrayContaining(['20', '22']));

    const runnerClaim = normalized.find((c) => c.predicate === 'ci_runner_os');
    expect(runnerClaim).toBeDefined();
    expect(runnerClaim?.value).toBe('ubuntu-latest');
  });

  it('generates consistent externalIds across multiple extractions', () => {
    const file: GitHubFilePayload = {
      path: 'package.json',
      content: JSON.stringify({ engines: { node: '20' } }),
      url: 'https://github.com/test-org/sample-app/blob/main/package.json',
      sha: '1',
      size: 50,
    };

    const run1 = extractor.extractClaims(repoInfo, sourceExternalId, [file]);
    const run2 = extractor.extractClaims(repoInfo, sourceExternalId, [file]);

    expect(run1[0].externalId).toBe(run2[0].externalId);
    expect(run1[0].externalId).toBe('github:test-org/sample-app:package.json:node_version');
  });
});
