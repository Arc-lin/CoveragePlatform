// MongoDB 数据库服务实现
import mongoose from 'mongoose';
import { ProjectModel, CoverageReportModel, FileCoverageModel, IProject, ICoverageReport, IFileCoverage } from './mongoModels';
import { Project, CoverageReport, FileCoverage } from '../types';

export class MongoDatabase {
  // 项目操作
  async createProject(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const newProject = new ProjectModel({
      ...project,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const saved = await newProject.save();
    return this.toProject(saved);
  }

  async getAllProjects(): Promise<Project[]> {
    const projects = await ProjectModel.find().sort({ updatedAt: -1 });
    return projects.map(p => this.toProject(p));
  }

  async getProjectById(id: string): Promise<Project | undefined> {
    const project = await ProjectModel.findById(id);
    return project ? this.toProject(project) : undefined;
  }

  async getProjectsByPlatform(platform: 'ios' | 'android'): Promise<Project[]> {
    const projects = await ProjectModel.find({ platform }).sort({ updatedAt: -1 });
    return projects.map(p => this.toProject(p));
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    const project = await ProjectModel.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date() },
      { new: true }
    );
    return project ? this.toProject(project) : undefined;
  }

  async deleteProject(id: string): Promise<boolean> {
    const reports = await CoverageReportModel.find({ projectId: id });
    for (const report of reports) {
      await this.deleteReport(report._id?.toString() || '');
    }

    const result = await ProjectModel.findByIdAndDelete(id);
    return !!result;
  }

  async searchProjects(query: string): Promise<Project[]> {
    const lowerQuery = query.toLowerCase();
    const projects = await ProjectModel.find({
      $or: [
        { name: { $regex: lowerQuery, $options: 'i' } },
        { repositoryUrl: { $regex: lowerQuery, $options: 'i' } }
      ]
    }).sort({ updatedAt: -1 });
    return projects.map(p => this.toProject(p));
  }

  // 覆盖率报告操作
  async createReport(report: Omit<CoverageReport, 'id' | 'createdAt'>): Promise<CoverageReport> {
    const newReport = new CoverageReportModel({
      ...report,
      projectId: report.projectId,
      createdAt: new Date()
    });
    const saved = await newReport.save();

    await ProjectModel.findByIdAndUpdate(report.projectId, { updatedAt: new Date() });

    return this.toCoverageReport(saved);
  }

  async getReportsByProject(projectId: string): Promise<CoverageReport[]> {
    const reports = await CoverageReportModel
      .find({ projectId })
      .sort({ createdAt: -1 });
    return reports.map(r => this.toCoverageReport(r));
  }

  async getReportById(id: string): Promise<CoverageReport | undefined> {
    const report = await CoverageReportModel.findById(id);
    return report ? this.toCoverageReport(report) : undefined;
  }

  async getLatestReport(projectId: string): Promise<CoverageReport | undefined> {
    const report = await CoverageReportModel
      .findOne({ projectId })
      .sort({ createdAt: -1 });
    return report ? this.toCoverageReport(report) : undefined;
  }

  async getLatestReportsByProjects(projectIds: string[]): Promise<CoverageReport[]> {
    if (projectIds.length === 0) return [];

    const objectIds = projectIds.map(id => new mongoose.Types.ObjectId(id));
    const results = await CoverageReportModel.aggregate([
      { $match: { projectId: { $in: objectIds } } },
      { $sort: { createdAt: -1 } },
      { $group: {
        _id: '$projectId',
        doc: { $first: '$$ROOT' }
      }},
      { $replaceRoot: { newRoot: '$doc' } }
    ]);

    return results.map((doc: any) => this.toCoverageReport(doc));
  }

  async getCoverageTrend(projectId: string, days: number = 30): Promise<CoverageReport[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const reports = await CoverageReportModel.find({
      projectId,
      createdAt: { $gte: cutoffDate }
    }).sort({ createdAt: 1 });

    return reports.map(r => this.toCoverageReport(r));
  }

  async deleteReport(id: string): Promise<boolean> {
    await FileCoverageModel.deleteMany({ reportId: id });

    const result = await CoverageReportModel.findByIdAndDelete(id);
    return !!result;
  }

  async updateReport(id: string, updates: Partial<CoverageReport>): Promise<CoverageReport | undefined> {
    const report = await CoverageReportModel.findByIdAndUpdate(id, updates, { new: true });
    return report ? this.toCoverageReport(report) : undefined;
  }

  // 文件覆盖率操作
  async addFileCoverage(fileCoverage: Omit<FileCoverage, 'id'>): Promise<FileCoverage> {
    const newFileCoverage = new FileCoverageModel({
      ...fileCoverage,
      reportId: fileCoverage.reportId
    });
    const saved = await newFileCoverage.save();
    return this.toFileCoverage(saved);
  }

  async getFileCoveragesByReport(reportId: string): Promise<FileCoverage[]> {
    const fileCoverages = await FileCoverageModel.find({ reportId });
    return fileCoverages.map(fc => this.toFileCoverage(fc));
  }

  // 覆盖率摘要
  async getCoverageSummary(projectId: string) {
    const reports = await this.getReportsByProject(projectId);

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

  // 类型转换辅助方法
  private toProject(doc: IProject): Project {
    return {
      id: doc._id.toString(),
      name: doc.name,
      platform: doc.platform,
      repositoryUrl: doc.repositoryUrl,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString()
    };
  }

  private toCoverageReport(doc: ICoverageReport | any): CoverageReport {
    return {
      id: doc._id.toString(),
      projectId: doc.projectId.toString(),
      commitHash: doc.commitHash,
      branch: doc.branch,
      lineCoverage: doc.lineCoverage,
      functionCoverage: doc.functionCoverage,
      branchCoverage: doc.branchCoverage,
      incrementalCoverage: doc.incrementalCoverage,
      gitDiff: doc.gitDiff,
      reportPath: doc.reportPath,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt
    };
  }

  private toFileCoverage(doc: IFileCoverage): FileCoverage {
    return {
      id: doc._id.toString(),
      reportId: doc.reportId.toString(),
      filePath: doc.filePath,
      lineCoverage: doc.lineCoverage,
      totalLines: doc.totalLines,
      coveredLines: doc.coveredLines
    };
  }
}

// 导出单例实例
export const mongoDb = new MongoDatabase();

export default mongoDb;
