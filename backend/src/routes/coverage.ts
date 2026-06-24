import { Router, Request, Response } from 'express';
import { mongoDb } from '../models/database';
import { getFileLineCoverage, getReportFiles, getIncrementalFiles } from '../utils/coverageParser';
import { parseRepositoryUrl, buildRawFileRequest } from '../utils/gitProvider';
import https from 'https';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { CoverageReport } from '../types';

const router = Router();

interface IncrementalFileWithModule {
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
  changedLines: number[];
  incrementalCoverage: number;
  module: string;
}

// 多模块组件化报告（report.moduleCoverages 有值）没有单一的 report.gitDiff——diff 是
// Build.moduleDiffs 按模块拆开存的。这个函数把"按模块算增量文件列表"统一封装一下：
// 对每个模块，用它自己的 reportPath（moduleCoverages[].reportPath）+ 自己的 diff 文件内容
// 调 getIncrementalFiles，结果打上 module 标签后拼成一个列表，跟单仓库的返回形状保持一致
async function getIncrementalFilesForMultiModuleReport(
  report: CoverageReport
): Promise<IncrementalFileWithModule[]> {
  if (!report.buildId || !report.moduleCoverages) return [];

  const build = await mongoDb.getBuildById(report.buildId);
  if (!build?.moduleDiffs) return [];

  const moduleReportPaths = new Map(report.moduleCoverages.map(m => [m.module, m.reportPath]));

  const results: IncrementalFileWithModule[] = [];
  for (const d of build.moduleDiffs) {
    const moduleReportPath = moduleReportPaths.get(d.module);
    if (!moduleReportPath || !fs.existsSync(d.diffPath)) continue;
    const diffContent = fs.readFileSync(d.diffPath, 'utf-8');
    const moduleFiles = await getIncrementalFiles(moduleReportPath, diffContent);
    for (const f of moduleFiles) {
      results.push({ ...f, module: d.module });
    }
  }
  return results;
}

// 批量获取多个项目的最新覆盖率报告（必须在 /project/:projectId 之前注册）
router.get('/project/latest-batch', async (req: Request, res: Response) => {
  try {
    const ids = req.query.ids as string;
    if (!ids) {
      return res.status(400).json({
        success: false,
        message: 'Query parameter "ids" is required (comma-separated project IDs)'
      });
    }

    const projectIds = ids.split(',').filter(id => id.trim());
    const reports = await mongoDb.getLatestReportsByProjects(projectIds);
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch latest reports batch',
      error: (error as Error).message
    });
  }
});

// 获取项目的所有覆盖率报告
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;

    // 检查项目是否存在
    const project = await mongoDb.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const reports = await mongoDb.getReportsByProject(projectId);
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
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const report = await mongoDb.getReportById(id);

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

// 获取报告的增量覆盖率文件（自动使用存储的 gitDiff）
router.get('/:id/incremental', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    // 检查报告是否存在
    const report = await mongoDb.getReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Coverage report not found'
      });
    }

    // 多模块组件化报告没有单一的 report.gitDiff，diff 按模块拆在 Build.moduleDiffs 里，
    // 走单独的多模块增量计算；单仓库报告走老路径，不受影响
    let files;
    if (report.moduleCoverages && report.moduleCoverages.length > 0) {
      files = await getIncrementalFilesForMultiModuleReport(report);
      if (files.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No module diff content stored for this report'
        });
      }
    } else {
      if (!report.gitDiff) {
        return res.status(404).json({
          success: false,
          message: 'No git diff content stored for this report'
        });
      }
      if (!report.reportPath) {
        return res.status(404).json({
          success: false,
          message: 'Report file not found'
        });
      }
      files = await getIncrementalFiles(report.reportPath, report.gitDiff);
    }

    const totalChangedLines = files.reduce((sum, f) => sum + (f.changedLines?.length || 0), 0);
    // 按变更行数加权平均，避免小文件高覆盖率拉高整体数字
    const averageIncrementalCoverage = totalChangedLines > 0
      ? parseFloat(
          (files.reduce((sum, f) => sum + (f.incrementalCoverage || 0) * (f.changedLines?.length || 0), 0) / totalChangedLines).toFixed(2)
        )
      : 0;
    res.json({
      success: true,
      data: files,
      summary: {
        totalFiles: files.length,
        totalChangedLines,
        averageIncrementalCoverage
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

// 获取最新覆盖率报告
router.get('/project/:projectId/latest', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;

    // 检查项目是否存在
    const project = await mongoDb.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const report = await mongoDb.getLatestReport(projectId);
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
router.get('/project/:projectId/trend', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const days = parseInt(req.query.days as string) || 30;

    // 检查项目是否存在
    const project = await mongoDb.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const reports = await mongoDb.getCoverageTrend(projectId, days);
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
router.get('/project/:projectId/summary', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;

    // 检查项目是否存在
    const project = await mongoDb.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const summary = await mongoDb.getCoverageSummary(projectId);
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
    const id = req.params.id;

    // 检查报告是否存在
    const report = await mongoDb.getReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Coverage report not found'
      });
    }

    // 优先从数据库获取文件覆盖率数据
    const dbFiles = await mongoDb.getFileCoveragesByReport(id);
    if (dbFiles && dbFiles.length > 0) {
      return res.json({ success: true, data: dbFiles });
    }

    // 数据库没有则从报告文件解析
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
    const id = req.params.id;
    const { diffContent } = req.body;

    if (!diffContent) {
      return res.status(400).json({
        success: false,
        message: 'Git diff content is required in request body'
      });
    }

    // 检查报告是否存在
    const report = await mongoDb.getReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Coverage report not found'
      });
    }

    // 多模块组件化报告：report.reportPath 只是第一个模块的报告，贴的这一份 diff 可能
    // 跨多个模块的文件——对每个模块自己的 reportPath 都跑一遍 getIncrementalFiles，
    // 文件路径不属于这个模块的天然匹配不上（getIncrementalFiles 内部按文件名做匹配），
    // 合并结果时打上 module 标签，跟 GET /:id/incremental 的多模块分支保持一致的处理方式
    let files;
    if (report.moduleCoverages && report.moduleCoverages.length > 0) {
      // 同一份 diff 对每个模块各跑一遍——如果两个模块各自有一个同路径的文件（比如 Android
      // 多模块下每个模块都会自动生成一份 BuildConfig.java），getIncrementalFiles 按文件名/
      // 路径做匹配，会在两个模块里都命中同一条 diff，重复计入变更行数。按 filePath 去重，
      // 只保留第一次命中的（这只是个尽量准的兜底——精确的按模块归属拆分应该用创建 Build 时的
      // diffs.zip/moduleDiffs 机制，这里贴单份 diff 本身就是近似工具）
      const seenFilePaths = new Set<string>();
      files = [];
      for (const m of report.moduleCoverages) {
        if (!m.reportPath) continue;
        const moduleFiles = await getIncrementalFiles(m.reportPath, diffContent);
        for (const f of moduleFiles) {
          if (seenFilePaths.has(f.filePath)) continue;
          seenFilePaths.add(f.filePath);
          files.push({ ...f, module: m.module });
        }
      }
    } else {
      if (!report.reportPath) {
        return res.status(404).json({
          success: false,
          message: 'Report file not found'
        });
      }
      files = await getIncrementalFiles(report.reportPath, diffContent);
    }

    // 按变更行数加权平均，跟 GET /:id/incremental、computeWeightedIncremental 保持一致——
    // 之前这里是按文件数量直接平均，一个全覆盖的小文件和一个大量未覆盖的大文件权重相同，
    // 跟报告里实际存的、其它接口算出来的数字不是一个口径
    const totalChangedLines = files.reduce((sum, f) => sum + f.changedLines.length, 0);
    const averageIncrementalCoverage = totalChangedLines > 0
      ? parseFloat(
          (files.reduce((sum, f) => sum + f.incrementalCoverage * f.changedLines.length, 0) / totalChangedLines).toFixed(2)
        )
      : 0;

    res.json({
      success: true,
      data: files,
      summary: {
        totalFiles: files.length,
        totalChangedLines,
        averageIncrementalCoverage
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
    const id = req.params.id;
    const filePath = req.query.path as string;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'File path is required (query param: path)'
      });
    }

    // 检查报告是否存在
    const report = await mongoDb.getReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Coverage report not found'
      });
    }

    // 优先从数据库获取行级覆盖率数据
    const dbFile = await mongoDb.getFileCoverageByReportAndPath(id, filePath);
    if (dbFile && dbFile.lines && dbFile.lines.length > 0) {
      return res.json({
        success: true,
        data: {
          filePath,
          lines: dbFile.lines
        }
      });
    }

    // 多模块项目：这个文件属于哪个模块，就必须用那个模块自己的 JaCoCo XML 去查行级覆盖率——
    // report.reportPath 顶层只是第一个模块的报告，其它模块的文件在里面是查不到的
    const moduleReportPath = dbFile?.module
      ? report.moduleCoverages?.find(m => m.module === dbFile.module)?.reportPath
      : undefined;
    const targetReportPath = moduleReportPath || report.reportPath;

    // 数据库没有则从报告文件解析
    if (!targetReportPath) {
      return res.status(404).json({
        success: false,
        message: 'Report file not found'
      });
    }

    const fileCoverage = await getFileLineCoverage(targetReportPath, filePath);

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

// 获取文件的增量行级覆盖率详情（只包含变更行的高亮）
router.get('/:id/file/incremental', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const filePath = req.query.path as string;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'File path is required (query param: path)'
      });
    }

    // 检查报告是否存在
    const report = await mongoDb.getReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Coverage report not found'
      });
    }

    // 多模块组件化报告：这个文件属于哪个模块，就要用那个模块自己的 reportPath + 自己的
    // diff（Build.moduleDiffs 里按模块拆开存的），不能直接用报告顶层的 reportPath/gitDiff——
    // 顶层 reportPath 只是第一个模块的报告，顶层 gitDiff 对组件化报告压根没有设置
    let targetReportPath = report.reportPath;
    let diffContent = report.gitDiff;
    if (report.moduleCoverages && report.moduleCoverages.length > 0) {
      const dbFile = await mongoDb.getFileCoverageByReportAndPath(id, filePath);
      const moduleName = dbFile?.module;
      const moduleEntry = moduleName
        ? report.moduleCoverages.find(m => m.module === moduleName)
        : undefined;
      targetReportPath = moduleEntry?.reportPath || report.reportPath;

      if (moduleName && report.buildId) {
        const build = await mongoDb.getBuildById(report.buildId);
        const moduleDiff = build?.moduleDiffs?.find(d => d.module === moduleName);
        if (moduleDiff && fs.existsSync(moduleDiff.diffPath)) {
          diffContent = fs.readFileSync(moduleDiff.diffPath, 'utf-8');
        } else {
          diffContent = undefined;
        }
      }
    }

    if (!targetReportPath) {
      return res.status(404).json({
        success: false,
        message: 'Report file not found'
      });
    }

    // 检查是否有 diff 内容
    if (!diffContent) {
      return res.status(404).json({
        success: false,
        message: 'No git diff content stored for this report'
      });
    }

    // 解析 git diff 获取该文件的变更行号
    const { parseGitDiff } = await import('../utils/coverageParser');
    const diffFiles = parseGitDiff(diffContent);
    const diffFile = diffFiles.find(f => {
      if (filePath === f.filePath) return true;
      if (f.filePath.endsWith('/' + filePath)) return true;
      if (filePath.endsWith('/' + f.filePath)) return true;
      const fBasename = f.filePath.split('/').pop();
      const queryBasename = filePath.split('/').pop();
      if (fBasename === queryBasename) return true;
      if (filePath.replace(/\//g, '.').endsWith(f.filePath.replace(/\//g, '.'))) return true;
      return false;
    });

    if (!diffFile) {
      return res.status(404).json({
        success: false,
        message: 'File not found in git diff'
      });
    }

    // 获取行级覆盖率，传入变更行号
    const fileCoverage = await getFileLineCoverage(targetReportPath, filePath, diffFile.changedLines);

    if (!fileCoverage) {
      return res.status(404).json({
        success: false,
        message: 'File not found in coverage report'
      });
    }

    // 计算增量覆盖率统计
    const changedLines = fileCoverage.lines.filter(l => l.isChanged);
    const coveredChangedLines = changedLines.filter(l => l.isCovered).length;
    const totalChangedLines = changedLines.length;
    const incrementalCoverage = totalChangedLines > 0
      ? parseFloat(((coveredChangedLines / totalChangedLines) * 100).toFixed(2))
      : 0;

    res.json({
      success: true,
      data: {
        ...fileCoverage,
        incrementalSummary: {
          totalChangedLines,
          coveredChangedLines,
          incrementalCoverage,
          changedLineNumbers: diffFile.changedLines
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incremental file coverage',
      error: (error as Error).message
    });
  }
});

// 获取源码文件内容（从 GitHub raw API）
// 依次跟随重定向请求一个 raw 文件 URL
function fetchRawFile(url: string, headers: Record<string, string>, providerLabel: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const makeRequest = (reqUrl: string, redirectCount: number = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      try {
        new URL(reqUrl); // 校验 URL 合法性
      } catch {
        reject(new Error(`Invalid URL: ${reqUrl}`));
        return;
      }
      const client = reqUrl.startsWith('https') ? https : http;
      client.get(reqUrl, { headers }, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          makeRequest(response.headers.location, redirectCount + 1);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`${providerLabel} returned ${response.statusCode}`));
          return;
        }
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
        response.on('error', reject);
      }).on('error', reject);
    };
    makeRequest(url);
  });
}

// 给定一个仓库（壳工程或某个组件）+ commit，依次尝试各平台常见的源码路径前缀去拉文件，
// 命中返回内容，全部失败返回 null（不抛错——调用方还要接着试下一个仓库）
async function fetchSourceFromRepo(
  repositoryUrl: string,
  commitHash: string,
  filePath: string,
  platform: string,
  accessToken: string | undefined,
  reportPathForPythonSniff: string | undefined
): Promise<{ content: string; pathCandidates: string[] } | null> {
  const parsedRepo = parseRepositoryUrl(repositoryUrl);
  if (!parsedRepo) return null;
  const { repo } = parsedRepo;

  // LCOV 中 iOS 文件路径可能是绝对路径，需转为相对路径
  // 例如 /Users/xxx/Desktop/CodeCoverageDemo/CodeCoverageDemo/ViewController.m
  // 需要基于 repo 名提取相对路径: CodeCoverageDemo/ViewController.m
  let normalizedPath = filePath;
  if (path.isAbsolute(filePath)) {
    const parts = filePath.split('/');
    const repoIdx = parts.findIndex(p => p === repo);
    if (repoIdx >= 0 && repoIdx < parts.length - 1) {
      normalizedPath = parts.slice(repoIdx + 1).join('/');
    } else {
      normalizedPath = parts.slice(-2).join('/');
    }
  }

  // 尝试多个路径前缀（JaCoCo 使用包路径，需要映射到项目源码路径）
  const pathCandidates = [normalizedPath];
  if (platform === 'android') {
    const prefixes = [
      'app/src/main/java/',
      'app/src/main/kotlin/',
      'src/main/java/',
      'src/main/kotlin/',
    ];
    for (const prefix of prefixes) {
      if (!normalizedPath.startsWith(prefix)) {
        pathCandidates.push(prefix + normalizedPath);
      }
    }
  } else if (platform === 'ios') {
    const prefixes = ['Sources/', 'src/'];
    for (const prefix of prefixes) {
      if (!normalizedPath.startsWith(prefix)) {
        pathCandidates.push(prefix + normalizedPath);
      }
    }
  } else if (platform === 'python') {
    const prefixes = ['src/', 'lib/', 'app/'];
    for (const prefix of prefixes) {
      if (!normalizedPath.startsWith(prefix)) {
        pathCandidates.push(prefix + normalizedPath);
      }
    }
    // 也尝试从 Cobertura XML 的 <source> 元素推断相对路径
    // 例如 <source>/tmp/project/src</source> + filename="calculator.py" => src/calculator.py
    if (reportPathForPythonSniff) {
      try {
        const fs = await import('fs');
        const head = fs.readFileSync(reportPathForPythonSniff, 'utf-8').substring(0, 2000);
        const sourceMatch = head.match(/<source>([^<]+)<\/source>/);
        if (sourceMatch) {
          const sourcePath = sourceMatch[1];
          const repoIdx = sourcePath.indexOf(repo);
          if (repoIdx >= 0) {
            const relativeRoot = sourcePath.substring(repoIdx + repo.length + 1);
            if (relativeRoot) {
              const candidateFromSource = relativeRoot + '/' + normalizedPath;
              if (!pathCandidates.includes(candidateFromSource)) {
                pathCandidates.unshift(candidateFromSource);
              }
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  for (const candidate of pathCandidates) {
    const { url: rawUrl, headers } = buildRawFileRequest(parsedRepo, commitHash, candidate, accessToken);
    try {
      const content = await fetchRawFile(rawUrl, headers, parsedRepo.provider);
      return { content, pathCandidates };
    } catch {
      continue;
    }
  }
  return null;
}

router.get('/:id/source', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const filePath = req.query.path as string;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'File path is required (query param: path)'
      });
    }

    // 获取报告和项目信息
    const report = await mongoDb.getReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Coverage report not found'
      });
    }

    const project = await mongoDb.getProjectById(report.projectId);
    if (!project || !project.repositoryUrl) {
      return res.status(404).json({
        success: false,
        message: 'Project repository URL not configured'
      });
    }

    const commitHash = report.commitHash;

    // 先试壳工程仓库
    const shellResult = await fetchSourceFromRepo(
      project.repositoryUrl, commitHash, filePath, project.platform, project.accessToken, report.reportPath
    );
    if (shellResult) {
      return res.json({
        success: true,
        data: { filePath, content: shellResult.content, commitHash }
      });
    }

    // 壳工程仓库没找到，按 Build 上记录的 componentRepos 依次试组件仓库。
    // accessToken 只在组件仓库跟壳工程仓库同域名（同一个 Git 平台实例）时才复用——
    // 不同域名说明组件托管在别的平台/账号下，壳工程的 token 对那边无意义，传过去反而有害：
    // 比如 GitHub raw 内容接口收到一个外部/无效的 Authorization 头，会把请求当成"已认证但权限
    // 不足"处理，对本来公开可访问的仓库返回 404，而不是忽略这个头当匿名请求处理（实测验证过）。
    const shellParsed = parseRepositoryUrl(project.repositoryUrl);
    let triedRepos = [project.repositoryUrl];
    if (report.buildId) {
      const build = await mongoDb.getBuildById(report.buildId);
      if (build?.componentRepos) {
        for (const component of build.componentRepos) {
          const componentParsed = parseRepositoryUrl(component.repositoryUrl);
          const sameHost = shellParsed && componentParsed && shellParsed.host === componentParsed.host;
          const componentResult = await fetchSourceFromRepo(
            component.repositoryUrl, component.commitHash, filePath, project.platform,
            sameHost ? project.accessToken : undefined, undefined
          );
          triedRepos.push(component.repositoryUrl);
          if (componentResult) {
            return res.json({
              success: true,
              data: {
                filePath,
                content: componentResult.content,
                commitHash: component.commitHash,
                sourceRepo: component.name
              }
            });
          }
        }
      }
    }

    return res.status(404).json({
      success: false,
      message: `Source file not found in any registered repository (tried ${triedRepos.length}: ${triedRepos.join(', ')})`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch source code',
      error: (error as Error).message
    });
  }
});

// 删除覆盖率报告
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const success = await mongoDb.deleteReport(id);

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
