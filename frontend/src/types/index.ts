export interface Project {
  id: string;
  name: string;
  platform: 'ios' | 'android' | 'python';
  repositoryUrl?: string;
  hasAccessToken?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CoverageReport {
  id: string;
  projectId: string;
  commitHash: string;
  branch: string;
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  incrementalCoverage?: number;
  gitDiff?: string;
  reportPath?: string;
  buildId?: string;
  source?: 'manual' | 'auto';
  // 多仓库组件化项目（目前只有 Android 用）：按模块/仓库拆分的覆盖率汇总
  moduleCoverages?: ModuleCoverage[];
  createdAt: string;
}

export interface ModuleCoverage {
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
}

export interface FileCoverage {
  id?: string;
  reportId: string;
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
  module?: string;
}

export interface UploadResponse {
  success: boolean;
  message: string;
  reportId?: string;
}

export interface FileInfo {
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
  changedLines?: number[];
  incrementalCoverage?: number;
  module?: string;
}

export interface LineCoverageDetail {
  lineNumber: number;
  isCovered: boolean;
  isChanged?: boolean;
  missedInstructions: number;
  coveredInstructions: number;
}

export interface IncrementalSummary {
  totalFiles: number;
  totalChangedLines: number;
  averageIncrementalCoverage: number;
}

export interface FileCoverageResponse {
  filePath: string;
  lines: LineCoverageDetail[];
}

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
