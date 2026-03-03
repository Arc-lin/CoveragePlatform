import { db } from '../models/database';
import { CoverageReport, FileCoverage } from '../types';

export class CoverageService {
  
  static createReport(report: Omit<CoverageReport, 'id' | 'createdAt'>): CoverageReport {
    return db.createReport(report);
  }

  static getReportsByProject(projectId: number): CoverageReport[] {
    return db.getReportsByProject(projectId);
  }

  static getReportById(id: number): CoverageReport | null {
    return db.getReportById(id) || null;
  }

  static getLatestReport(projectId: number): CoverageReport | null {
    return db.getLatestReport(projectId) || null;
  }

  static getCoverageTrend(projectId: number, days: number = 30): CoverageReport[] {
    return db.getCoverageTrend(projectId, days);
  }

  static deleteReport(id: number): boolean {
    return db.deleteReport(id);
  }

  static addFileCoverage(fileCoverage: FileCoverage): FileCoverage {
    return db.addFileCoverage(fileCoverage);
  }

  static getFileCoveragesByReport(reportId: number): FileCoverage[] {
    return db.getFileCoveragesByReport(reportId);
  }

  static getCoverageSummary(projectId: number) {
    return db.getCoverageSummary(projectId);
  }
}

export default CoverageService;
