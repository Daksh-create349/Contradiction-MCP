export interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
}

export interface GitHubContentFile {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  download_url: string | null;
  content?: string;
  encoding?: string;
}

export interface GitHubRateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface GitHubConnectorInput {
  owner: string;
  repo: string;
  branch?: string;
  targetFiles?: string[];
}

export interface GitHubFilePayload {
  path: string;
  content: string;
  url: string;
  sha: string;
  size: number;
}

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  description: string | null;
}

export interface GitHubFetchData {
  repository: GitHubRepoInfo;
  files: GitHubFilePayload[];
  rateLimit?: GitHubRateLimitInfo;
}
