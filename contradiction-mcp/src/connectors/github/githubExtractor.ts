import { GitHubFilePayload, GitHubRepoInfo } from './githubTypes.js';
import { ExtractedClaim } from '../types/fetchResult.js';
import { createClaimExternalId, sanitizeSecrets } from '../base/connectorUtils.js';

export class GitHubExtractor {
  /**
   * Extracts factual claims from a set of repository files.
   */
  public extractClaims(
    repo: GitHubRepoInfo,
    sourceExternalId: string,
    files: GitHubFilePayload[],
  ): ExtractedClaim[] {
    const claims: ExtractedClaim[] = [];
    const subject = repo.fullName; // Canonical subject: "owner/repo"

    for (const file of files) {
      const lowerPath = file.path.toLowerCase();

      if (lowerPath === 'package.json' || lowerPath.endsWith('/package.json')) {
        claims.push(...this.extractFromPackageJson(repo, sourceExternalId, subject, file));
      } else if (
        lowerPath === 'dockerfile' ||
        lowerPath.endsWith('/dockerfile') ||
        lowerPath.includes('dockerfile.')
      ) {
        claims.push(...this.extractFromDockerfile(repo, sourceExternalId, subject, file));
      } else if (
        lowerPath === 'readme.md' ||
        lowerPath.endsWith('/readme.md') ||
        lowerPath === 'readme'
      ) {
        claims.push(...this.extractFromReadme(repo, sourceExternalId, subject, file));
      } else if (
        lowerPath.startsWith('.github/workflows/') &&
        (lowerPath.endsWith('.yml') || lowerPath.endsWith('.yaml'))
      ) {
        claims.push(...this.extractFromWorkflow(repo, sourceExternalId, subject, file));
      }
    }

    return claims;
  }

  /**
   * Extracts factual claims from package.json.
   */
  private extractFromPackageJson(
    repo: GitHubRepoInfo,
    sourceExternalId: string,
    subject: string,
    file: GitHubFilePayload,
  ): ExtractedClaim[] {
    const claims: ExtractedClaim[] = [];

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(file.content) as Record<string, unknown>;
    } catch {
      return claims;
    }

    const lines = file.content.split('\n');

    // 1. Engines (node, npm, pnpm, yarn)
    if (pkg.engines && typeof pkg.engines === 'object') {
      const engines = pkg.engines as Record<string, unknown>;

      for (const [engineName, engineVal] of Object.entries(engines)) {
        if (typeof engineVal === 'string' && engineVal.trim()) {
          const predicate = `${engineName.toLowerCase()}_version`;
          const lineNum = this.findLineNumber(lines, `"${engineName}"`);
          const evidence = this.extractEvidence(lines, lineNum);
          const rawVal = engineVal.trim();
          const isRange = /[><=~^\s*|]/.test(rawVal);

          claims.push({
            subject,
            predicate,
            value: rawVal,
            valueType: 'version',
            confidence: 0.95,
            environment: 'production',
            scope: 'package',
            sourceRole: 'configuration',
            isHistorical: false,
            valueConstraint: isRange ? rawVal : null,
            externalId: createClaimExternalId(sourceExternalId, file.path, predicate),
            provenance: {
              connector: 'github',
              repository: repo.fullName,
              filePath: file.path,
              url: file.url,
              extractionMethod: 'package-engines',
              lineRange: lineNum > 0 ? [lineNum, lineNum] : undefined,
              observedAt: new Date().toISOString(),
              evidence,
            },
          });
        }
      }
    }

    // 2. High-value dependencies
    const highValueDeps = [
      { name: 'typescript', predicate: 'typescript_version' },
      { name: 'react', predicate: 'react_version' },
      { name: 'next', predicate: 'next_version' },
      { name: 'express', predicate: 'express_version' },
      { name: '@modelcontextprotocol/sdk', predicate: 'mcp_sdk_version' },
    ];

    const prodDeps = (pkg.dependencies as Record<string, unknown>) || {};
    const devDeps = (pkg.devDependencies as Record<string, unknown>) || {};

    for (const dep of highValueDeps) {
      const isDev = dep.name in devDeps;
      const versionVal = prodDeps[dep.name] ?? devDeps[dep.name];
      if (typeof versionVal === 'string' && versionVal.trim()) {
        const lineNum = this.findLineNumber(lines, `"${dep.name}"`);
        const evidence = this.extractEvidence(lines, lineNum);
        const rawVal = versionVal.trim();
        const isRange = /[><=~^\s*|]/.test(rawVal);

        claims.push({
          subject,
          predicate: dep.predicate,
          value: rawVal,
          valueType: 'version',
          confidence: 0.9,
          environment: isDev ? 'development' : 'production',
          scope: 'package',
          sourceRole: 'configuration',
          isHistorical: false,
          valueConstraint: isRange ? rawVal : null,
          externalId: createClaimExternalId(sourceExternalId, file.path, dep.predicate),
          provenance: {
            connector: 'github',
            repository: repo.fullName,
            filePath: file.path,
            url: file.url,
            extractionMethod: 'package-dependency',
            lineRange: lineNum > 0 ? [lineNum, lineNum] : undefined,
            observedAt: new Date().toISOString(),
            evidence,
          },
        });
      }
    }

    // 3. Scripts port specification
    if (pkg.scripts && typeof pkg.scripts === 'object') {
      const scripts = pkg.scripts as Record<string, unknown>;
      for (const [scriptName, scriptVal] of Object.entries(scripts)) {
        if (typeof scriptVal === 'string') {
          const portMatch = scriptVal.match(/(?:--port\s+|PORT=)(\d{2,5})/i);
          if (portMatch) {
            const lineNum = this.findLineNumber(lines, `"${scriptName}"`);
            const evidence = this.extractEvidence(lines, lineNum);
            const isDev =
              scriptName.toLowerCase().includes('dev') || scriptName.toLowerCase().includes('test');
            claims.push({
              subject,
              predicate: 'port',
              value: portMatch[1],
              valueType: 'quantity',
              confidence: 0.85,
              environment: isDev ? 'development' : 'production',
              scope: 'service',
              sourceRole: 'configuration',
              isHistorical: false,
              externalId: createClaimExternalId(sourceExternalId, file.path, 'port', scriptName),
              provenance: {
                connector: 'github',
                repository: repo.fullName,
                filePath: file.path,
                url: file.url,
                extractionMethod: 'package-script-port',
                lineRange: lineNum > 0 ? [lineNum, lineNum] : undefined,
                observedAt: new Date().toISOString(),
                evidence,
              },
            });
          }
        }
      }
    }

    return claims;
  }

  /**
   * Extracts factual claims from Dockerfile.
   */
  private extractFromDockerfile(
    repo: GitHubRepoInfo,
    sourceExternalId: string,
    subject: string,
    file: GitHubFilePayload,
  ): ExtractedClaim[] {
    const claims: ExtractedClaim[] = [];
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      // 1. FROM instruction
      const fromMatch = line.match(
        /^FROM\s+(?:--platform=\S+\s+)?([a-zA-Z0-9_./-]+)(?::([a-zA-Z0-9_.-]+))?/i,
      );
      if (fromMatch) {
        const image = fromMatch[1].toLowerCase();
        const tag = fromMatch[2];

        if (image.includes('node') && tag) {
          const versionOnly = tag.split('-')[0]; // e.g. 20-alpine -> 20
          claims.push({
            subject,
            predicate: 'node_version',
            value: versionOnly,
            valueType: 'version',
            confidence: 0.9,
            environment: 'deployment',
            scope: 'service',
            sourceRole: 'configuration',
            isHistorical: false,
            externalId: createClaimExternalId(sourceExternalId, file.path, 'node_version'),
            provenance: {
              connector: 'github',
              repository: repo.fullName,
              filePath: file.path,
              url: file.url,
              extractionMethod: 'dockerfile-base-image',
              lineRange: [lineNum, lineNum],
              observedAt: new Date().toISOString(),
              evidence: line,
            },
          });
        } else if (image.includes('python') && tag) {
          const versionOnly = tag.split('-')[0];
          claims.push({
            subject,
            predicate: 'python_version',
            value: versionOnly,
            valueType: 'version',
            confidence: 0.9,
            environment: 'deployment',
            scope: 'service',
            sourceRole: 'configuration',
            isHistorical: false,
            externalId: createClaimExternalId(sourceExternalId, file.path, 'python_version'),
            provenance: {
              connector: 'github',
              repository: repo.fullName,
              filePath: file.path,
              url: file.url,
              extractionMethod: 'dockerfile-base-image',
              lineRange: [lineNum, lineNum],
              observedAt: new Date().toISOString(),
              evidence: line,
            },
          });
        } else if (image.includes('postgres') && tag) {
          const versionOnly = tag.split('-')[0];
          claims.push({
            subject,
            predicate: 'postgres_version',
            value: versionOnly,
            valueType: 'version',
            confidence: 0.9,
            environment: 'deployment',
            scope: 'service',
            sourceRole: 'configuration',
            isHistorical: false,
            externalId: createClaimExternalId(sourceExternalId, file.path, 'postgres_version'),
            provenance: {
              connector: 'github',
              repository: repo.fullName,
              filePath: file.path,
              url: file.url,
              extractionMethod: 'dockerfile-base-image',
              lineRange: [lineNum, lineNum],
              observedAt: new Date().toISOString(),
              evidence: line,
            },
          });
        }
      }

      // 2. EXPOSE instruction
      const exposeMatch = line.match(/^EXPOSE\s+(\d{2,5})/i);
      if (exposeMatch) {
        claims.push({
          subject,
          predicate: 'port',
          value: exposeMatch[1],
          valueType: 'quantity',
          confidence: 0.9,
          environment: 'deployment',
          scope: 'service',
          sourceRole: 'configuration',
          isHistorical: false,
          externalId: createClaimExternalId(sourceExternalId, file.path, 'port', exposeMatch[1]),
          provenance: {
            connector: 'github',
            repository: repo.fullName,
            filePath: file.path,
            url: file.url,
            extractionMethod: 'dockerfile-expose-port',
            lineRange: [lineNum, lineNum],
            observedAt: new Date().toISOString(),
            evidence: line,
          },
        });
      }
    }

    return claims;
  }

  /**
   * Extracts factual claims from README.md.
   */
  private extractFromReadme(
    repo: GitHubRepoInfo,
    sourceExternalId: string,
    subject: string,
    file: GitHubFilePayload,
  ): ExtractedClaim[] {
    const claims: ExtractedClaim[] = [];
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const lower = line.toLowerCase();
      const isHistorical =
        /(?:previously|deprecated|former|legacy|dropped\s+support|used\s+to)/i.test(lower);
      const isExample = /(?:for\s+example|e\.g\.|sample|tutorial|docker\s+run)/i.test(lower);
      const sourceRole = isExample ? 'example' : isHistorical ? 'historical' : 'documentation';

      // 1. Node version pattern
      const nodeMatch = line.match(
        /(?:(?:requires?|prerequisites?|built with|runs on)\s+)?node(?:\.js)?\s*(?:version)?\s*[:=~^>=<]*\s*([vV]?\d+(?:\.\d+)*)/i,
      );
      if (nodeMatch && !lower.includes('npm')) {
        const rawVersion = nodeMatch[1];
        if (rawVersion !== '0' && !rawVersion.startsWith('202') && !rawVersion.startsWith('199')) {
          const isRange = /[><=~^\s*|]/.test(line);
          claims.push({
            subject,
            predicate: 'node_version',
            value: rawVersion,
            valueType: 'version',
            confidence: 0.8,
            environment: 'documentation',
            scope: 'repository',
            sourceRole,
            isHistorical,
            valueConstraint: isRange ? line.trim().slice(0, 50) : null,
            externalId: createClaimExternalId(
              sourceExternalId,
              file.path,
              'node_version',
              isHistorical ? 'historical' : undefined,
            ),
            provenance: {
              connector: 'github',
              repository: repo.fullName,
              filePath: file.path,
              url: file.url,
              extractionMethod: 'readme-node-version-pattern',
              lineRange: [lineNum, lineNum],
              observedAt: new Date().toISOString(),
              evidence: line.trim().slice(0, 160),
            },
          });
        }
      }

      // 2. Port pattern
      const portMatch = line.match(
        /(?:default\s+port|(?:runs?|running|listening|server)\s+(?:on\s+)?port|port\s*:)\s*[:=]?\s*(\d{2,5})\b/i,
      );
      if (portMatch) {
        claims.push({
          subject,
          predicate: 'port',
          value: portMatch[1],
          valueType: 'quantity',
          confidence: 0.8,
          environment: 'documentation',
          scope: 'repository',
          sourceRole,
          isHistorical,
          externalId: createClaimExternalId(sourceExternalId, file.path, 'port', portMatch[1]),
          provenance: {
            connector: 'github',
            repository: repo.fullName,
            filePath: file.path,
            url: file.url,
            extractionMethod: 'readme-port-pattern',
            lineRange: [lineNum, lineNum],
            observedAt: new Date().toISOString(),
            evidence: line.trim().slice(0, 160),
          },
        });
      }
    }

    return claims;
  }

  /**
   * Extracts factual claims from GitHub Actions workflow files.
   */
  private extractFromWorkflow(
    repo: GitHubRepoInfo,
    sourceExternalId: string,
    subject: string,
    file: GitHubFilePayload,
  ): ExtractedClaim[] {
    const claims: ExtractedClaim[] = [];
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // 1. Node version in setup-node step or matrix
      const nodeVersionMatch = line.match(/node-version:\s*(?:\[([^\]]+)\]|['"]?([0-9.x]+)['"]?)/i);
      if (nodeVersionMatch) {
        if (nodeVersionMatch[2]) {
          const version = nodeVersionMatch[2].replace(/\.x$/, '');
          claims.push({
            subject,
            predicate: 'node_version',
            value: version,
            valueType: 'version',
            confidence: 0.9,
            environment: 'ci',
            scope: 'workflow',
            sourceRole: 'configuration',
            isHistorical: false,
            multiValueContext: 'ci_step',
            externalId: createClaimExternalId(sourceExternalId, file.path, 'node_version', version),
            provenance: {
              connector: 'github',
              repository: repo.fullName,
              filePath: file.path,
              url: file.url,
              extractionMethod: 'github-workflow-node-version',
              lineRange: [lineNum, lineNum],
              observedAt: new Date().toISOString(),
              evidence: line.trim().slice(0, 160),
            },
          });
        } else if (nodeVersionMatch[1]) {
          const items = nodeVersionMatch[1]
            .split(',')
            .map((s) => s.trim().replace(/['"]/g, '').replace(/\.x$/, ''));
          for (const item of items) {
            if (item) {
              claims.push({
                subject,
                predicate: 'node_version',
                value: item,
                valueType: 'version',
                confidence: 0.9,
                environment: 'ci',
                scope: 'workflow',
                sourceRole: 'configuration',
                isHistorical: false,
                multiValueContext: 'ci_matrix',
                externalId: createClaimExternalId(
                  sourceExternalId,
                  file.path,
                  'node_version',
                  item,
                ),
                provenance: {
                  connector: 'github',
                  repository: repo.fullName,
                  filePath: file.path,
                  url: file.url,
                  extractionMethod: 'github-workflow-node-matrix',
                  lineRange: [lineNum, lineNum],
                  observedAt: new Date().toISOString(),
                  evidence: line.trim().slice(0, 160),
                },
              });
            }
          }
        }
      }

      // 2. CI Runner OS
      const runsOnMatch = line.match(/runs-on:\s*([a-zA-Z0-9_.-]+)/i);
      if (runsOnMatch) {
        const os = runsOnMatch[1].trim();
        claims.push({
          subject,
          predicate: 'ci_runner_os',
          value: os,
          valueType: 'name',
          confidence: 0.95,
          environment: 'ci',
          scope: 'workflow',
          sourceRole: 'configuration',
          isHistorical: false,
          multiValueContext: 'ci_runner',
          externalId: createClaimExternalId(sourceExternalId, file.path, 'ci_runner_os', os),
          provenance: {
            connector: 'github',
            repository: repo.fullName,
            filePath: file.path,
            url: file.url,
            extractionMethod: 'github-workflow-runner',
            lineRange: [lineNum, lineNum],
            observedAt: new Date().toISOString(),
            evidence: line.trim().slice(0, 160),
          },
        });
      }
    }

    return claims;
  }

  private findLineNumber(lines: string[], text: string): number {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(text)) {
        return i + 1;
      }
    }
    return 1;
  }

  private extractEvidence(lines: string[], lineNum: number): string {
    const targetIdx = Math.max(0, lineNum - 1);
    const line = lines[targetIdx] || '';
    return sanitizeSecrets(line.trim().slice(0, 200));
  }
}
