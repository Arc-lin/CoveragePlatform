export interface Project {
  id: number;
  name: string;
  platform: 'ios' | 'android';
  repositoryUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface CoverageReport {
  id: number;
  projectId: number;
  commitHash: string;
  branch: string;
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  incrementalCoverage?: number;
  reportPath: string;
  createdAt: string;
}

export interface FileCoverage {
  fileName: string;
  lineCoverage: number;
  lines: {
    lineNumber: number;
    executionCount: number;
    isCovered: boolean;
  }[];
}

export interface UploadResponse {
  success: boolean;
  message: string;
  reportId?: number;
}
