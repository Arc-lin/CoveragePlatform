import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { mongoDb } from '../models/database';
import { mergeIOSCoverage, mergeAndroidCoverage, withBuildLock, checkToolAvailability } from '../utils/coverageConverter';
import { parseIOSCoverage, parseAndroidCoverage, getIncrementalFiles } from '../utils/coverageParser';
import { extractPgyerKey, getIPADownloadUrl, downloadIPA, extractBinaryFromIPA, extractFrameworkBinaries } from '../utils/pgyerDownloader';
import { moveFile } from '../utils/fsUtils';
import { Build } from '../types';

const router = Router();

interface MergedFileCoverage {
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
  module?: string;
}

interface MergedModuleCoverage {
  module: string;
  repositoryUrl?: string;
  commitHash?: string;
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  incrementalCoverage?: number;
  totalLines: number;
  coveredLines: number;
  reportPath?: string;
}

interface MergedCoverageResult {
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  incrementalCoverage?: number;
  files: MergedFileCoverage[];
  moduleCoverages?: MergedModuleCoverage[];
  reportPath: string;
}

// 按变更行数加权平均，跟现有单仓库逻辑保持一致的近似方式（也用在多模块场景里按模块加权聚合）
async function computeWeightedIncremental(reportPath: string, diff: string): Promise<number | undefined> {
  const incrementalFiles = await getIncrementalFiles(reportPath, diff);
  if (incrementalFiles.length === 0) return undefined;
  const totalChanged = incrementalFiles.reduce((s, f) => s + f.changedLines.length, 0);
  if (totalChanged === 0) return 0;
  return parseFloat(
    (incrementalFiles.reduce((s, f) => s + (f.incrementalCoverage || 0) * f.changedLines.length, 0) / totalChanged).toFixed(2)
  );
}

// 合并 + 解析，统一处理单仓库（iOS / 老 Android）和多模块 Android 两种情况——
// 多模块时把每个模块各自的 XML 单独解析，整体数字按各模块的行数加权聚合（跟项目里其它地方
// 用变更行数加权聚合增量覆盖率是同一套近似思路，不引入新的聚合口径）
async function mergeAndComputeCoverage(build: Build, buildDir: string, rawFilePaths: string[]): Promise<MergedCoverageResult> {
  if (build.platform === 'ios') {
    const reportPath = await mergeIOSCoverage(buildDir, [build.binaryPath, ...(build.frameworkBinaryPaths || [])], rawFilePaths);
    const data = await parseIOSCoverage(reportPath, path.extname(reportPath).toLowerCase());
    const incrementalCoverage = build.gitDiff ? await computeWeightedIncremental(reportPath, build.gitDiff) : undefined;
    return {
      lineCoverage: data.lineCoverage,
      functionCoverage: data.functionCoverage,
      branchCoverage: data.branchCoverage,
      incrementalCoverage,
      files: data.files || [],
      reportPath
    };
  }

  const androidResult = await mergeAndroidCoverage(buildDir, build.binaryPath, rawFilePaths);

  if (!androidResult.modules) {
    // 单仓库项目：老行为，零改动
    const reportPath = androidResult.reportPath;
    const data = await parseAndroidCoverage(reportPath, '.xml');
    const incrementalCoverage = build.gitDiff ? await computeWeightedIncremental(reportPath, build.gitDiff) : undefined;
    return {
      lineCoverage: data.lineCoverage,
      functionCoverage: data.functionCoverage,
      branchCoverage: data.branchCoverage,
      incrementalCoverage,
      files: data.files || [],
      reportPath
    };
  }

  // 多模块项目：每个模块各自的 XML 单独解析 + 单独算增量（按 build.moduleDiffs 里同名模块匹配），
  // 整体数字 / 文件列表是所有模块的聚合
  const moduleDiffMap = new Map((build.moduleDiffs || []).map(d => [d.module, d.diff]));
  const files: MergedFileCoverage[] = [];
  const moduleCoverages: MergedModuleCoverage[] = [];
  let totalLines = 0, weightedLine = 0, weightedFn = 0, weightedBranch = 0;
  let totalChanged = 0, weightedChangedCovered = 0;

  for (const m of androidResult.modules) {
    const data = await parseAndroidCoverage(m.xmlPath, '.xml');
    const moduleFiles = data.files || [];
    const moduleTotalLines = moduleFiles.reduce((s, f) => s + f.totalLines, 0);
    const moduleCoveredLines = moduleFiles.reduce((s, f) => s + f.coveredLines, 0);

    for (const f of moduleFiles) {
      files.push({ ...f, module: m.module });
    }

    let moduleIncremental: number | undefined;
    const moduleDiff = moduleDiffMap.get(m.module);
    if (moduleDiff) {
      moduleIncremental = await computeWeightedIncremental(m.xmlPath, moduleDiff);
      if (moduleIncremental !== undefined) {
        const incrementalFiles = await getIncrementalFiles(m.xmlPath, moduleDiff);
        const changed = incrementalFiles.reduce((s, f) => s + f.changedLines.length, 0);
        totalChanged += changed;
        weightedChangedCovered += moduleIncremental * changed;
      }
    }

    moduleCoverages.push({
      module: m.module,
      repositoryUrl: m.repositoryUrl,
      commitHash: m.commitHash,
      lineCoverage: data.lineCoverage,
      functionCoverage: data.functionCoverage,
      branchCoverage: data.branchCoverage,
      incrementalCoverage: moduleIncremental,
      totalLines: moduleTotalLines,
      coveredLines: moduleCoveredLines,
      reportPath: m.xmlPath
    });

    totalLines += moduleTotalLines;
    weightedLine += data.lineCoverage * moduleTotalLines;
    weightedFn += data.functionCoverage * moduleTotalLines;
    weightedBranch += data.branchCoverage * moduleTotalLines;
  }

  return {
    lineCoverage: totalLines > 0 ? parseFloat((weightedLine / totalLines).toFixed(2)) : 0,
    functionCoverage: totalLines > 0 ? parseFloat((weightedFn / totalLines).toFixed(2)) : 0,
    branchCoverage: totalLines > 0 ? parseFloat((weightedBranch / totalLines).toFixed(2)) : 0,
    incrementalCoverage: totalChanged > 0 ? parseFloat((weightedChangedCovered / totalChanged).toFixed(2)) : undefined,
    files,
    moduleCoverages,
    reportPath: androidResult.reportPath
  };
}

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

        // 4. 从 IPA 中提取 Mach-O binary + Frameworks/ 下所有嵌入的动态 framework 二进制
        //    （组件以独立动态 framework 形式集成时，覆盖率映射数据在它自己的二进制里，
        //    不在主 App 二进制里——跟主上传接口走的是同一套提取逻辑，见 extractFrameworkBinaries）
        pgyerTasks.set(taskId, { status: 'extracting', filename });
        const ipaExtractDir = path.join(buildDir, 'ipa_extracted');
        const machoBinaryPath = await extractBinaryFromIPA(ipaPath, ipaExtractDir);
        const appDir = path.dirname(machoBinaryPath);
        const extractedFrameworkBinaries = extractFrameworkBinaries(appDir);

        // 复制主 binary 到 binary 目录
        const binaryName = path.basename(machoBinaryPath);
        const permanentBinaryPath = path.join(binaryDir, binaryName);
        fs.copyFileSync(machoBinaryPath, permanentBinaryPath);

        // framework 二进制各自复制到 binary/Frameworks/ 下保留
        let frameworkBinaryPaths: string[] | undefined;
        if (extractedFrameworkBinaries.length > 0) {
          const frameworksOutDir = path.join(binaryDir, 'Frameworks');
          fs.mkdirSync(frameworksOutDir, { recursive: true });
          frameworkBinaryPaths = extractedFrameworkBinaries.map((fbPath) => {
            const frameworkName = path.basename(path.dirname(fbPath));
            const outDir = path.join(frameworksOutDir, frameworkName);
            fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, path.basename(fbPath));
            fs.copyFileSync(fbPath, outPath);
            return outPath;
          });
        }

        // 清理解压目录
        fs.rmSync(ipaExtractDir, { recursive: true, force: true });

        // 5. 创建 Build 记录
        const build = await mongoDb.createBuild({
          projectId,
          platform: 'ios',
          commitHash,
          buildKey: commitHash,
          branch,
          buildVersion,
          gitDiff,
          binaryPath: permanentBinaryPath,
          frameworkBinaryPaths,
          status: 'ready'
        });

        // 重命名目录以使用真实的 MongoDB _id
        const realBuildDir = path.join(__dirname, '../../builds', projectId, build.id);
        if (buildDir !== realBuildDir) {
          fs.renameSync(buildDir, realBuildDir);
          const realBinaryPath = path.join(realBuildDir, 'binary', binaryName);
          const updates: Partial<Build> = { binaryPath: realBinaryPath };
          build.binaryPath = realBinaryPath;
          if (frameworkBinaryPaths) {
            const realFrameworkBinaryPaths = frameworkBinaryPaths.map((fbPath) =>
              fbPath.replace(buildDir, realBuildDir)
            );
            updates.frameworkBinaryPaths = realFrameworkBinaryPaths;
            build.frameworkBinaryPaths = realFrameworkBinaryPaths;
          }
          await mongoDb.updateBuild(build.id, updates);
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
    // buildKey 是组件化项目用的"构建身份"（壳工程 commit + 所有组件 commit 的复合指纹），
    // 不传就默认等于 commitHash——非组件化项目完全不受影响，行为跟之前一样
    const buildKey: string = req.body.buildKey || commitHash;

    // 组件化项目：壳工程仓库拉不到的文件，按这份清单依次尝试各组件自己的仓库 + commit。
    // JSON 字符串形式传（multipart 表单字段都是字符串），格式见 compute_build_key.sh 同目录下
    // extract_component_repos.sh 的输出
    let componentRepos: { name: string; repositoryUrl: string; commitHash: string }[] | undefined;
    if (req.body.componentRepos) {
      try {
        const parsed = JSON.parse(req.body.componentRepos);
        if (Array.isArray(parsed)) {
          componentRepos = parsed.filter(
            (c) => c && typeof c.name === 'string' && typeof c.repositoryUrl === 'string' && typeof c.commitHash === 'string'
          );
        }
      } catch {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: 'Invalid componentRepos JSON' });
      }
    }

    // 多仓库组件化项目（目前只有 Android Gradle 多模块 + Maven AAR 用）：按模块拆分的 git diff，
    // JSON 字符串形式传，跟 classfiles.zip 里 manifest.json 列出的 module 名一一对应——
    // 上传时用同一份 merged.exec 对每个模块的 class 目录各跑一次 jacococli report，
    // 再用这里对应模块的 diff 算这个模块自己的增量覆盖率，最后按行数加权聚合成整体数字
    let moduleDiffs: { module: string; diff: string }[] | undefined;
    if (req.body.moduleDiffs) {
      try {
        const parsed = JSON.parse(req.body.moduleDiffs);
        if (Array.isArray(parsed)) {
          moduleDiffs = parsed.filter(
            (d) => d && typeof d.module === 'string' && typeof d.diff === 'string'
          );
        }
      } catch {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: 'Invalid moduleDiffs JSON' });
      }
    }

    // 原始的 build-fingerprint.json，纯存档/排查用（构建身份匹配始终走 buildKey，
    // 不重新解析这个字段），允许传任意 JSON 字符串，格式不做强校验
    const buildFingerprint: string | undefined = req.body.buildFingerprint;

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

    // iOS 统一只接受 .ipa，不再支持直传裸 Mach-O 二进制——组件大多以独立动态 framework
    // 形式集成（CocoaPods 默认就是这种），覆盖率映射数据在组件自己的二进制里，只传主二进制
    // 拿不到 Frameworks/ 目录，组件源码永远不会出现在覆盖率报告里（见接入文档 13 节 Q11）
    if (project.platform === 'ios' && !req.file.originalname.endsWith('.ipa')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'iOS Build creation requires a full .ipa, not a raw binary. ' +
          'Package your .app into Payload/YourApp.app and zip it as .ipa before uploading ' +
          '(see ios-coverage/接入文档.md section 10.1).'
      });
    }

    // 同一个构建身份可能被 CI 重复构建多次（比如重新打包、换签名，或组件化项目组件升级），
    // 按 (projectId, buildKey) 复用已有 Build，而不是每次都新建一条、产生新的 buildId——
    // 这样 App 侧只要知道 buildKey（编译时打包进 bundle，不需要手动维护 buildId）就能找到正确的 Build。
    const existingBuild = await mongoDb.getBuildByProjectAndKey(projectId, buildKey);

    const buildId = existingBuild
      ? existingBuild.id
      : uuidv4().replace(/-/g, '').substring(0, 24);

    // 创建 Build 目录结构
    const buildDir = path.join(__dirname, '../../builds', projectId, buildId);
    const binaryDir = path.join(buildDir, 'binary');
    const rawDir = path.join(buildDir, 'raw');
    const mergedDir = path.join(buildDir, 'merged');

    if (existingBuild) {
      // 复用已有 Build：旧的二进制、原始上传、合并结果都对应不上新二进制了，全部清空重来
      fs.rmSync(binaryDir, { recursive: true, force: true });
      fs.rmSync(rawDir, { recursive: true, force: true });
      fs.rmSync(mergedDir, { recursive: true, force: true });
      if (existingBuild.mergedReportId) {
        await mongoDb.deleteFileCoveragesByReport(existingBuild.mergedReportId);
        await mongoDb.deleteReport(existingBuild.mergedReportId);
      }
    }
    fs.mkdirSync(binaryDir, { recursive: true });
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(mergedDir, { recursive: true });

    // 移动 binary 到永久位置
    let permanentBinaryPath = path.join(binaryDir, req.file.originalname);
    moveFile(req.file.path, permanentBinaryPath);

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

    // iOS：自动解压 .ipa，主二进制 + Frameworks/ 下所有嵌入的动态 framework 二进制都拿出来。
    // 以独立动态 framework 形式集成的组件（不是静态库），覆盖率映射数据在它自己的二进制里，
    // 不在主 App 二进制里——llvm-cov 需要同时拿到这些二进制才能解析出组件自己的源码覆盖率
    let frameworkBinaryPaths: string[] | undefined;
    if (project.platform === 'ios') {
      const ipaExtractDir = path.join(buildDir, 'ipa-extract');
      try {
        const mainBinaryPath = await extractBinaryFromIPA(permanentBinaryPath, ipaExtractDir);
        const appDir = path.dirname(mainBinaryPath);
        const extractedFrameworkBinaries = extractFrameworkBinaries(appDir);

        // 主二进制复制到 binary/ 目录，替代原来的 .ipa 作为 binaryPath
        const mainBinaryName = path.basename(mainBinaryPath);
        const permanentMainBinaryPath = path.join(binaryDir, mainBinaryName);
        fs.copyFileSync(mainBinaryPath, permanentMainBinaryPath);
        fs.unlinkSync(permanentBinaryPath); // 删掉原始 .ipa，不需要再保留
        permanentBinaryPath = permanentMainBinaryPath;

        // framework 二进制各自复制到 binary/Frameworks/ 下保留
        if (extractedFrameworkBinaries.length > 0) {
          const frameworksOutDir = path.join(binaryDir, 'Frameworks');
          fs.mkdirSync(frameworksOutDir, { recursive: true });
          frameworkBinaryPaths = extractedFrameworkBinaries.map((fbPath) => {
            const frameworkName = path.basename(path.dirname(fbPath)); // e.g. FlipBook.framework
            const outDir = path.join(frameworksOutDir, frameworkName);
            fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, path.basename(fbPath));
            fs.copyFileSync(fbPath, outPath);
            return outPath;
          });
        }
      } catch (e) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        return res.status(400).json({
          success: false,
          message: 'Failed to extract binaries from .ipa',
          error: (e as Error).message
        });
      } finally {
        fs.rmSync(ipaExtractDir, { recursive: true, force: true });
      }
    }

    // 创建或更新 Build 记录
    let build: Build;
    if (existingBuild) {
      const updated = await mongoDb.updateBuild(buildId, {
        commitHash,
        branch,
        buildVersion,
        gitDiff,
        componentRepos,
        moduleDiffs,
        buildFingerprint,
        binaryPath: permanentBinaryPath,
        frameworkBinaryPaths,
        status: 'ready',
        rawUploadCount: 0,
        mergedReportId: undefined,
        lastMergedAt: undefined,
        errorMessage: undefined
      } as Partial<Build>);
      if (!updated) {
        return res.status(500).json({ success: false, message: 'Failed to update existing build' });
      }
      build = updated;
    } else {
      build = await mongoDb.createBuild({
        projectId,
        platform: project.platform,
        commitHash,
        buildKey,
        branch,
        buildVersion,
        gitDiff,
        componentRepos,
        moduleDiffs,
        buildFingerprint,
        binaryPath: permanentBinaryPath,
        frameworkBinaryPaths,
        status: 'ready'
      });
    }

    // 重命名目录以使用真实的 MongoDB _id
    const realBuildDir = path.join(__dirname, '../../builds', projectId, build.id);
    if (buildDir !== realBuildDir) {
      fs.renameSync(buildDir, realBuildDir);
      // 更新 binaryPath（用实际文件名，不是原始上传文件名——.ipa 上传时实际二进制文件名
      // 是解压出来的可执行文件名，跟原始 .ipa 文件名不一样）
      const realBinaryPath = path.join(realBuildDir, 'binary', path.basename(permanentBinaryPath));
      const updates: Partial<Build> = { binaryPath: realBinaryPath };
      build.binaryPath = realBinaryPath;

      if (frameworkBinaryPaths && frameworkBinaryPaths.length > 0) {
        const realFrameworkBinaryPaths = frameworkBinaryPaths.map((fbPath) =>
          fbPath.replace(buildDir, realBuildDir)
        );
        updates.frameworkBinaryPaths = realFrameworkBinaryPaths;
        build.frameworkBinaryPaths = realFrameworkBinaryPaths;
      }

      await mongoDb.updateBuild(build.id, updates);
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

    if (build.status === 'error') {
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
    moveFile(req.file.path, permanentPath);

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
        // 标记为合并中，让客户端感知进度
        await mongoDb.updateBuild(buildId, { status: 'processing' } as any);

        // 获取所有原始文件路径
        const allRawUploads = await mongoDb.getRawUploadsByBuild(buildId);
        const rawFilePaths = allRawUploads
          .filter(r => fs.existsSync(r.filePath))
          .map(r => r.filePath);

        if (rawFilePaths.length === 0) {
          throw new Error('No valid raw files found for merge');
        }

        // 执行转换 + 解析（单仓库 / 多模块都走这一个函数，多模块时已经聚合好整体数字）
        const merged = await mergeAndComputeCoverage(build, buildDir, rawFilePaths);
        const reportPath = merged.reportPath;
        const coverageData = merged;

        // 创建或更新 CoverageReport
        if (build.mergedReportId) {
          // 更新已有报告
          await mongoDb.deleteFileCoveragesByReport(build.mergedReportId);
          await mongoDb.updateReport(build.mergedReportId, {
            lineCoverage: merged.lineCoverage,
            functionCoverage: merged.functionCoverage,
            branchCoverage: merged.branchCoverage,
            incrementalCoverage: merged.incrementalCoverage,
            moduleCoverages: merged.moduleCoverages,
            reportPath
          });

          // 重新添加文件覆盖率
          for (const file of merged.files) {
            await mongoDb.addFileCoverage({
              reportId: build.mergedReportId,
              filePath: file.filePath,
              lineCoverage: file.lineCoverage,
              totalLines: file.totalLines,
              coveredLines: file.coveredLines,
              module: file.module
            });
          }

          coverageResult = coverageData;
        } else {
          // 创建新报告
          const report = await mongoDb.createReport({
            projectId: build.projectId,
            commitHash: build.commitHash,
            branch: build.branch,
            lineCoverage: merged.lineCoverage,
            functionCoverage: merged.functionCoverage,
            branchCoverage: merged.branchCoverage,
            incrementalCoverage: merged.incrementalCoverage,
            moduleCoverages: merged.moduleCoverages,
            gitDiff: build.gitDiff,
            reportPath,
            buildId: build.id,
            source: 'auto'
          });

          // 添加文件覆盖率
          for (const file of merged.files) {
            await mongoDb.addFileCoverage({
              reportId: report.id,
              filePath: file.filePath,
              lineCoverage: file.lineCoverage,
              totalLines: file.totalLines,
              coveredLines: file.coveredLines,
              module: file.module
            });
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
// GET /api/builds/resolve?projectId=&commitHash= — SDK 按 commitHash 查找 buildId
//
// CI 编译时把 commitHash 打进 App bundle（iOS: CoverageInfo.plist / Android: BuildConfig），
// SDK 运行时读出来调这个接口换成 buildId，不需要手动把 buildId 复制进源码。
// 404 说明 CI 还没有为这个 commit 调用过 POST /api/builds 创建 Build（没有匹配的编译产物可用于
// 解析覆盖率），SDK 应该跳过这次上传，而不是报错重试。
// =====================================================
router.get('/resolve', async (req: Request, res: Response) => {
  try {
    // 查询参数名仍然叫 commitHash（兼容现有 SDK，不需要改 App 端代码），但匹配的是 Build 的
    // buildKey 字段——非组件化项目 buildKey 默认等于 commitHash，效果完全一样；组件化项目这里传的
    // 实际是 CI 算出来的复合指纹（SDK 从 bundle 里读到什么值就原样传什么值，不需要关心语义）
    const { projectId, commitHash: buildKey } = req.query;
    if (!projectId || !buildKey) {
      return res.status(400).json({
        success: false,
        message: 'Missing required query params: projectId, commitHash'
      });
    }

    const build = await mongoDb.getBuildByProjectAndKey(projectId as string, buildKey as string);
    if (!build) {
      return res.status(404).json({
        success: false,
        message: 'No build found for this commit. Make sure CI called POST /api/builds for this commitHash first.'
      });
    }

    res.json({ success: true, data: { buildId: build.id } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to resolve build',
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
        // 合并 + 解析（单仓库 / 多模块都走这一个函数，跟 raw-coverage 上传流程保持一致）
        const merged = await mergeAndComputeCoverage(build, buildDir, rawFilePaths);
        const reportPath = merged.reportPath;

        if (build.mergedReportId) {
          await mongoDb.deleteFileCoveragesByReport(build.mergedReportId);
          await mongoDb.updateReport(build.mergedReportId, {
            lineCoverage: merged.lineCoverage,
            functionCoverage: merged.functionCoverage,
            branchCoverage: merged.branchCoverage,
            incrementalCoverage: merged.incrementalCoverage,
            moduleCoverages: merged.moduleCoverages,
            reportPath
          });

          for (const file of merged.files) {
            await mongoDb.addFileCoverage({
              reportId: build.mergedReportId,
              filePath: file.filePath,
              lineCoverage: file.lineCoverage,
              totalLines: file.totalLines,
              coveredLines: file.coveredLines,
              module: file.module
            });
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
