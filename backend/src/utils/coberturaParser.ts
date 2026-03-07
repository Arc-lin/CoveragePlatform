import fs from 'fs';
import { parseStringPromise } from 'xml2js';

interface CoverageData {
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  files?: FileCoverageData[];
}

interface FileCoverageData {
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
}

/**
 * 检测 XML 文件是否为 Cobertura 格式
 */
export function isCoberturaFormat(reportPath: string): boolean {
  if (!reportPath.endsWith('.xml')) return false;
  try {
    const head = fs.readFileSync(reportPath, 'utf-8').substring(0, 500);
    return head.includes('<coverage') && !head.includes('<report');
  } catch {
    return false;
  }
}

/**
 * 解析 Cobertura XML 覆盖率报告（Python coverage.py 标准输出格式）
 *
 * Cobertura XML 结构:
 * <coverage line-rate="..." branch-rate="...">
 *   <packages>
 *     <package name="...">
 *       <classes>
 *         <class filename="src/module.py" line-rate="..." branch-rate="...">
 *           <methods>
 *             <method name="func" ...>
 *               <lines><line number="10" hits="5"/></lines>
 *             </method>
 *           </methods>
 *           <lines>
 *             <line number="1" hits="1" branch="false"/>
 *             <line number="5" hits="0" branch="true" condition-coverage="50% (1/2)"/>
 *           </lines>
 *         </class>
 *       </classes>
 *     </package>
 *   </packages>
 * </coverage>
 */
export async function parseCoberturaXML(filePath: string): Promise<CoverageData> {
  const xmlContent = fs.readFileSync(filePath, 'utf-8');
  const result = await parseStringPromise(xmlContent);

  const coverage = result.coverage;
  if (!coverage) {
    throw new Error('Invalid Cobertura XML format: missing <coverage> root element');
  }

  let totalLines = 0;
  let coveredLines = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalMethods = 0;
  let coveredMethods = 0;

  const files: FileCoverageData[] = [];

  const packages = coverage.packages?.[0]?.package || [];
  for (const pkg of packages) {
    const classes = pkg.classes?.[0]?.class || [];

    for (const cls of classes) {
      const filename = cls.$.filename;
      let fileTotalLines = 0;
      let fileCoveredLines = 0;

      // 解析行覆盖率
      const lines = cls.lines?.[0]?.line || [];
      for (const line of lines) {
        const hits = parseInt(line.$.hits || '0');
        fileTotalLines++;
        totalLines++;

        if (hits > 0) {
          fileCoveredLines++;
          coveredLines++;
        }

        // 解析分支覆盖率
        if (line.$.branch === 'true' && line.$['condition-coverage']) {
          const condMatch = line.$['condition-coverage'].match(/\((\d+)\/(\d+)\)/);
          if (condMatch) {
            coveredBranches += parseInt(condMatch[1]);
            totalBranches += parseInt(condMatch[2]);
          }
        }
      }

      // 解析方法覆盖率
      const methods = cls.methods?.[0]?.method || [];
      for (const method of methods) {
        totalMethods++;
        // 检查方法内是否有任何被覆盖的行
        const methodLines = method.lines?.[0]?.line || [];
        const hasHit = methodLines.some((l: any) => parseInt(l.$.hits || '0') > 0);
        if (hasHit) {
          coveredMethods++;
        }
      }

      const fileLineCoverage = fileTotalLines > 0
        ? (fileCoveredLines / fileTotalLines) * 100
        : 0;

      files.push({
        filePath: filename,
        lineCoverage: parseFloat(fileLineCoverage.toFixed(2)),
        totalLines: fileTotalLines,
        coveredLines: fileCoveredLines
      });
    }
  }

  const lineCoverage = totalLines > 0
    ? (coveredLines / totalLines) * 100
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
 * Cobertura XML 格式：获取报告中所有文件的列表
 */
export async function getReportFilesCobertura(
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

    const coverage = result.coverage;
    if (!coverage) return [];

    const files: { filePath: string; lineCoverage: number; totalLines: number; coveredLines: number }[] = [];

    const packages = coverage.packages?.[0]?.package || [];
    for (const pkg of packages) {
      const classes = pkg.classes?.[0]?.class || [];
      for (const cls of classes) {
        const filename = cls.$.filename;
        const lines = cls.lines?.[0]?.line || [];

        let total = 0;
        let covered = 0;

        for (const line of lines) {
          total++;
          if (parseInt(line.$.hits || '0') > 0) {
            covered++;
          }
        }

        files.push({
          filePath: filename,
          lineCoverage: total > 0 ? parseFloat(((covered / total) * 100).toFixed(2)) : 0,
          totalLines: total,
          coveredLines: covered
        });
      }
    }

    return files;
  } catch (error) {
    console.error('Error parsing Cobertura XML report files:', error);
    return [];
  }
}

/**
 * Cobertura XML 格式：获取文件的行级覆盖率详情
 */
export async function getFileLineCoverageCobertura(
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

    const coverage = result.coverage;
    if (!coverage) return null;

    const packages = coverage.packages?.[0]?.package || [];
    for (const pkg of packages) {
      const classes = pkg.classes?.[0]?.class || [];
      for (const cls of classes) {
        const filename = cls.$.filename;

        // 路径匹配
        if (!matchFilePath(filename, targetFile)) continue;

        const lines = cls.lines?.[0]?.line || [];
        const lineDetails = lines.map((line: any) => {
          const lineNumber = parseInt(line.$.number);
          const hits = parseInt(line.$.hits || '0');
          return {
            lineNumber,
            isCovered: hits > 0,
            isChanged: changedLines ? changedLines.includes(lineNumber) : false,
            missedInstructions: hits > 0 ? 0 : 1,
            coveredInstructions: hits > 0 ? hits : 0
          };
        });

        return {
          filePath: filename,
          lines: lineDetails
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error parsing Cobertura coverage file:', error);
    return null;
  }
}

/**
 * 解析 Python coverage.py JSON 格式
 *
 * JSON 结构:
 * {
 *   "files": {
 *     "src/module.py": {
 *       "executed_lines": [1, 2, 5],
 *       "missing_lines": [3, 7],
 *       "summary": { "covered_lines": 3, "num_statements": 5, "percent_covered": 60.0 }
 *     }
 *   },
 *   "totals": { "covered_lines": 30, "num_statements": 50, "percent_covered": 60.0 }
 * }
 */
export async function parseCoverageJSON(filePath: string): Promise<CoverageData> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  if (!data.files || !data.totals) {
    throw new Error('Invalid coverage.py JSON format: missing "files" or "totals"');
  }

  const files: FileCoverageData[] = [];
  let totalLines = 0;
  let coveredLines = 0;

  for (const [filename, fileData] of Object.entries<any>(data.files)) {
    const summary = fileData.summary;
    const fileTotal = summary?.num_statements || 0;
    const fileCovered = summary?.covered_lines || 0;

    totalLines += fileTotal;
    coveredLines += fileCovered;

    const fileLineCoverage = fileTotal > 0
      ? (fileCovered / fileTotal) * 100
      : 0;

    files.push({
      filePath: filename,
      lineCoverage: parseFloat(fileLineCoverage.toFixed(2)),
      totalLines: fileTotal,
      coveredLines: fileCovered
    });
  }

  const lineCoverage = totalLines > 0
    ? (coveredLines / totalLines) * 100
    : 0;

  // coverage.py JSON 不直接提供 branch/function 级别数据
  // 使用 totals 中的 covered_branches 如果有的话
  let branchCoverage = 0;
  if (data.totals.covered_branches !== undefined && data.totals.num_branches !== undefined) {
    branchCoverage = data.totals.num_branches > 0
      ? (data.totals.covered_branches / data.totals.num_branches) * 100
      : 0;
  }

  return {
    lineCoverage: parseFloat(lineCoverage.toFixed(2)),
    functionCoverage: 0, // JSON 格式不包含函数级别数据
    branchCoverage: parseFloat(branchCoverage.toFixed(2)),
    files
  };
}

/**
 * 文件路径匹配辅助函数（复用 coverageParser 中的逻辑）
 */
function matchFilePath(filePath: string, targetFile: string): boolean {
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedTarget = targetFile.replace(/\\/g, '/');

  if (normalizedFile === normalizedTarget) return true;
  if (normalizedFile.endsWith('/' + normalizedTarget) || normalizedTarget.endsWith('/' + normalizedFile)) return true;

  const fileName = normalizedFile.split('/').pop() || '';
  const targetFileName = normalizedTarget.split('/').pop() || '';
  if (fileName === targetFileName) return true;

  return false;
}
