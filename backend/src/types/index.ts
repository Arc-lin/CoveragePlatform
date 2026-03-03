// 项目类型
export interface Project {
  id: number;
  name: string;
  platform: 'ios' | 'android';
  repositoryUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// 覆盖率报告类型
export interface CoverageReport {
  id: number;
  projectId: number;
  commitHash: string;
  branch: string;
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  incrementalCoverage?: number;
  reportPath?: string;
  createdAt: string;
}

// 文件覆盖率类型
export interface FileCoverage {
  id?: number;
  reportId: number;
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
}

// 上传请求类型
export interface UploadRequest {
  projectId: number;
  platform: 'ios' | 'android';
  commitHash: string;
  branch: string;
  metadata?: Record<string, string>;
}

// 上传响应类型
export interface UploadResponse {
  success: boolean;
  message: string;
  reportId?: number;
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
