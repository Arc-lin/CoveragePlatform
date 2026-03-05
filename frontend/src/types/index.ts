export interface Project {
  id: string;
  name: string;
  platform: 'ios' | 'android';
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
