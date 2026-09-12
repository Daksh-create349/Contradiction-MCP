import {
  GitHubRepoResponse,
  GitHubContentFile,
  GitHubFilePayload,
  GitHubRateLimitInfo,
} from './githubTypes.js';
import { sanitizeSecrets, sanitizeErrorMessage } from '../base/connectorUtils.js';
import { AuthenticationError, NotFoundError, ConnectorError } from '../../domain/types/common.js';
import { logger } from '../../utils/logger.js';

export interface GitHubClientOptions {
  token?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class GitHubClient {
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: GitHubClientOptions) {
    this.token = options?.token?.trim() || undefined;
    this.baseUrl = options?.baseUrl?.replace(/\/+$/, '') || 'https://api.github.com';
    this.timeoutMs = options?.timeoutMs ?? 15000;
  }

  public hasToken(): boolean {
    return Boolean(this.token && this.token.length > 0);
  }

  /**
   * Internal reusable HTTP request execution with rate limit handling,
   * authentication headers, timeouts, and sanitized error mapping.
   */
  public async request<T>(
    endpoint: string,
    query?: Record<string, string | undefined>,
  ): Promise<{ data: T; rateLimit?: GitHubRateLimitInfo }> {
    const url = new URL(`${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);

    if (query) {
      for (const [key, val] of Object.entries(query)) {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, val);
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'contradiction-mcp/0.1.0',
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      logger.debug('Executing GitHub API request', {
        url: url.origin + url.pathname,
        hasAuth: Boolean(this.token),
      });

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const rateLimit = this.extractRateLimit(response.headers);

      if (response.status === 401) {
        throw new AuthenticationError(
          'GitHub API authentication failed. Verify that GITHUB_TOKEN is valid.',
        );
      }

      if (response.status === 403) {
        if (rateLimit && rateLimit.remaining === 0) {
          throw new ConnectorError(
            `GitHub API rate limit exceeded (limit: ${rateLimit.limit}). Resets at ${rateLimit.resetAt.toISOString()}. Provide GITHUB_TOKEN for higher rate limits.`,
          );
        }
        const errorBody = await response.text().catch(() => '');
        throw new ConnectorError(
          `GitHub API access forbidden (HTTP 403): ${sanitizeSecrets(errorBody) || 'Permission denied'}`,
        );
      }

      if (response.status === 404) {
        throw new NotFoundError(
          'GitHub resource',
          `${endpoint}${query?.ref ? ` (ref: ${query.ref})` : ''}`,
        );
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ConnectorError(
          `GitHub API request failed with HTTP ${response.status}: ${sanitizeSecrets(errorBody)}`,
        );
      }

      const data = (await response.json()) as T;
      return { data, rateLimit };
    } catch (error) {
      clearTimeout(timeoutId);

      if (
        error instanceof AuthenticationError ||
        error instanceof NotFoundError ||
        error instanceof ConnectorError
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ConnectorError(`GitHub API request timed out after ${this.timeoutMs}ms`);
      }

      const cleanMessage = sanitizeErrorMessage(error);
      throw new ConnectorError(`GitHub API communication failure: ${cleanMessage}`, error);
    }
  }

  /**
   * Fetches metadata for a GitHub repository.
   */
  public async getRepository(owner: string, repo: string): Promise<GitHubRepoResponse> {
    const { data } = await this.request<GitHubRepoResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
    return data;
  }

  /**
   * Fetches the default README file for a repository.
   * Returns null if README does not exist (HTTP 404).
   */
  public async getReadme(
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<GitHubFilePayload | null> {
    try {
      const { data } = await this.request<GitHubContentFile>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
        ref ? { ref } : undefined,
      );

      return this.parseContentFile(data);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetches a specific file's content from a repository.
   * Returns null if the file does not exist.
   */
  public async getFileContent(
    owner: string,
    repo: string,
    filePath: string,
    ref?: string,
  ): Promise<GitHubFilePayload | null> {
    try {
      const cleanPath = filePath.replace(/^\/+/, '');
      const { data } = await this.request<GitHubContentFile>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURI(cleanPath)}`,
        ref ? { ref } : undefined,
      );

      if (data.type !== 'file') {
        return null;
      }

      return this.parseContentFile(data);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Lists files in a specific directory.
   */
  public async listDirectory(
    owner: string,
    repo: string,
    dirPath: string,
    ref?: string,
  ): Promise<GitHubContentFile[] | null> {
    try {
      const cleanPath = dirPath.replace(/^\/+/, '');
      const { data } = await this.request<GitHubContentFile[]>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURI(cleanPath)}`,
        ref ? { ref } : undefined,
      );

      return Array.isArray(data) ? data : null;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Discovers and retrieves all GitHub Actions workflow YAML files
   * from `.github/workflows`.
   */
  public async getWorkflowFiles(
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<GitHubFilePayload[]> {
    const dirEntries = await this.listDirectory(owner, repo, '.github/workflows', ref);
    if (!dirEntries) {
      return [];
    }

    const workflowFiles = dirEntries.filter(
      (entry) =>
        entry.type === 'file' && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')),
    );

    const payloads: GitHubFilePayload[] = [];
    for (const entry of workflowFiles) {
      const file = await this.getFileContent(owner, repo, entry.path, ref);
      if (file) {
        payloads.push(file);
      }
    }

    return payloads;
  }

  /**
   * Extracts rate limit metrics from response headers.
   */
  private extractRateLimit(headers: Headers): GitHubRateLimitInfo | undefined {
    const limitHeader = headers.get('x-ratelimit-limit');
    const remainingHeader = headers.get('x-ratelimit-remaining');
    const resetHeader = headers.get('x-ratelimit-reset');

    if (!limitHeader || !remainingHeader || !resetHeader) {
      return undefined;
    }

    const limit = parseInt(limitHeader, 10);
    const remaining = parseInt(remainingHeader, 10);
    const resetSeconds = parseInt(resetHeader, 10);

    if (isNaN(limit) || isNaN(remaining) || isNaN(resetSeconds)) {
      return undefined;
    }

    return {
      limit,
      remaining,
      resetAt: new Date(resetSeconds * 1000),
    };
  }

  /**
   * Decodes a base64 GitHub content object into a UTF-8 string payload.
   */
  private parseContentFile(data: GitHubContentFile): GitHubFilePayload {
    let content = '';
    if (data.content) {
      if (data.encoding === 'base64') {
        const cleanBase64 = data.content.replace(/\r?\n|\r/g, '');
        content = Buffer.from(cleanBase64, 'base64').toString('utf-8');
      } else {
        content = data.content;
      }
    }

    return {
      path: data.path,
      content,
      url: data.html_url || data.url,
      sha: data.sha,
      size: data.size,
    };
  }
}
