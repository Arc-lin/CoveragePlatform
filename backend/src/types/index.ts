// 项目类型 (MongoDB 使用 string 类型的 _id)
export interface Project {
  id: string;
  name: string;
  platform: 'ios' | 'android' | 'python';
  repositoryUrl?: string;
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
  branch: string;
  buildVersion?: string;
  gitDiff?: string;
  binaryPath: string;
  status: 'ready' | 'error';
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
