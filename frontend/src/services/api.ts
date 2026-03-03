import axios, { AxiosResponse } from 'axios';
import { Project, CoverageReport } from '../types';

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
  getById: (id: number) => api.get<ApiResponse<Project>>(`/projects/${id}`),
  create: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => 
    api.post<ApiResponse<Project>>('/projects', data),
  update: (id: number, data: Partial<Project>) => 
    api.put<ApiResponse<Project>>(`/projects/${id}`, data),
  delete: (id: number) => api.delete<ApiResponse<void>>(`/projects/${id}`),
};

export const coverageApi = {
  getByProject: (projectId: number) => 
    api.get<ApiResponse<CoverageReport[]>>(`/coverage/project/${projectId}`),
  getById: (id: number) => api.get<ApiResponse<CoverageReport>>(`/coverage/${id}`),
  getLatest: (projectId: number) => 
    api.get<ApiResponse<CoverageReport>>(`/coverage/project/${projectId}/latest`),
  getTrend: (projectId: number, days: number = 30) => 
    api.get<ApiResponse<CoverageReport[]>>(`/coverage/project/${projectId}/trend?days=${days}`),
  getFileCoverage: (reportId: number, filePath: string) => 
    api.get<ApiResponse<any>>(`/coverage/${reportId}/files`),
  getFileDetail: (reportId: number, filePath: string) => 
    api.get<ApiResponse<{ filePath: string; lines: any[] }>>(`/coverage/${reportId}/file?path=${encodeURIComponent(filePath)}`),
  getIncrementalFiles: (reportId: number, diffContent: string) => 
    api.post<ApiResponse<any>>(`/coverage/${reportId}/incremental-files`, { diffContent }),
};

export const uploadApi = {
  uploadCoverage: (formData: FormData) => 
    api.post<ApiResponse<{ reportId: number; lineCoverage: number; functionCoverage: number; branchCoverage: number; incrementalCoverage?: number }>>('/upload/coverage', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),
};

export default api;
