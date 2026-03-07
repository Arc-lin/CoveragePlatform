import { Router, Request, Response } from 'express';
import { mongoDb } from '../models/database';
import { getFileLineCoverage, getReportFiles, getIncrementalFiles } from '../utils/coverageParser';
import https from 'https';
import http from 'http';
import path from 'path';

const router = Router();

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

    // 检查是否有 gitDiff
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

    const files = await getIncrementalFiles(report.reportPath, report.gitDiff);
    res.json({
      success: true,
      data: files,
      summary: {
        totalFiles: files.length,
        totalChangedLines: files.reduce((sum, f) => sum + (f.changedLines?.length || 0), 0),
        averageIncrementalCoverage: files.length > 0
          ? parseFloat((files.reduce((sum, f) => sum + (f.incrementalCoverage || 0), 0) / files.length).toFixed(2))
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

    if (!report.reportPath) {
      return res.status(404).json({
        success: false,
        message: 'Report file not found'
      });
    }

    // 检查是否有 gitDiff
    if (!report.gitDiff) {
      return res.status(404).json({
        success: false,
        message: 'No git diff content stored for this report'
      });
    }

    // 解析 git diff 获取该文件的变更行号
    const { parseGitDiff } = await import('../utils/coverageParser');
    const diffFiles = parseGitDiff(report.gitDiff);
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
    const fileCoverage = await getFileLineCoverage(report.reportPath, filePath, diffFile.changedLines);

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

    // 解析 GitHub 仓库信息: https://github.com/{owner}/{repo}.git
    const repoUrl = project.repositoryUrl.replace(/\.git$/, '');
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      return res.status(400).json({
        success: false,
        message: 'Only GitHub repositories are supported. URL format: https://github.com/{owner}/{repo}'
      });
    }

    const [, owner, repo] = match;
    const commitHash = report.commitHash;

    // LCOV 中 iOS 文件路径可能是绝对路径，需转为相对路径
    // 例如 /Users/xxx/Desktop/CodeCoverageDemo/CodeCoverageDemo/ViewController.m
    // 需要基于 repo 名提取相对路径: CodeCoverageDemo/ViewController.m
    let normalizedPath = filePath;
    if (path.isAbsolute(filePath)) {
      const parts = filePath.split('/');
      // 查找 repo 名在路径中的位置，取其后面的部分作为相对路径
      const repoIdx = parts.findIndex(p => p === repo);
      if (repoIdx >= 0 && repoIdx < parts.length - 1) {
        normalizedPath = parts.slice(repoIdx + 1).join('/');
      } else {
        // 兜底：取最后两段作为相对路径
        normalizedPath = parts.slice(-2).join('/');
      }
    }

    // 尝试多个路径前缀（JaCoCo 使用包路径，需要映射到项目源码路径）
    const pathCandidates = [normalizedPath];
    if (project.platform === 'android') {
      // Android 项目常见源码路径前缀
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
    } else if (project.platform === 'ios') {
      // iOS 项目可能的路径前缀
      const prefixes = ['Sources/', 'src/'];
      for (const prefix of prefixes) {
        if (!normalizedPath.startsWith(prefix)) {
          pathCandidates.push(prefix + normalizedPath);
        }
      }
    } else if (project.platform === 'python') {
      // Python 项目常见源码路径前缀
      const prefixes = ['src/', 'lib/', 'app/'];
      for (const prefix of prefixes) {
        if (!normalizedPath.startsWith(prefix)) {
          pathCandidates.push(prefix + normalizedPath);
        }
      }
      // 也尝试从 Cobertura XML 的 <source> 元素推断相对路径
      // 例如 <source>/tmp/project/src</source> + filename="calculator.py" => src/calculator.py
      if (report.reportPath) {
        try {
          const fs = await import('fs');
          const head = fs.readFileSync(report.reportPath, 'utf-8').substring(0, 2000);
          const sourceMatch = head.match(/<source>([^<]+)<\/source>/);
          if (sourceMatch) {
            const sourcePath = sourceMatch[1];
            // 从 source 路径中提取 repo 相对部分
            // 例如 /tmp/python-coverage-demo/src -> 找到 repo 名后取剩余部分 -> src
            const repoIdx = sourcePath.indexOf(repo);
            if (repoIdx >= 0) {
              const relativeRoot = sourcePath.substring(repoIdx + repo.length + 1); // e.g. "src"
              if (relativeRoot) {
                const candidateFromSource = relativeRoot + '/' + normalizedPath;
                if (!pathCandidates.includes(candidateFromSource)) {
                  // 优先尝试这个路径
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

    // 依次尝试获取源码
    const fetchFromGitHub = (url: string): Promise<string> => {
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
          client.get(reqUrl, { headers: { 'User-Agent': 'CoveragePlatform' } }, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              makeRequest(response.headers.location, redirectCount + 1);
              return;
            }
            if (response.statusCode !== 200) {
              reject(new Error(`GitHub returned ${response.statusCode}`));
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
    };

    let sourceCode: string | null = null;
    for (const candidate of pathCandidates) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${commitHash}/${candidate}`;
      try {
        sourceCode = await fetchFromGitHub(rawUrl);
        break;
      } catch {
        continue;
      }
    }

    if (!sourceCode) {
      return res.status(404).json({
        success: false,
        message: `Source file not found. Tried paths: ${pathCandidates.join(', ')}`
      });
    }

    res.json({
      success: true,
      data: {
        filePath,
        content: sourceCode,
        commitHash
      }
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
