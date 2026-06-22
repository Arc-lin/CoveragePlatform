/**
 * 多 Git 平台源码拉取支持。
 * 根据仓库 URL 的域名推断平台类型，分别构造对应的 raw 文件请求。
 * GitLab 分支覆盖 gitlab.com 和自建实例（如内网 git.yy.com），因为两者 API v4 接口一致。
 */

export type GitProvider = 'github' | 'gitlab' | 'gitee' | 'bitbucket';

export interface ParsedRepo {
  provider: GitProvider;
  host: string;
  owner: string;
  repo: string;
}

/**
 * 解析仓库 URL，提取平台类型、owner（可能含嵌套分组，如 GitLab 的 group/subgroup）、repo 名
 */
export function parseRepositoryUrl(repositoryUrl: string): ParsedRepo | null {
  try {
    const cleaned = repositoryUrl.replace(/\.git$/, '');
    const url = new URL(cleaned);
    const host = url.hostname;
    const pathParts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);

    if (pathParts.length < 2) return null;

    const repo = pathParts[pathParts.length - 1];
    const owner = pathParts.slice(0, -1).join('/');

    let provider: GitProvider;
    if (host === 'github.com') {
      provider = 'github';
    } else if (host === 'gitee.com') {
      provider = 'gitee';
    } else if (host === 'bitbucket.org') {
      provider = 'bitbucket';
    } else {
      // 未知域名默认按 GitLab API v4 处理（覆盖自建 GitLab CE/EE，这是企业内网最常见的场景）
      provider = 'gitlab';
    }

    return { provider, host, owner, repo };
  } catch {
    return null;
  }
}

/**
 * 根据平台类型构造获取源码文件原始内容所需的请求信息
 */
export function buildRawFileRequest(
  parsed: ParsedRepo,
  commitHash: string,
  filePath: string,
  accessToken?: string
): { url: string; headers: Record<string, string> } {
  const { provider, host, owner, repo } = parsed;
  const headers: Record<string, string> = { 'User-Agent': 'CoveragePlatform' };

  switch (provider) {
    case 'github': {
      if (accessToken) {
        headers['Authorization'] = `token ${accessToken}`;
      }
      return {
        url: `https://raw.githubusercontent.com/${owner}/${repo}/${commitHash}/${filePath}`,
        headers
      };
    }

    case 'gitlab': {
      if (accessToken) {
        headers['PRIVATE-TOKEN'] = accessToken;
      }
      const projectId = encodeURIComponent(`${owner}/${repo}`);
      const encodedFilePath = encodeURIComponent(filePath);
      return {
        url: `https://${host}/api/v4/projects/${projectId}/repository/files/${encodedFilePath}/raw?ref=${encodeURIComponent(commitHash)}`,
        headers
      };
    }

    case 'gitee': {
      const tokenParam = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : '';
      return {
        url: `https://gitee.com/api/v5/repos/${owner}/${repo}/raw/${filePath}?ref=${encodeURIComponent(commitHash)}${tokenParam}`,
        headers
      };
    }

    case 'bitbucket': {
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      return {
        url: `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/src/${commitHash}/${filePath}`,
        headers
      };
    }
  }
}
