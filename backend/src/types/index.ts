// 项目类型 (MongoDB 使用 string 类型的 _id)
export interface Project {
  id: string;
  name: string;
  platform: 'ios' | 'android' | 'python';
  repositoryUrl?: string;
  // 私有仓库源码拉取用的访问令牌（GitHub PAT / GitLab PRIVATE-TOKEN / Gitee access_token / Bitbucket Bearer token）
  accessToken?: string;
  createdAt: string;
  updatedAt: string;
}

// 覆盖率报告类型
export interface CoverageReport {
  id: string;
  projectId: string;
  commitHash: string;
  branch: string;
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  incrementalCoverage?: number;
  gitDiff?: string;  // 存储 git diff 内容，用于增量覆盖率分析
  reportPath?: string;
  buildId?: string;
  source?: 'manual' | 'auto';
  createdAt: string;
}

// 构建类型
export interface Build {
  id: string;
  projectId: string;
  platform: 'ios' | 'android' | 'python';
  commitHash: string;
  // 组件化项目的"构建身份"键，默认等于 commitHash。upsert/resolve 都按这个字段匹配，
  // commitHash 字段始终是真实的壳工程 commit，只用于源码拉取/展示
  buildKey: string;
  branch: string;
  buildVersion?: string;
  gitDiff?: string;
  // 组件化项目：壳工程仓库拉不到的文件，依次尝试各组件自己的仓库 + commit
  componentRepos?: { name: string; repositoryUrl: string; commitHash: string }[];
  binaryPath: string;
  status: 'ready' | 'processing' | 'error';
  mergedReportId?: string;
  rawUploadCount: number;
  lastMergedAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// 原始覆盖率上传类型
export interface RawUpload {
  id: string;
  buildId: string;
  filePath: string;
  originalFilename: string;
  fileSize: number;
  deviceInfo?: string;
  testerName?: string;
  status: 'uploaded' | 'merged' | 'error';
  errorMessage?: string;
  createdAt: string;
}

// 文件覆盖率类型
export interface FileCoverage {
  id?: string;
  reportId: string;
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
  lines?: FileCoverageLine[];
}

// 行级覆盖率数据
export interface FileCoverageLine {
  lineNumber: number;
  isCovered: boolean;
  coveredInstructions?: number;
  missedInstructions?: number;
}

// 上传请求类型
export interface UploadRequest {
  projectId: string;
  platform: 'ios' | 'android' | 'python';
  commitHash: string;
  branch: string;
  metadata?: Record<string, string>;
}

// 上传响应类型
export interface UploadResponse {
  success: boolean;
  message: string;
  reportId?: string;
}

// 覆盖率趋势数据
export interface CoverageTrend {
  date: string;
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
}

// 文件覆盖率详情（包含行级信息）
export interface FileCoverageDetail {
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
  lines: {
    lineNumber: number;
    executionCount: number;
    isCovered: boolean;
  }[];
}
