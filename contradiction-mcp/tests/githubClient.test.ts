import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubClient } from '../src/connectors/github/githubClient.js';
import { AuthenticationError, NotFoundError, ConnectorError } from '../src/domain/types/common.js';

describe('GitHubClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('includes Authorization header when token is provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
      }),
      json: async () => ({
        id: 123,
        name: 'repo',
        full_name: 'owner/repo',
        owner: { login: 'owner' },
      }),
    });
    global.fetch = mockFetch;

    const client = new GitHubClient({ token: 'ghp_secretToken1234567890abcdef' });
    expect(client.hasToken()).toBe(true);

    await client.getRepository('owner', 'repo');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.headers?.Authorization).toBe('Bearer ghp_secretToken1234567890abcdef');
    expect(init?.headers?.['User-Agent']).toBe('contradiction-mcp/0.1.0');
  });

  it('omits Authorization header when token is not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 456,
        name: 'public-repo',
        full_name: 'owner/public-repo',
        owner: { login: 'owner' },
      }),
    });
    global.fetch = mockFetch;

    const client = new GitHubClient();
    expect(client.hasToken()).toBe(false);

    await client.getRepository('owner', 'public-repo');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it('decodes base64 file contents correctly', async () => {
    const rawText = JSON.stringify({ name: 'my-project', version: '1.0.0' }, null, 2);
    const base64Content = Buffer.from(rawText, 'utf-8').toString('base64');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        type: 'file',
        name: 'package.json',
        path: 'package.json',
        sha: 'abc12345',
        size: rawText.length,
        url: 'https://api.github.com/repos/owner/repo/contents/package.json',
        html_url: 'https://github.com/owner/repo/blob/main/package.json',
        content: base64Content,
        encoding: 'base64',
      }),
    });
    global.fetch = mockFetch;

    const client = new GitHubClient();
    const file = await client.getFileContent('owner', 'repo', 'package.json');

    expect(file).not.toBeNull();
    expect(file?.path).toBe('package.json');
    expect(file?.content).toBe(rawText);
    expect(file?.sha).toBe('abc12345');
  });

  it('extracts rate limit information from response headers', async () => {
    const nowSec = Math.floor(Date.now() / 1000) + 3600;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4990',
        'x-ratelimit-reset': String(nowSec),
      }),
      json: async () => ({ id: 1, name: 'test' }),
    });
    global.fetch = mockFetch;

    const client = new GitHubClient();
    const res = await client.request<{ id: number }>('/repos/owner/repo');

    expect(res.rateLimit).toBeDefined();
    expect(res.rateLimit?.limit).toBe(5000);
    expect(res.rateLimit?.remaining).toBe(4990);
    expect(res.rateLimit?.resetAt.getTime()).toBe(nowSec * 1000);
  });

  it('throws AuthenticationError on HTTP 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => 'Bad credentials',
    });

    const client = new GitHubClient({ token: 'ghp_invalidToken1234567890' });
    await expect(client.getRepository('owner', 'repo')).rejects.toThrow(AuthenticationError);
  });

  it('throws ConnectorError when rate limit is exhausted on HTTP 403', async () => {
    const nowSec = Math.floor(Date.now() / 1000) + 1800;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(nowSec),
      }),
      text: async () => 'API rate limit exceeded',
    });

    const client = new GitHubClient();
    await expect(client.getRepository('owner', 'repo')).rejects.toThrow(ConnectorError);
    await expect(client.getRepository('owner', 'repo')).rejects.toThrow(/rate limit exceeded/);
  });

  it('throws NotFoundError on HTTP 404 for missing repository', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => 'Not Found',
    });

    const client = new GitHubClient();
    await expect(client.getRepository('owner', 'missing-repo')).rejects.toThrow(NotFoundError);
  });

  it('returns null when README or optional file returns 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => 'Not Found',
    });

    const client = new GitHubClient();
    const readme = await client.getReadme('owner', 'no-readme-repo');
    const dockerfile = await client.getFileContent('owner', 'no-dockerfile-repo', 'Dockerfile');

    expect(readme).toBeNull();
    expect(dockerfile).toBeNull();
  });

  it('sanitizes token from error message when network fails', async () => {
    const sensitiveToken = 'ghp_SecretTokenXYZ1234567890987654321';
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error(`Failed request with token ${sensitiveToken}`));

    const client = new GitHubClient({ token: sensitiveToken });

    try {
      await client.getRepository('owner', 'repo');
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConnectorError);
      const msg = (err as Error).message;
      expect(msg).not.toContain(sensitiveToken);
      expect(msg).toContain('[REDACTED_GITHUB_TOKEN]');
    }
  });
});
