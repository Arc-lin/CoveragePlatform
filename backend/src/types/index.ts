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
  // 多仓库组件化项目（目前只有 Android 用）：按模块/仓库拆分的覆盖率汇总，
  // 整份报告的 lineCoverage/incrementalCoverage 等字段是这些模块按行数加权聚合出来的
  moduleCoverages?: {
    module: string;
    repositoryUrl?: string;
    commitHash?: string;
    lineCoverage: number;
    functionCoverage: number;
    branchCoverage: number;
    incrementalCoverage?: number;
    totalLines: number;
    coveredLines: number;
    reportPath?: string;
  }[];
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
  // 多仓库组件化项目（目前只有 Android Gradle 多模块用）：按模块拆分的 git diff，
  // 用于按模块分别计算增量覆盖率再加权汇总。单仓库项目继续只用上面那个全量 gitDiff
  moduleDiffs?: { module: string; diff: string }[];
  // 原始的 build-fingerprint.json，纯存档/排查用，不参与匹配逻辑（匹配走 buildKey）
  buildFingerprint?: string;
  binaryPath: string;
  // iOS 专用：以独立动态 framework 形式集成的组件，覆盖率映射数据在它们自己的二进制里，
  // 不在主 App 二进制里——上传 .ipa 时自动从 Frameworks/ 目录提取，llvm-cov export 需要
  // 同时拿到这些二进制才能解析出组件自己的源码覆盖率
  frameworkBinaryPaths?: string[];
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
  module?: string;
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
