import { Router, Request, Response } from 'express';
import CoverageService from '../services/coverageService';
import ProjectService from '../services/projectService';
import { getFileLineCoverage, getReportFiles, getIncrementalFiles } from '../utils/coverageParser';

const router = Router();

// 获取项目的所有覆盖率报告
router.get('/project/:projectId', (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId);
    
    // 检查项目是否存在
    const project = ProjectService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }
    
    const reports = CoverageService.getReportsByProject(projectId);
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch coverage reports',
      error: (error as Error).message 
    });
  }
});

// 获取单个覆盖率报告
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const report = CoverageService.getReportById(id);
    
    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coverage report not found' 
      });
    }
    
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch coverage report',
      error: (error as Error).message 
    });
  }
});

// 获取最新覆盖率报告
router.get('/project/:projectId/latest', (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId);
    
    // 检查项目是否存在
    const project = ProjectService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }
    
    const report = CoverageService.getLatestReport(projectId);
    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'No coverage reports found for this project' 
      });
    }
    
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch latest coverage report',
      error: (error as Error).message 
    });
  }
});

// 获取覆盖率趋势
router.get('/project/:projectId/trend', (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const days = parseInt(req.query.days as string) || 30;
    
    // 检查项目是否存在
    const project = ProjectService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }
    
    const reports = CoverageService.getCoverageTrend(projectId, days);
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch coverage trend',
      error: (error as Error).message 
    });
  }
});

// 获取覆盖率摘要
router.get('/project/:projectId/summary', (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId);
    
    // 检查项目是否存在
    const project = ProjectService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }
    
    const summary = CoverageService.getCoverageSummary(projectId);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch coverage summary',
      error: (error as Error).message 
    });
  }
});

// 获取报告的文件列表
router.get('/:id/files', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    // 检查报告是否存在
    const report = CoverageService.getReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Coverage report not found'
      });
    }

    if (!report.reportPath) {
      return res.status(404).json({
        success: false,
        message: 'Report file not found'
      });
    }

    const files = await getReportFiles(report.reportPath);
    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report files',
      error: (error as Error).message
    });
  }
});

// 获取增量文件列表（只包含 Git diff 中变更的文件）
router.post('/:id/incremental-files', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { diffContent } = req.body;

    if (!diffContent) {
      return res.status(400).json({
        success: false,
        message: 'Git diff content is required in request body'
      });
    }

    // 检查报告是否存在
    const report = CoverageService.getReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Coverage report not found'
      });
    }

    if (!report.reportPath) {
      return res.status(404).json({
        success: false,
        message: 'Report file not found'
      });
    }

    const files = await getIncrementalFiles(report.reportPath, diffContent);
    res.json({ 
      success: true, 
      data: files,
      summary: {
        totalFiles: files.length,
        totalChangedLines: files.reduce((sum, f) => sum + f.changedLines.length, 0),
        averageIncrementalCoverage: files.length > 0
          ? parseFloat((files.reduce((sum, f) => sum + f.incrementalCoverage, 0) / files.length).toFixed(2))
          : 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incremental files',
      error: (error as Error).message
    });
  }
});

// 获取文件的行级覆盖率详情
router.get('/:id/file', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const filePath = req.query.path as string;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'File path is required (query param: path)'
      });
    }
    
    // 检查报告是否存在
    const report = CoverageService.getReportById(id);
    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coverage report not found' 
      });
    }
    
    if (!report.reportPath) {
      return res.status(404).json({
        success: false,
        message: 'Report file not found'
      });
    }
    
    const fileCoverage = await getFileLineCoverage(report.reportPath, filePath);
    
    if (!fileCoverage) {
      return res.status(404).json({
        success: false,
        message: 'File not found in coverage report'
      });
    }
    
    res.json({ success: true, data: fileCoverage });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch file coverage',
      error: (error as Error).message 
    });
  }
});

// 删除覆盖率报告
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const success = CoverageService.deleteReport(id);
    
    if (!success) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coverage report not found' 
      });
    }
    
    res.json({ success: true, message: 'Coverage report deleted successfully' });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete coverage report',
      error: (error as Error).message 
    });
  }
});

export default router;