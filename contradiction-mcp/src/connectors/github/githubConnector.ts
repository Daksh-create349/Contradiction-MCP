import { Connector, ConnectorMetadata, ConnectionTestResult } from '../types/connector.js';
import { FetchResult, ExtractedClaim } from '../types/fetchResult.js';
import {
  GitHubConnectorInput,
  GitHubFetchData,
  GitHubFilePayload,
  GitHubRepoInfo,
} from './githubTypes.js';
import { GitHubClient } from './githubClient.js';
import { GitHubExtractor } from './githubExtractor.js';
import { GitHubNormalizer } from './githubNormalizer.js';
import { createSourceExternalId, sanitizeErrorMessage } from '../base/connectorUtils.js';
import { ValidationError } from '../../domain/types/common.js';
import { logger } from '../../utils/logger.js';

export class GitHubConnector implements Connector<GitHubConnectorInput, GitHubFetchData> {
  public readonly type = 'github' as const;

  public readonly metadata: ConnectorMetadata = {
    type: 'github',
    displayName: 'GitHub Repository',
    description:
      'Extracts runtime versions, dependencies, port requirements, and configurations from GitHub repositories via the GitHub REST API.',
    authRequirement: 'optional',
    enabled: true,
    capabilities: {
      supportsIncrementalSync: true,
      supportsFileInspection: true,
      supportedFileTypes: ['package.json', 'Dockerfile', 'README.md', '.github/workflows/*.yml'],
    },
  };

  private readonly client: GitHubClient;
  private readonly extractor: GitHubExtractor;
  private readonly normalizer: GitHubNormalizer;

  constructor(client?: GitHubClient, extractor?: GitHubExtractor, normalizer?: GitHubNormalizer) {
    this.client = client || new GitHubClient();
    this.extractor = extractor || new GitHubExtractor();
    this.normalizer = normalizer || new GitHubNormalizer();
  }

  /**
   * Tests connection to GitHub and verifies target repository accessibility.
   */
  public async testConnection(input?: GitHubConnectorInput): Promise<ConnectionTestResult> {
    const hasAuth = this.client.hasToken();

    if (!input || !input.owner || !input.repo) {
      // General API accessibility check
      try {
        const { rateLimit } = await this.client.request<unknown>('/rate_limit');
        return {
          accessible: true,
          authenticated: hasAuth,
          targetFound: true,
          rateLimit,
          details: { message: 'GitHub API is accessible' },
        };
      } catch (error) {
        return {
          accessible: false,
          authenticated: hasAuth,
          targetFound: false,
          error: sanitizeErrorMessage(error),
        };
      }
    }

    try {
      const repo = await this.client.getRepository(input.owner, input.repo);
      return {
        accessible: true,
        authenticated: hasAuth,
        targetFound: true,
        details: {
          owner: repo.owner.login,
          repo: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          isPrivate: repo.private,
          htmlUrl: repo.html_url,
        },
      };
    } catch (error) {
      const msg = sanitizeErrorMessage(error);
      const isRateLimited = msg.toLowerCase().includes('rate limit');
      return {
        accessible: isRateLimited ? true : false,
        authenticated: hasAuth,
        targetFound: false,
        error: msg,
        details: isRateLimited ? { rateLimited: true, message: msg } : undefined,
      };
    }
  }

  /**
   * Fetches target repository metadata and files for claim extraction.
   */
  public async fetch(input: GitHubConnectorInput): Promise<FetchResult<GitHubFetchData>> {
    if (!input.owner || !input.repo) {
      throw new ValidationError("GitHub connector requires both 'owner' and 'repo' in input");
    }

    logger.info('Fetching repository via GitHub connector', {
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
    });

    const repoData = await this.client.getRepository(input.owner, input.repo);
    const branch = input.branch || repoData.default_branch;

    const files: GitHubFilePayload[] = [];

    // 1. Fetch README
    try {
      const readme = await this.client.getReadme(input.owner, input.repo, branch);
      if (readme) {
        files.push(readme);
      }
    } catch (err) {
      logger.debug('No README found or error fetching README', { error: String(err) });
    }

    // 2. Fetch package.json
    try {
      const pkg = await this.client.getFileContent(input.owner, input.repo, 'package.json', branch);
      if (pkg) {
        files.push(pkg);
      }
    } catch (err) {
      logger.debug('No package.json found or error fetching package.json', { error: String(err) });
    }

    // 3. Fetch Dockerfile
    try {
      const dockerfile = await this.client.getFileContent(
        input.owner,
        input.repo,
        'Dockerfile',
        branch,
      );
      if (dockerfile) {
        files.push(dockerfile);
      }
    } catch (err) {
      logger.debug('No Dockerfile found or error fetching Dockerfile', { error: String(err) });
    }

    // 4. Fetch GitHub Actions workflows
    try {
      const workflows = await this.client.getWorkflowFiles(input.owner, input.repo, branch);
      files.push(...workflows);
    } catch (err) {
      logger.debug('No workflows found or error fetching workflows', { error: String(err) });
    }

    const repoInfo: GitHubRepoInfo = {
      owner: repoData.owner.login,
      repo: repoData.name,
      fullName: repoData.full_name,
      defaultBranch: repoData.default_branch,
      htmlUrl: repoData.html_url,
      description: repoData.description,
    };

    const sourceExternalId = createSourceExternalId('github', repoInfo.fullName);

    return {
      sourceIdentifier: sourceExternalId,
      sourceName: repoInfo.fullName,
      sourceUri: repoInfo.htmlUrl,
      fetchedAt: new Date(),
      rawData: {
        repository: repoInfo,
        files,
      },
      metadata: {
        branch,
        filesCount: files.length,
        inspectedFiles: files.map((f) => f.path),
      },
    };
  }

  /**
   * Extracts and normalizes factual claims from fetched repository data.
   */
  public async extractClaims(fetchResult: FetchResult<GitHubFetchData>): Promise<ExtractedClaim[]> {
    const rawClaims = this.extractor.extractClaims(
      fetchResult.rawData.repository,
      fetchResult.sourceIdentifier,
      fetchResult.rawData.files,
    );

    return this.normalizer.normalizeClaims(rawClaims);
  }
}
