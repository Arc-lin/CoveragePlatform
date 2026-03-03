// 简化的内存数据库实现
// 生产环境建议替换为真正的数据库

import { Project, CoverageReport, FileCoverage } from '../types';

class MemoryDatabase {
  private projects: Map<number, Project> = new Map();
  private coverageReports: Map<number, CoverageReport> = new Map();
  private fileCoverages: Map<number, FileCoverage[]> = new Map();
  
  private projectIdCounter = 1;
  private reportIdCounter = 1;

  // 项目操作
  createProject(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project {
    const id = this.projectIdCounter++;
    const now = new Date().toISOString();
    const newProject: Project = {
      ...project,
      id,
      createdAt: now,
      updatedAt: now
    };
    this.projects.set(id, newProject);
    return newProject;
  }

  getAllProjects(): Project[] {
    return Array.from(this.projects.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  getProjectById(id: number): Project | undefined {
    return this.projects.get(id);
  }

  getProjectsByPlatform(platform: 'ios' | 'android'): Project[] {
    return this.getAllProjects().filter(p => p.platform === platform);
  }

  updateProject(id: number, updates: Partial<Project>): Project | undefined {
    const project = this.projects.get(id);
    if (!project) return undefined;
    
    const updated = {
      ...project,
      ...updates,
      id: project.id,
      updatedAt: new Date().toISOString()
    };
    this.projects.set(id, updated);
    return updated;
  }

  deleteProject(id: number): boolean {
    // 删除关联的覆盖率报告
    const reportsToDelete = this.getReportsByProject(id);
    reportsToDelete.forEach(r => this.deleteReport(r.id));
    
    return this.projects.delete(id);
  }

  searchProjects(query: string): Project[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllProjects().filter(p => 
      p.name.toLowerCase().includes(lowerQuery) ||
      (p.repositoryUrl && p.repositoryUrl.toLowerCase().includes(lowerQuery))
    );
  }

  // 覆盖率报告操作
  createReport(report: Omit<CoverageReport, 'id' | 'createdAt'>): CoverageReport {
    const id = this.reportIdCounter++;
    const newReport: CoverageReport = {
      ...report,
      id,
      createdAt: new Date().toISOString()
    };
    this.coverageReports.set(id, newReport);
    
    // 初始化文件覆盖率数组
    this.fileCoverages.set(id, []);
    
    // 更新项目时间
    const project = this.projects.get(report.projectId);
    if (project) {
      this.updateProject(project.id, {});
    }
    
    return newReport;
  }

  getReportsByProject(projectId: number): CoverageReport[] {
    return Array.from(this.coverageReports.values())
      .filter(r => r.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getReportById(id: number): CoverageReport | undefined {
    return this.coverageReports.get(id);
  }

  getLatestReport(projectId: number): CoverageReport | undefined {
    const reports = this.getReportsByProject(projectId);
    return reports[0];
  }

  getCoverageTrend(projectId: number, days: number = 30): CoverageReport[] {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return this.getReportsByProject(projectId)
      .filter(r => new Date(r.createdAt) >= cutoffDate)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  deleteReport(id: number): boolean {
    this.fileCoverages.delete(id);
    return this.coverageReports.delete(id);
  }

  // 文件覆盖率操作
  addFileCoverage(fileCoverage: FileCoverage): FileCoverage {
    const list = this.fileCoverages.get(fileCoverage.reportId) || [];
    const withId = { ...fileCoverage, id: list.length + 1 };
    list.push(withId);
    this.fileCoverages.set(fileCoverage.reportId, list);
    return withId;
  }

  getFileCoveragesByReport(reportId: number): FileCoverage[] {
    return this.fileCoverages.get(reportId) || [];
  }

  // 覆盖率摘要
  getCoverageSummary(projectId: number) {
    const reports = this.getReportsByProject(projectId);
    
    if (reports.length === 0) {
      return {
        latest: null,
        average: null,
        totalReports: 0
      };
    }

    const latest = reports[0];
    const avgLine = reports.reduce((sum, r) => sum + r.lineCoverage, 0) / reports.length;
    const avgFunc = reports.reduce((sum, r) => sum + r.functionCoverage, 0) / reports.length;
    const avgBranch = reports.reduce((sum, r) => sum + r.branchCoverage, 0) / reports.length;

    return {
      latest: {
        lineCoverage: latest.lineCoverage,
        functionCoverage: latest.functionCoverage,
        branchCoverage: latest.branchCoverage
      },
      average: {
        lineCoverage: parseFloat(avgLine.toFixed(2)),
        functionCoverage: parseFloat(avgFunc.toFixed(2)),
        branchCoverage: parseFloat(avgBranch.toFixed(2))
      },
      totalReports: reports.length
    };
  }
}

// 导出单例实例
export const db = new MemoryDatabase();

// 初始化函数（兼容性保留）
export function initDatabase(): void {
  console.log('Memory database initialized');
}

export default db;
