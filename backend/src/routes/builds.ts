import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { mongoDb } from '../models/database';
import { mergeIOSCoverage, mergeAndroidCoverage, withBuildLock, checkToolAvailability } from '../utils/coverageConverter';
import { parseIOSCoverage, parseAndroidCoverage, getIncrementalFiles } from '../utils/coverageParser';
import { extractPgyerKey, getIPADownloadUrl, downloadIPA, extractBinaryFromIPA } from '../utils/pgyerDownloader';
import { Build } from '../types';

const router = Router();

// === multer 配置：构建产物上传 ===
const binaryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const binaryUpload = multer({
  storage: binaryStorage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// === multer 配置：原始覆盖率上传 ===
const rawStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const rawUpload = multer({
  storage: rawStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.profraw', '.ec', '.exec'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} is not allowed. Expected: ${allowedTypes.join(', ')}`));
    }
  }
});

// =====================================================
// Pgyer 下载任务跟踪
// =====================================================
interface PgyerTask {
  status: 'fetching_plist' | 'downloading' | 'extracting' | 'complete' | 'error';
  progress?: { downloaded: number; total: number };
  build?: Build;
  error?: string;
  filename?: string;
}
const pgyerTasks = new Map<string, PgyerTask>();

// =====================================================
// POST /api/builds/from-pgyer — 从蒲公英下载 IPA 创建 Build
// =====================================================
router.post('/from-pgyer', async (req: Request, res: Response) => {
  try {
    const { projectId, pgyerUrl, commitHash, branch, buildVersion, gitDiff } = req.body;

    if (!projectId || !pgyerUrl || !commitHash || !branch) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: projectId, pgyerUrl, commitHash, branch'
      });
    }

    const project = await mongoDb.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (project.platform !== 'ios') {
      return res.status(400).json({
        success: false,
        message: 'Pgyer download is only supported for iOS projects'
      });
    }

    const pgyerKey = extractPgyerKey(pgyerUrl);
    if (!pgyerKey) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Pgyer URL. Expected format: https://www.pgyer.com/{key}'
      });
    }

    // 检查工具可用性
    const tools = checkToolAvailability();
    if (!tools.ios) {
      return res.status(503).json({
        success: false,
        message: 'iOS coverage conversion tools not available on this server',
        errors: tools.errors
      });
    }

    const taskId = uuidv4();
    pgyerTasks.set(taskId, { status: 'fetching_plist' });

    // 返回 taskId，后台异步执行下载
    res.status(202).json({ success: true, data: { taskId } });

    // === 异步执行下载流程 ===
    (async () => {
      try {
        // 1. 获取 IPA 下载地址
        pgyerTasks.set(taskId, { status: 'fetching_plist' });
        const { url: ipaUrl, filename } = await getIPADownloadUrl(pgyerKey);
        pgyerTasks.set(taskId, { status: 'downloading', filename, progress: { downloaded: 0, total: 0 } });

        // 2. 创建 Build 目录结构
        const buildId = uuidv4().replace(/-/g, '').substring(0, 24);
        const buildDir = path.join(__dirname, '../../builds', projectId, buildId);
        const binaryDir = path.join(buildDir, 'binary');
        const rawDir = path.join(buildDir, 'raw');
        const mergedDir = path.join(buildDir, 'merged');
        fs.mkdirSync(binaryDir, { recursive: true });
        fs.mkdirSync(rawDir, { recursive: true });
        fs.mkdirSync(mergedDir, { recursive: true });

        // 3. 下载 IPA
        const ipaPath = path.join(binaryDir, filename);
        await downloadIPA(ipaUrl, ipaPath, (downloaded, total) => {
          pgyerTasks.set(taskId, {
            status: 'downloading',
            filename,
            progress: { downloaded, total }
          });
        });

        // 4. 从 IPA 中提取 Mach-O binary
        pgyerTasks.set(taskId, { status: 'extracting', filename });
        const ipaExtractDir = path.join(buildDir, 'ipa_extracted');
        const machoBinaryPath = await extractBinaryFromIPA(ipaPath, ipaExtractDir);

        // 复制 binary 到 binary 目录
        const binaryName = path.basename(machoBinaryPath);
        const permanentBinaryPath = path.join(binaryDir, binaryName);
        fs.copyFileSync(machoBinaryPath, permanentBinaryPath);

        // 清理解压目录
        fs.rmSync(ipaExtractDir, { recursive: true, force: true });

        // 5. 创建 Build 记录
        const build = await mongoDb.createBuild({
          projectId,
          platform: 'ios',
          commitHash,
          branch,
          buildVersion,
          gitDiff,
          binaryPath: permanentBinaryPath,
          status: 'ready'
        });

        // 重命名目录以使用真实的 MongoDB _id
        const realBuildDir = path.join(__dirname, '../../builds', projectId, build.id);
        if (buildDir !== realBuildDir) {
          fs.renameSync(buildDir, realBuildDir);
          const realBinaryPath = path.join(realBuildDir, 'binary', binaryName);
          await mongoDb.updateBuild(build.id, { binaryPath: realBinaryPath });
          build.binaryPath = realBinaryPath;
        }

        pgyerTasks.set(taskId, { status: 'complete', build, filename });

        // 5 分钟后清理任务记录
        setTimeout(() => pgyerTasks.delete(taskId), 5 * 60 * 1000);

      } catch (err) {
        const message = (err as Error).message || 'Unknown error during Pgyer download';
        console.error('Pgyer download failed:', message);
        pgyerTasks.set(taskId, { status: 'error', error: message });
        setTimeout(() => pgyerTasks.delete(taskId), 5 * 60 * 1000);
      }
    })();

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Pgyer download',
      error: (error as Error).message
    });
  }
});

// =====================================================
// GET /api/builds/pgyer-progress/:taskId — SSE 进度推送
// =====================================================
router.get('/pgyer-progress/:taskId', (req: Request, res: Response) => {
  const { taskId } = req.params;
  const task = pgyerTasks.get(taskId);

  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const interval = setInterval(() => {
    const current = pgyerTasks.get(taskId);
    if (!current) {
      clearInterval(interval);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify(current)}\n\n`);

    if (current.status === 'complete' || current.status === 'error') {
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// =====================================================
// POST /api/builds — 创建 Build（开发者调用）
// =====================================================
router.post('/', binaryUpload.single('binary'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No binary file uploaded' });
    }

    const { projectId, commitHash, branch, buildVersion, gitDiff } = req.body;

    if (!projectId || !commitHash || !branch) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: projectId, commitHash, branch'
      });
    }

    const project = await mongoDb.getProjectById(projectId);
    if (!project) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // 检查工具可用性
    const tools = checkToolAvailability();
    if (project.platform === 'ios' && !tools.ios) {
      fs.unlinkSync(req.file.path);
      return res.status(503).json({
        success: false,
        message: 'iOS coverage conversion tools not available on this server',
        errors: tools.errors
      });
    }
    if (project.platform === 'android' && !tools.android) {
      fs.unlinkSync(req.file.path);
      return res.status(503).json({
        success: false,
        message: 'Android coverage conversion tools not available on this server',
        errors: tools.errors
      });
    }

    // 先创建一个临时 ID 用于目录命名
    const buildId = uuidv4().replace(/-/g, '').substring(0, 24);

    // 创建 Build 目录结构
    const buildDir = path.join(__dirname, '../../builds', projectId, buildId);
    const binaryDir = path.join(buildDir, 'binary');
    const rawDir = path.join(buildDir, 'raw');
    const mergedDir = path.join(buildDir, 'merged');
    fs.mkdirSync(binaryDir, { recursive: true });
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(mergedDir, { recursive: true });

    // 移动 binary 到永久位置
    const permanentBinaryPath = path.join(binaryDir, req.file.originalname);
    fs.renameSync(req.file.path, permanentBinaryPath);

    // Android: 自动解压 classfiles.zip
    if (project.platform === 'android' && req.file.originalname.endsWith('.zip')) {
      const classfilesDir = path.join(buildDir, 'classfiles');
      fs.mkdirSync(classfilesDir, { recursive: true });
      try {
        const { execSync } = require('child_process');
        execSync(`unzip -o "${permanentBinaryPath}" -d "${classfilesDir}"`, { timeout: 60000, stdio: 'pipe' });
      } catch (e) {
        // 解压失败，清理
        fs.rmSync(buildDir, { recursive: true, force: true });
        return res.status(400).json({
          success: false,
          message: 'Failed to extract classfiles.zip',
          error: (e as Error).message
        });
      }
    }

    // 创建 Build 记录
    const build = await mongoDb.createBuild({
      projectId,
      platform: project.platform,
      commitHash,
      branch,
      buildVersion,
      gitDiff,
      binaryPath: permanentBinaryPath,
      status: 'ready'
    });

    // 重命名目录以使用真实的 MongoDB _id
    const realBuildDir = path.join(__dirname, '../../builds', projectId, build.id);
    if (buildDir !== realBuildDir) {
      fs.renameSync(buildDir, realBuildDir);
      // 更新 binaryPath
      const realBinaryPath = path.join(realBuildDir, 'binary', req.file.originalname);
      await mongoDb.updateBuild(build.id, { binaryPath: realBinaryPath });
      build.binaryPath = realBinaryPath;
    }

    res.status(201).json({ success: true, data: build });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create build',
      error: (error as Error).message
    });
  }
});

// =====================================================
// POST /api/builds/:buildId/raw-coverage — SDK 上传原始覆盖率
// =====================================================
router.post('/:buildId/raw-coverage', rawUpload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No coverage file uploaded' });
    }

    const { buildId } = req.params;
    const { deviceInfo, testerName } = req.body;

    const build = await mongoDb.getBuildById(buildId);
    if (!build) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Build not found' });
    }

    if (build.status !== 'ready') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: `Build is in '${build.status}' state and cannot accept uploads`
      });
    }

    // 校验文件扩展名匹配平台
    const ext = path.extname(req.file.originalname).toLowerCase();
    const expectedExts = build.platform === 'ios' ? ['.profraw'] : ['.ec', '.exec'];
    if (!expectedExts.includes(ext)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: `Expected ${expectedExts.join(' or ')} for ${build.platform} build, got ${ext}`
      });
    }

    // 移动文件到 Build 的 raw 目录
    const buildDir = path.dirname(path.dirname(build.binaryPath)); // builds/{projectId}/{buildId}
    const rawDir = path.join(buildDir, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const permanentPath = path.join(rawDir, `${uuidv4()}_${req.file.originalname}`);
    fs.renameSync(req.file.path, permanentPath);

    // 创建 RawUpload 记录
    const rawUploadRecord = await mongoDb.createRawUpload({
      buildId,
      filePath: permanentPath,
      originalFilename: req.file.originalname,
      fileSize: req.file.size,
      deviceInfo,
      testerName,
      status: 'uploaded'
    });

    // 增加计数
    await mongoDb.incrementBuildRawCount(buildId);

    // 执行合并（带锁）
    let mergeError: string | null = null;
    let coverageResult: any = null;

    await withBuildLock(buildId, async () => {
      try {
        // 获取所有原始文件路径
        const allRawUploads = await mongoDb.getRawUploadsByBuild(buildId);
        const rawFilePaths = allRawUploads
          .filter(r => fs.existsSync(r.filePath))
          .map(r => r.filePath);

        if (rawFilePaths.length === 0) {
          throw new Error('No valid raw files found for merge');
        }

        // 执行转换
        let reportPath: string;
        if (build.platform === 'ios') {
          reportPath = await mergeIOSCoverage(buildDir, build.binaryPath, rawFilePaths);
        } else {
          reportPath = await mergeAndroidCoverage(buildDir, build.binaryPath, rawFilePaths);
        }

        // 解析合并后的覆盖率文件
        const fileExt = path.extname(reportPath).toLowerCase();
        let coverageData;
        if (build.platform === 'ios') {
          coverageData = await parseIOSCoverage(reportPath, fileExt);
        } else {
          coverageData = await parseAndroidCoverage(reportPath, fileExt);
        }

        // 创建或更新 CoverageReport
        if (build.mergedReportId) {
          // 更新已有报告
          await mongoDb.deleteFileCoveragesByReport(build.mergedReportId);
          await mongoDb.updateReport(build.mergedReportId, {
            lineCoverage: coverageData.lineCoverage,
            functionCoverage: coverageData.functionCoverage,
            branchCoverage: coverageData.branchCoverage,
            reportPath
          });

          // 重新添加文件覆盖率
          if (coverageData.files) {
            for (const file of coverageData.files) {
              await mongoDb.addFileCoverage({
                reportId: build.mergedReportId,
                filePath: file.filePath,
                lineCoverage: file.lineCoverage,
                totalLines: file.totalLines,
                coveredLines: file.coveredLines
              });
            }
          }

          // 如果有 gitDiff，计算增量覆盖率
          if (build.gitDiff) {
            try {
              const incrementalFiles = await getIncrementalFiles(reportPath, build.gitDiff);
              if (incrementalFiles.length > 0) {
                const incrementalCoverage = parseFloat(
                  (incrementalFiles.reduce((sum, f) => sum + (f.incrementalCoverage || 0), 0) / incrementalFiles.length).toFixed(2)
                );
                await mongoDb.updateReport(build.mergedReportId, {
                  incrementalCoverage,
                  gitDiff: build.gitDiff
                });
              }
            } catch (e) {
              console.error('Failed to compute incremental coverage:', e);
            }
          }

          coverageResult = coverageData;
        } else {
          // 创建新报告
          const report = await mongoDb.createReport({
            projectId: build.projectId,
            commitHash: build.commitHash,
            branch: build.branch,
            lineCoverage: coverageData.lineCoverage,
            functionCoverage: coverageData.functionCoverage,
            branchCoverage: coverageData.branchCoverage,
            gitDiff: build.gitDiff,
            reportPath,
            buildId: build.id,
            source: 'auto'
          });

          // 添加文件覆盖率
          if (coverageData.files) {
            for (const file of coverageData.files) {
              await mongoDb.addFileCoverage({
                reportId: report.id,
                filePath: file.filePath,
                lineCoverage: file.lineCoverage,
                totalLines: file.totalLines,
                coveredLines: file.coveredLines
              });
            }
          }

          // 如果有 gitDiff，计算增量覆盖率
          if (build.gitDiff) {
            try {
              const incrementalFiles = await getIncrementalFiles(reportPath, build.gitDiff);
              if (incrementalFiles.length > 0) {
                const incrementalCoverage = parseFloat(
                  (incrementalFiles.reduce((sum, f) => sum + (f.incrementalCoverage || 0), 0) / incrementalFiles.length).toFixed(2)
                );
                await mongoDb.updateReport(report.id, { incrementalCoverage });
              }
            } catch (e) {
              console.error('Failed to compute incremental coverage:', e);
            }
          }

          // 关联 Build
          await mongoDb.updateBuild(buildId, { mergedReportId: report.id } as any);

          coverageResult = coverageData;
        }

        // 更新 Build 状态
        await mongoDb.updateBuild(buildId, {
          status: 'ready',
          lastMergedAt: new Date().toISOString(),
          errorMessage: undefined
        } as any);

        // 更新所有 RawUpload 状态
        for (const raw of allRawUploads) {
          await mongoDb.updateRawUploadStatus(raw.id, 'merged');
        }

        // 更新项目的 updatedAt
        await mongoDb.updateProject(build.projectId, {});

      } catch (e) {
        mergeError = (e as any).stderr?.toString() || (e as Error).message;
        console.error('Merge failed:', mergeError);

        await mongoDb.updateBuild(buildId, {
          status: 'error',
          errorMessage: `Merge failed: ${mergeError}`
        } as any);

        await mongoDb.updateRawUploadStatus(rawUploadRecord.id, 'error', mergeError || undefined);
      }
    });

    if (mergeError) {
      return res.status(500).json({
        success: false,
        message: 'Coverage conversion/merge failed',
        error: mergeError
      });
    }

    // 重新获取最新 Build 状态
    const updatedBuild = await mongoDb.getBuildById(buildId);

    res.status(201).json({
      success: true,
      message: 'Raw coverage uploaded and merged successfully',
      data: {
        rawUploadId: rawUploadRecord.id,
        buildId,
        reportId: updatedBuild?.mergedReportId,
        rawUploadCount: updatedBuild?.rawUploadCount || 0,
        coverage: coverageResult ? {
          lineCoverage: coverageResult.lineCoverage,
          functionCoverage: coverageResult.functionCoverage,
          branchCoverage: coverageResult.branchCoverage
        } : null
      }
    });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Failed to upload raw coverage',
      error: (error as Error).message
    });
  }
});

// =====================================================
// GET /api/builds/project/:projectId — 列出项目的所有 Build
// =====================================================
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const builds = await mongoDb.getBuildsByProject(req.params.projectId);
    res.json({ success: true, data: builds });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch builds',
      error: (error as Error).message
    });
  }
});

// =====================================================
// GET /api/builds/:buildId — 获取 Build 详情
// =====================================================
router.get('/:buildId', async (req: Request, res: Response) => {
  try {
    const build = await mongoDb.getBuildById(req.params.buildId);
    if (!build) {
      return res.status(404).json({ success: false, message: 'Build not found' });
    }
    res.json({ success: true, data: build });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch build',
      error: (error as Error).message
    });
  }
});

// =====================================================
// GET /api/builds/:buildId/raw-uploads — 列出 Build 的所有原始上传
// =====================================================
router.get('/:buildId/raw-uploads', async (req: Request, res: Response) => {
  try {
    const rawUploads = await mongoDb.getRawUploadsByBuild(req.params.buildId);
    res.json({ success: true, data: rawUploads });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch raw uploads',
      error: (error as Error).message
    });
  }
});

// =====================================================
// POST /api/builds/:buildId/remerge — 强制重新合并
// =====================================================
router.post('/:buildId/remerge', async (req: Request, res: Response) => {
  try {
    const build = await mongoDb.getBuildById(req.params.buildId);
    if (!build) {
      return res.status(404).json({ success: false, message: 'Build not found' });
    }

    const allRawUploads = await mongoDb.getRawUploadsByBuild(build.id);
    if (allRawUploads.length === 0) {
      return res.status(400).json({ success: false, message: 'No raw uploads to merge' });
    }

    // 模拟一次上传来触发合并（复用 raw-coverage 的合并逻辑）
    // 这里直接内联合并逻辑
    let mergeError: string | null = null;

    await withBuildLock(build.id, async () => {
      try {
        const rawFilePaths = allRawUploads
          .filter(r => fs.existsSync(r.filePath))
          .map(r => r.filePath);

        if (rawFilePaths.length === 0) {
          throw new Error('No valid raw files found on disk');
        }

        const buildDir = path.dirname(path.dirname(build.binaryPath));
        let reportPath: string;
        if (build.platform === 'ios') {
          reportPath = await mergeIOSCoverage(buildDir, build.binaryPath, rawFilePaths);
        } else {
          reportPath = await mergeAndroidCoverage(buildDir, build.binaryPath, rawFilePaths);
        }

        const fileExt = path.extname(reportPath).toLowerCase();
        let coverageData;
        if (build.platform === 'ios') {
          coverageData = await parseIOSCoverage(reportPath, fileExt);
        } else {
          coverageData = await parseAndroidCoverage(reportPath, fileExt);
        }

        if (build.mergedReportId) {
          await mongoDb.deleteFileCoveragesByReport(build.mergedReportId);
          await mongoDb.updateReport(build.mergedReportId, {
            lineCoverage: coverageData.lineCoverage,
            functionCoverage: coverageData.functionCoverage,
            branchCoverage: coverageData.branchCoverage,
            reportPath
          });

          if (coverageData.files) {
            for (const file of coverageData.files) {
              await mongoDb.addFileCoverage({
                reportId: build.mergedReportId,
                filePath: file.filePath,
                lineCoverage: file.lineCoverage,
                totalLines: file.totalLines,
                coveredLines: file.coveredLines
              });
            }
          }
        }

        await mongoDb.updateBuild(build.id, {
          status: 'ready',
          lastMergedAt: new Date().toISOString(),
          errorMessage: undefined
        } as any);

        for (const raw of allRawUploads) {
          await mongoDb.updateRawUploadStatus(raw.id, 'merged');
        }

      } catch (e) {
        mergeError = (e as any).stderr?.toString() || (e as Error).message;
        await mongoDb.updateBuild(build.id, {
          status: 'error',
          errorMessage: `Remerge failed: ${mergeError}`
        } as any);
      }
    });

    if (mergeError) {
      return res.status(500).json({ success: false, message: 'Remerge failed', error: mergeError });
    }

    const updatedBuild = await mongoDb.getBuildById(build.id);
    res.json({ success: true, message: 'Remerge completed', data: updatedBuild });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to remerge',
      error: (error as Error).message
    });
  }
});

// =====================================================
// DELETE /api/builds/:buildId — 删除 Build
// =====================================================
router.delete('/:buildId', async (req: Request, res: Response) => {
  try {
    const build = await mongoDb.getBuildById(req.params.buildId);
    if (!build) {
      return res.status(404).json({ success: false, message: 'Build not found' });
    }

    // 删除磁盘文件
    const buildDir = path.dirname(path.dirname(build.binaryPath));
    if (fs.existsSync(buildDir)) {
      fs.rmSync(buildDir, { recursive: true, force: true });
    }

    // 删除数据库记录
    await mongoDb.deleteBuild(build.id);

    res.json({ success: true, message: 'Build deleted successfully' });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete build',
      error: (error as Error).message
    });
  }
});

export default router;
