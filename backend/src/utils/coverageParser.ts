import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';

interface CoverageData {
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  incrementalCoverage?: number;
  files?: FileCoverageData[];
}

interface FileCoverageData {
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
}

/**
 * 解析 Android JaCoCo 覆盖率数据
 */
export async function parseAndroidCoverage(
  filePath: string,
  fileExt: string
): Promise<CoverageData> {
  switch (fileExt) {
    case '.xml':
      return parseJaCoCoXML(filePath);
    case '.exec':
    case '.ec':
      throw new Error(
        'JaCoCo binary format (.ec/.exec) is not directly supported. ' +
        'Please convert to XML first using: ' +
        'java -jar jacococli.jar report <exec-file> --classfiles <class-dir> --xml <output.xml>'
      );
    case '.info':
      return parseLCOV(filePath);
    default:
      throw new Error(`Unsupported Android coverage file format: ${fileExt}`);
  }
}

/**
 * 解析 iOS LLVM 覆盖率数据
 */
export async function parseIOSCoverage(
  filePath: string,
  fileExt: string
): Promise<CoverageData> {
  switch (fileExt) {
    case '.profraw':
    case '.profdata':
      throw new Error(
        'LLVM raw profile (.profraw/.profdata) is not directly supported. ' +
        'Please convert to LCOV first using: ' +
        'xcrun llvm-cov export -format=lcov -instr-profile <profdata-file> <binary> > coverage.info'
      );
    case '.info':
      return parseLCOV(filePath);
    default:
      throw new Error(`Unsupported iOS coverage file format: ${fileExt}`);
  }
}

/**
 * 解析 JaCoCo XML 报告
 */
async function parseJaCoCoXML(filePath: string): Promise<CoverageData> {
  const xmlContent = fs.readFileSync(filePath, 'utf-8');
  const result = await parseStringPromise(xmlContent);
  
  const report = result.report;
  if (!report) {
    throw new Error('Invalid JaCoCo XML format');
  }

  // 计算总体覆盖率
  let totalInstructions = 0;
  let coveredInstructions = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalMethods = 0;
  let coveredMethods = 0;
  
  const files: FileCoverageData[] = [];

  // 遍历所有包
  const packages = report.package || [];
  for (const pkg of packages) {
    const sourcefiles = pkg.sourcefile || [];
    
    for (const sourcefile of sourcefiles) {
      const fileName = sourcefile.$.name;
      const pkgName = pkg.$.name;
      const filePath = `${pkgName}/${fileName}`;
      
      // 解析行覆盖率
      const lines = sourcefile.line || [];
      let fileTotalLines = 0;
      let fileCoveredLines = 0;
      
      for (const line of lines) {
        const mi = parseInt(line.$.mi || 0);
        const ci = parseInt(line.$.ci || 0);
        
        if (mi + ci > 0) {
          fileTotalLines++;
          if (ci > 0) {
            fileCoveredLines++;
          }
        }
      }
      
      const fileLineCoverage = fileTotalLines > 0 
        ? (fileCoveredLines / fileTotalLines) * 100 
        : 0;
      
      files.push({
        filePath,
        lineCoverage: parseFloat(fileLineCoverage.toFixed(2)),
        totalLines: fileTotalLines,
        coveredLines: fileCoveredLines
      });
    }

    // 计算方法覆盖率
    const classes = pkg.class || [];
    for (const cls of classes) {
      const methods = cls.method || [];
      for (const method of methods) {
        const counter = method.counter?.find((c: any) => c.$.type === 'METHOD');
        if (counter) {
          totalMethods++;
          if (parseInt(counter.$.covered) > 0) {
            coveredMethods++;
          }
        }
      }
    }
  }

  // 从 counter 获取总体数据
  const counters = report.counter || [];
  for (const counter of counters) {
    const type = counter.$.type;
    const missed = parseInt(counter.$.missed);
    const covered = parseInt(counter.$.covered);
    
    switch (type) {
      case 'INSTRUCTION':
        totalInstructions = missed + covered;
        coveredInstructions = covered;
        break;
      case 'BRANCH':
        totalBranches = missed + covered;
        coveredBranches = covered;
        break;
    }
  }

  const lineCoverage = totalInstructions > 0 
    ? (coveredInstructions / totalInstructions) * 100 
    : 0;
  
  const branchCoverage = totalBranches > 0 
    ? (coveredBranches / totalBranches) * 100 
    : 0;
  
  const functionCoverage = totalMethods > 0 
    ? (coveredMethods / totalMethods) * 100 
    : 0;

  return {
    lineCoverage: parseFloat(lineCoverage.toFixed(2)),
    functionCoverage: parseFloat(functionCoverage.toFixed(2)),
    branchCoverage: parseFloat(branchCoverage.toFixed(2)),
    files
  };
}

/**
 * 解析 LCOV 格式覆盖率数据
 */
function parseLCOV(filePath: string): CoverageData {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  let totalLines = 0;
  let coveredLines = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  
  const files: FileCoverageData[] = [];
  let currentFile: FileCoverageData | null = null;
  
  for (const line of lines) {
    if (line.startsWith('SF:')) {
      // Source File
      if (currentFile) {
        currentFile.lineCoverage = currentFile.totalLines > 0
          ? parseFloat(((currentFile.coveredLines / currentFile.totalLines) * 100).toFixed(2))
          : 0;
        files.push(currentFile);
      }
      currentFile = {
        filePath: line.substring(3),
        lineCoverage: 0,
        totalLines: 0,
        coveredLines: 0
      };
    } else if (line.startsWith('DA:')) {
      // Line data: DA:lineNumber,hitCount
      const parts = line.substring(3).split(',');
      const lineNum = parseInt(parts[0]);
      const hitCount = parseInt(parts[1]);
      
      if (hitCount > 0) {
        coveredLines++;
        if (currentFile) currentFile.coveredLines++;
      }
      totalLines++;
      if (currentFile) currentFile.totalLines++;
    } else if (line.startsWith('FN:')) {
      // Function
      totalFunctions++;
    } else if (line.startsWith('FNDA:')) {
      // Function data: FNDA:hitCount,functionName
      const parts = line.substring(5).split(',');
      const hitCount = parseInt(parts[0]);
      
      if (hitCount > 0) {
        coveredFunctions++;
      }
    } else if (line.startsWith('BRDA:')) {
      // Branch data
      totalBranches++;
      const parts = line.substring(5).split(',');
      if (parts.length >= 4 && parts[3] !== '-' && parseInt(parts[3]) > 0) {
        coveredBranches++;
      }
    }
  }
  
  // 添加最后一个文件
  if (currentFile) {
    currentFile.lineCoverage = currentFile.totalLines > 0 
      ? parseFloat(((currentFile.coveredLines / currentFile.totalLines) * 100).toFixed(2))
      : 0;
    files.push(currentFile);
  }
  
  const lineCoverage = totalLines > 0 
    ? (coveredLines / totalLines) * 100 
    : 0;
  
  const functionCoverage = totalFunctions > 0 
    ? (coveredFunctions / totalFunctions) * 100 
    : 0;
  
  const branchCoverage = totalBranches > 0 
    ? (coveredBranches / totalBranches) * 100 
    : 0;

  return {
    lineCoverage: parseFloat(lineCoverage.toFixed(2)),
    functionCoverage: parseFloat(functionCoverage.toFixed(2)),
    branchCoverage: parseFloat(branchCoverage.toFixed(2)),
    files
  };
}

/**
 * 计算增量覆盖率
 * 
 * @param coverageData 全量覆盖率数据
 * @param diffData Git diff 解析后的变更数据
 */
export function calculateIncrementalCoverage(
  coverageData: CoverageData,
  diffData: { filePath: string; changedLines: number[] }[]
): number {
  if (!coverageData.files || coverageData.files.length === 0) {
    return 0;
  }

  let totalChangedLines = 0;
  let coveredChangedLines = 0;

  for (const diff of diffData) {
    const fileCoverage = coverageData.files.find(f => 
      f.filePath.endsWith(diff.filePath) || 
      diff.filePath.endsWith(f.filePath)
    );

    if (fileCoverage) {
      // 这里需要行级覆盖率数据来计算增量覆盖率
      // 简化处理：使用文件级覆盖率作为近似
      const fileChangedLines = diff.changedLines.length;
      const estimatedCovered = Math.round(
        fileChangedLines * (fileCoverage.lineCoverage / 100)
      );
      
      totalChangedLines += fileChangedLines;
      coveredChangedLines += estimatedCovered;
    } else {
      // 文件未被覆盖率统计，视为未覆盖
      totalChangedLines += diff.changedLines.length;
    }
  }

  return totalChangedLines > 0 
    ? parseFloat(((coveredChangedLines / totalChangedLines) * 100).toFixed(2))
    : 0;
}

/**
 * 判断报告文件是否为 LCOV 格式
 */
function isLCOVFormat(reportPath: string): boolean {
  if (reportPath.endsWith('.info')) return true;
  try {
    const head = fs.readFileSync(reportPath, 'utf-8').substring(0, 200);
    return head.includes('SF:') && head.includes('DA:');
  } catch {
    return false;
  }
}

/**
 * 获取文件的行级覆盖率详情
 * 用于前端代码展示，标记覆盖/未覆盖的行
 */
export async function getFileLineCoverage(
  reportPath: string,
  targetFile: string,
  changedLines?: number[]  // 可选：变更行号列表，用于标记变更行
): Promise<{
  filePath: string;
  lines: {
    lineNumber: number;
    isCovered: boolean;
    isChanged: boolean;  // 是否为变更行
    missedInstructions: number;
    coveredInstructions: number;
  }[];
} | null> {
  if (isLCOVFormat(reportPath)) {
    return getFileLineCoverageLCOV(reportPath, targetFile, changedLines);
  }
  return getFileLineCoverageXML(reportPath, targetFile, changedLines);
}

/**
 * LCOV 格式：获取文件的行级覆盖率详情
 */
function getFileLineCoverageLCOV(
  reportPath: string,
  targetFile: string,
  changedLines?: number[]
): {
  filePath: string;
  lines: {
    lineNumber: number;
    isCovered: boolean;
    isChanged: boolean;
    missedInstructions: number;
    coveredInstructions: number;
  }[];
} | null {
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    const lines = content.split('\n');

    let currentFile: string | null = null;
    let lineDetails: { lineNumber: number; isCovered: boolean; isChanged: boolean; missedInstructions: number; coveredInstructions: number }[] = [];
    let matched = false;

    for (const line of lines) {
      if (line.startsWith('SF:')) {
        // 如果上一个文件匹配，返回结果
        if (matched && currentFile) {
          return { filePath: currentFile, lines: lineDetails };
        }
        currentFile = line.substring(3);
        lineDetails = [];
        // 匹配逻辑：文件名后缀匹配
        matched = matchFilePath(currentFile, targetFile);
      } else if (line.startsWith('DA:') && matched) {
        const parts = line.substring(3).split(',');
        const lineNumber = parseInt(parts[0]);
        const hitCount = parseInt(parts[1]);
        lineDetails.push({
          lineNumber,
          isCovered: hitCount > 0,
          isChanged: changedLines ? changedLines.includes(lineNumber) : false,
          missedInstructions: hitCount > 0 ? 0 : 1,
          coveredInstructions: hitCount > 0 ? hitCount : 0
        });
      } else if (line === 'end_of_record' && matched && currentFile) {
        return { filePath: currentFile, lines: lineDetails };
      }
    }

    // 文件末尾没有 end_of_record 的情况
    if (matched && currentFile) {
      return { filePath: currentFile, lines: lineDetails };
    }

    return null;
  } catch (error) {
    console.error('Error parsing LCOV coverage file:', error);
    return null;
  }
}

/**
 * 文件路径匹配辅助函数
 */
function matchFilePath(filePath: string, targetFile: string): boolean {
  // 标准化路径分隔符
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedTarget = targetFile.replace(/\\/g, '/');

  // 精确匹配
  if (normalizedFile === normalizedTarget) return true;

  // 后缀匹配：确保在路径分隔符边界上匹配，避免 StudentDetailViewController.m 匹配 ViewController.m
  if (normalizedFile.endsWith('/' + normalizedTarget) || normalizedTarget.endsWith('/' + normalizedFile)) return true;

  // 文件名完全相同且路径兼容
  const fileName = path.basename(normalizedFile);
  const targetFileName = path.basename(normalizedTarget);
  if (fileName === targetFileName) return true;

  return false;
}

/**
 * JaCoCo XML 格式：获取文件的行级覆盖率详情
 */
async function getFileLineCoverageXML(
  reportPath: string,
  targetFile: string,
  changedLines?: number[]
): Promise<{
  filePath: string;
  lines: {
    lineNumber: number;
    isCovered: boolean;
    isChanged: boolean;
    missedInstructions: number;
    coveredInstructions: number;
  }[];
} | null> {
  try {
    const xmlContent = fs.readFileSync(reportPath, 'utf-8');
    const result = await parseStringPromise(xmlContent);

    const report = result.report;
    if (!report) return null;

    // 遍历所有包查找目标文件
    const packages = report.package || [];

    for (const pkg of packages) {
      const sourcefiles = pkg.sourcefile || [];

      for (const sourcefile of sourcefiles) {
        const fileName = sourcefile.$.name;
        const pkgName = pkg.$.name;
        const fullPath = `${pkgName}/${fileName}`;

        // 匹配文件路径
        if (fullPath.endsWith(targetFile) || targetFile.endsWith(fileName)) {
          const lines = sourcefile.line || [];
          const lineDetails = lines.map((line: any) => {
            const lineNumber = parseInt(line.$.nr);
            return {
              lineNumber,
              isCovered: parseInt(line.$.ci || 0) > 0,
              isChanged: changedLines ? changedLines.includes(lineNumber) : false,
              missedInstructions: parseInt(line.$.mi || 0),
              coveredInstructions: parseInt(line.$.ci || 0)
            };
          });

          return {
            filePath: fullPath,
            lines: lineDetails
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error parsing coverage file:', error);
    return null;
  }
}

/**
 * 获取报告中所有文件的列表
 */
export async function getReportFiles(
  reportPath: string
): Promise<{
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
}[]> {
  if (isLCOVFormat(reportPath)) {
    return getReportFilesLCOV(reportPath);
  }
  return getReportFilesXML(reportPath);
}

/**
 * LCOV 格式：获取报告中所有文件的列表
 */
function getReportFilesLCOV(reportPath: string): {
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
}[] {
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    const lines = content.split('\n');

    const files: { filePath: string; lineCoverage: number; totalLines: number; coveredLines: number }[] = [];
    let currentFile: string | null = null;
    let totalLines = 0;
    let coveredLines = 0;

    for (const line of lines) {
      if (line.startsWith('SF:')) {
        // 保存上一个文件
        if (currentFile) {
          const cov = totalLines > 0 ? parseFloat(((coveredLines / totalLines) * 100).toFixed(2)) : 0;
          files.push({ filePath: currentFile, lineCoverage: cov, totalLines, coveredLines });
        }
        currentFile = line.substring(3);
        totalLines = 0;
        coveredLines = 0;
      } else if (line.startsWith('DA:')) {
        const parts = line.substring(3).split(',');
        const hitCount = parseInt(parts[1]);
        totalLines++;
        if (hitCount > 0) coveredLines++;
      } else if (line === 'end_of_record' || line.trim() === '') {
        // end_of_record 时也保存（但等 SF: 或文件末尾统一处理也行）
      }
    }

    // 保存最后一个文件
    if (currentFile) {
      const cov = totalLines > 0 ? parseFloat(((coveredLines / totalLines) * 100).toFixed(2)) : 0;
      files.push({ filePath: currentFile, lineCoverage: cov, totalLines, coveredLines });
    }

    return files;
  } catch (error) {
    console.error('Error parsing LCOV report files:', error);
    return [];
  }
}

/**
 * JaCoCo XML 格式：获取报告中所有文件的列表
 */
async function getReportFilesXML(
  reportPath: string
): Promise<{
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
}[]> {
  try {
    const xmlContent = fs.readFileSync(reportPath, 'utf-8');
    const result = await parseStringPromise(xmlContent);
    
    const report = result.report;
    if (!report) return [];

    const files: {
      filePath: string;
      lineCoverage: number;
      totalLines: number;
      coveredLines: number;
    }[] = [];

    const packages = report.package || [];
    
    for (const pkg of packages) {
      const sourcefiles = pkg.sourcefile || [];
      
      for (const sourcefile of sourcefiles) {
        const fileName = sourcefile.$.name;
        const pkgName = pkg.$.name;
        const fullPath = `${pkgName}/${fileName}`;
        
        const lines = sourcefile.line || [];
        let total = 0;
        let covered = 0;
        
        for (const line of lines) {
          const mi = parseInt(line.$.mi || 0);
          const ci = parseInt(line.$.ci || 0);
          
          if (mi + ci > 0) {
            total++;
            if (ci > 0) covered++;
          }
        }
        
        files.push({
          filePath: fullPath,
          lineCoverage: total > 0 ? parseFloat(((covered / total) * 100).toFixed(2)) : 0,
          totalLines: total,
          coveredLines: covered
        });
      }
    }
    
    return files;
  } catch (error) {
    console.error('Error parsing coverage file:', error);
    return [];
  }
}

export default {
  parseAndroidCoverage,
  parseIOSCoverage,
  calculateIncrementalCoverage,
  getFileLineCoverage,
  getReportFiles
};

/**
 * 解析 Git diff 文件，获取变更的文件列表
 */
export function parseGitDiff(diffContent: string): {
  filePath: string;
  changedLines: number[];
}[] {
  const files: { filePath: string; changedLines: number[] }[] = [];
  const lines = diffContent.split('\n');
  
  let currentFile: string | null = null;
  let currentLines: number[] = [];
  let lineNumber = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 解析文件路径（+++ b/path/to/file）
    if (line.startsWith('+++ b/')) {
      if (currentFile && currentLines.length > 0) {
        files.push({
          filePath: currentFile,
          changedLines: [...currentLines]
        });
      }
      currentFile = line.substring(6); // 去掉 '+++ b/'
      currentLines = [];
    }
    // 解析 hunk 头部（@@ -oldStart,oldCount +newStart,newCount @@）
    else if (line.startsWith('@@') && currentFile) {
      const match = line.match(/@@ \-\d+,?\d* \+(\d+),?(\d*) @@/);
      if (match) {
        lineNumber = parseInt(match[1]);
      }
    }
    // 新增行（以 + 开头，但不是 +++）
    else if (line.startsWith('+') && !line.startsWith('+++') && currentFile) {
      currentLines.push(lineNumber);
      lineNumber++;
    }
    // 上下文行（不以 - 或 + 开头）
    else if (currentFile && !line.startsWith('-') && !line.startsWith('+')) {
      lineNumber++;
    }
    // 删除行（以 - 开头，但不是 ---）
    else if (line.startsWith('-') && !line.startsWith('---') && currentFile) {
      // 删除行不计入行号递增，因为我们要关注的是新文件中的行
    }
  }
  
  // 添加最后一个文件
  if (currentFile && currentLines.length > 0) {
    files.push({
      filePath: currentFile,
      changedLines: [...currentLines]
    });
  }
  
  return files;
}

/**
 * 获取增量文件列表（只包含 Git diff 中变更的文件）
 */
export async function getIncrementalFiles(
  reportPath: string,
  diffContent: string
): Promise<{
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
  changedLines: number[];
  incrementalCoverage: number;
}[]> {
  // 解析 Git diff 获取变更的文件和行号
  const diffFiles = parseGitDiff(diffContent);
  
  if (diffFiles.length === 0) {
    return [];
  }
  
  // 获取所有文件的覆盖率数据
  const allFiles = await getReportFiles(reportPath);
  
  // 过滤出变更的文件，并计算增量覆盖率
  const incrementalFiles = diffFiles
    .map(diffFile => {
      // 在覆盖率报告中查找匹配的文件
      const coverageFile = allFiles.find(f => 
        f.filePath.endsWith(diffFile.filePath) ||
        diffFile.filePath.endsWith(f.filePath) ||
        f.filePath.replace(/\//g, '.').endsWith(diffFile.filePath.replace(/\//g, '.'))
      );
      
      if (!coverageFile) {
        return null;
      }
      
      // 获取文件的行级覆盖率
      return getFileLineCoverage(reportPath, coverageFile.filePath).then(lineCoverage => {
        if (!lineCoverage) {
          return null;
        }
        
        // 计算变更行的覆盖率
        let changedCoveredLines = 0;
        let changedTotalLines = 0;
        
        for (const lineNum of diffFile.changedLines) {
          const lineData = lineCoverage.lines.find(l => l.lineNumber === lineNum);
          if (lineData) {
            changedTotalLines++;
            if (lineData.isCovered) {
              changedCoveredLines++;
            }
          }
        }
        
        const incrementalCoverage = changedTotalLines > 0
          ? parseFloat(((changedCoveredLines / changedTotalLines) * 100).toFixed(2))
          : 0;
        
        return {
          filePath: coverageFile.filePath,
          lineCoverage: coverageFile.lineCoverage,
          totalLines: coverageFile.totalLines,
          coveredLines: coverageFile.coveredLines,
          changedLines: diffFile.changedLines,
          incrementalCoverage
        };
      });
    })
    .filter((file): file is NonNullable<typeof file> => file !== null);
  
  // 等待所有 Promise 完成
  const results = await Promise.all(incrementalFiles);
  return results.filter((file): file is NonNullable<typeof file> => file !== null);
}
