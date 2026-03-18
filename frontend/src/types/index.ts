export interface Project {
  id: string;
  name: string;
  platform: 'ios' | 'android' | 'python';
  repositoryUrl?: string;
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
  createdAt: string;
}

export interface FileCoverage {
  id?: string;
  reportId: string;
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
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
