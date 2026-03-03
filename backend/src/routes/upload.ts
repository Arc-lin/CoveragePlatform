import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import CoverageService from '../services/coverageService';
import ProjectService from '../services/projectService';
import { parseAndroidCoverage, parseIOSCoverage } from '../utils/coverageParser';

const router = Router();

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 限制
  fileFilter: (req, file, cb) => {
    // 允许的文件类型
    const allowedTypes = ['.ec', '.exec', '.profraw', '.profdata', '.info', '.xml', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} is not allowed`));
    }
  }
});

// 上传覆盖率数据
router.post('/coverage', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { projectId, commitHash, branch, platform } = req.body;

    // 验证必要字段
    if (!projectId || !commitHash || !branch) {
      // 删除上传的文件
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: projectId, commitHash, branch'
      });
    }

    const projectIdNum = parseInt(projectId);

    // 检查项目是否存在
    const project = ProjectService.getProjectById(projectIdNum);
    if (!project) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // 解析覆盖率数据
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    let coverageData: {
      lineCoverage: number;
      functionCoverage: number;
      branchCoverage: number;
      incrementalCoverage?: number;
      files?: any[];
    };

    try {
      if (project.platform === 'android' || platform === 'android') {
        coverageData = await parseAndroidCoverage(filePath, fileExt);
      } else if (project.platform === 'ios' || platform === 'ios') {
        coverageData = await parseIOSCoverage(filePath, fileExt);
      } else {
        throw new Error('Unsupported platform');
      }
    } catch (parseError) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: 'Failed to parse coverage file',
        error: (parseError as Error).message
      });
    }

    // 移动文件到永久存储位置
    const reportsDir = path.join(__dirname, '../../reports', projectId);
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const permanentPath = path.join(reportsDir, `${uuidv4()}_${req.file.originalname}`);
    fs.renameSync(filePath, permanentPath);

    // 创建覆盖率报告记录
    const report = CoverageService.createReport({
      projectId: projectIdNum,
      commitHash,
      branch,
      lineCoverage: coverageData.lineCoverage,
      functionCoverage: coverageData.functionCoverage,
      branchCoverage: coverageData.branchCoverage,
      incrementalCoverage: coverageData.incrementalCoverage,
      reportPath: permanentPath
    });

    // 如果有文件级覆盖率数据，保存到数据库
    if (coverageData.files && coverageData.files.length > 0) {
      for (const file of coverageData.files) {
        CoverageService.addFileCoverage({
          reportId: report.id,
          filePath: file.filePath,
          lineCoverage: file.lineCoverage,
          totalLines: file.totalLines,
          coveredLines: file.coveredLines
        });
      }
    }

    // 更新项目的 updated_at
    ProjectService.updateProject(projectIdNum, {});

    res.status(201).json({
      success: true,
      message: 'Coverage report uploaded successfully',
      reportId: report.id,
      data: {
        lineCoverage: coverageData.lineCoverage,
        functionCoverage: coverageData.functionCoverage,
        branchCoverage: coverageData.branchCoverage,
        incrementalCoverage: coverageData.incrementalCoverage
      }
    });

  } catch (error) {
    // 清理上传的文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload coverage report',
      error: (error as Error).message
    });
  }
});

// 批量上传覆盖率数据
router.post('/coverage/batch', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const { projectId, commitHash, branch } = req.body;

    if (!projectId || !commitHash || !branch) {
      // 删除所有上传的文件
      files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: projectId, commitHash, branch'
      });
    }

    // TODO: 实现批量上传逻辑
    res.status(501).json({
      success: false,
      message: 'Batch upload not implemented yet'
    });

  } catch (error) {
    // 清理上传的文件
    const files = req.files as Express.Multer.File[];
    if (files) {
      files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload coverage reports',
      error: (error as Error).message
    });
  }
});

export default router;
