import axios, { AxiosProgressEvent } from 'axios';
import { Project, CoverageReport, FileInfo, FileCoverageResponse, IncrementalSummary, Build, RawUpload } from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// API 响应类型
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const projectApi = {
  getAll: () => api.get<ApiResponse<Project[]>>('/projects'),
  getById: (id: string) => api.get<ApiResponse<Project>>(`/projects/${id}`),
  create: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) =>
    api.post<ApiResponse<Project>>('/projects', data),
  update: (id: string, data: Partial<Project>) =>
    api.put<ApiResponse<Project>>(`/projects/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<void>>(`/projects/${id}`),
};

export const coverageApi = {
  getByProject: (projectId: string) =>
    api.get<ApiResponse<CoverageReport[]>>(`/coverage/project/${projectId}`),
  getById: (id: string) => api.get<ApiResponse<CoverageReport>>(`/coverage/${id}`),
  getLatest: (projectId: string) =>
    api.get<ApiResponse<CoverageReport>>(`/coverage/project/${projectId}/latest`),
  getLatestBatch: (projectIds: string[]) =>
    api.get<ApiResponse<CoverageReport[]>>(`/coverage/project/latest-batch?ids=${projectIds.join(',')}`),
  getTrend: (projectId: string, days: number = 30) =>
    api.get<ApiResponse<CoverageReport[]>>(`/coverage/project/${projectId}/trend?days=${days}`),
  getFileCoverage: (reportId: string) =>
    api.get<ApiResponse<FileInfo[]>>(`/coverage/${reportId}/files`),
  getFileDetail: (reportId: string, filePath: string) =>
    api.get<ApiResponse<FileCoverageResponse>>(`/coverage/${reportId}/file?path=${encodeURIComponent(filePath)}`),
  getIncrementalFileDetail: (reportId: string, filePath: string) =>
    api.get<ApiResponse<FileCoverageResponse>>(`/coverage/${reportId}/file/incremental?path=${encodeURIComponent(filePath)}`),
  getIncrementalFiles: (reportId: string, diffContent: string) =>
    api.post<ApiResponse<FileInfo[]> & { summary?: IncrementalSummary }>(`/coverage/${reportId}/incremental-files`, { diffContent }),
  getIncrementalFilesAuto: (reportId: string) =>
    api.get<ApiResponse<FileInfo[]> & { summary?: IncrementalSummary }>(`/coverage/${reportId}/incremental`),
  getSourceCode: (reportId: string, filePath: string) =>
    api.get<ApiResponse<{ filePath: string; content: string; commitHash: string }>>(`/coverage/${reportId}/source?path=${encodeURIComponent(filePath)}`),
  delete: (id: string) => api.delete<ApiResponse<void>>(`/coverage/${id}`),
};

export const uploadApi = {
  uploadCoverage: (formData: FormData, onUploadProgress?: (e: AxiosProgressEvent) => void) =>
    api.post<ApiResponse<{ reportId: string; lineCoverage: number; functionCoverage: number; branchCoverage: number; incrementalCoverage?: number }>>('/upload/coverage', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
    }),
};

export const buildApi = {
  getByProject: (projectId: string) =>
    api.get<ApiResponse<Build[]>>(`/builds/project/${projectId}`),
  getById: (buildId: string) =>
    api.get<ApiResponse<Build>>(`/builds/${buildId}`),
  create: (formData: FormData, onUploadProgress?: (e: AxiosProgressEvent) => void) =>
    api.post<ApiResponse<Build>>('/builds', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    }),
  createFromPgyer: (data: {
    projectId: string;
    pgyerUrl: string;
    commitHash: string;
    branch: string;
    buildVersion?: string;
    gitDiff?: string;
  }) => api.post<ApiResponse<{ taskId: string }>>('/builds/from-pgyer', data),
  getRawUploads: (buildId: string) =>
    api.get<ApiResponse<RawUpload[]>>(`/builds/${buildId}/raw-uploads`),
  remerge: (buildId: string) =>
    api.post<ApiResponse<Build>>(`/builds/${buildId}/remerge`),
  delete: (buildId: string) =>
    api.delete<ApiResponse<void>>(`/builds/${buildId}`),
};

export default api;
