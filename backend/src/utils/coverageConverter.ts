import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Per-build 内存锁，避免同一 Build 的并发合并
const buildLocks = new Map<string, Promise<void>>();

export async function withBuildLock(buildId: string, fn: () => Promise<void>): Promise<void> {
  const prev = buildLocks.get(buildId) || Promise.resolve();
  const current = prev.then(fn, fn);
  buildLocks.set(buildId, current);
  await current;
}

/**
 * 检查服务端转换工具是否可用
 */
export function checkToolAvailability(): { ios: boolean; android: boolean; errors: string[] } {
  const errors: string[] = [];
  let ios = true;
  let android = true;

  try {
    execSync('xcrun llvm-profdata -h', { stdio: 'pipe', timeout: 5000 });
    execSync('xcrun llvm-cov -h', { stdio: 'pipe', timeout: 5000 });
  } catch {
    ios = false;
    errors.push('xcrun llvm-profdata/llvm-cov not available. iOS profraw conversion will not work. Install Xcode Command Line Tools.');
  }

  try {
    execSync('java -version', { stdio: 'pipe', timeout: 5000 });
  } catch {
    android = false;
    errors.push('java not available. Android .ec conversion will not work.');
  }

  const jacocoCliPath = getJacocoCliPath();
  if (!fs.existsSync(jacocoCliPath)) {
    android = false;
    errors.push(`jacococli.jar not found at ${jacocoCliPath}. Download from https://www.jacoco.org/jacoco/`);
  }

  return { ios, android, errors };
}

function getJacocoCliPath(): string {
  return path.join(__dirname, '../../tools/jacococli.jar');
}

/**
 * iOS 覆盖率转换管线
 * 合并所有 profraw → profdata → LCOV (.info)
 */
export async function mergeIOSCoverage(
  buildDir: string,
  machoBinaryPath: string,
  profrawPaths: string[]
): Promise<string> {
  const mergedDir = path.join(buildDir, 'merged');
  fs.mkdirSync(mergedDir, { recursive: true });

  const profdataPath = path.join(mergedDir, 'merged.profdata');
  const lcovPath = path.join(mergedDir, 'merged.info');

  // Step 1: 合并所有 profraw → profdata
  const quotedPaths = profrawPaths.map(p => `"${p}"`).join(' ');
  const mergeCmd = `xcrun llvm-profdata merge -sparse ${quotedPaths} -o "${profdataPath}"`;
  execSync(mergeCmd, { timeout: 120000, stdio: 'pipe' });

  // Step 2: 导出 profdata → LCOV
  const exportCmd = `xcrun llvm-cov export "${machoBinaryPath}" -instr-profile="${profdataPath}" -format=lcov`;
  const lcovOutput = execSync(exportCmd, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });
  fs.writeFileSync(lcovPath, lcovOutput);

  return lcovPath;
}

/**
 * Android 覆盖率转换管线
 * 合并所有 .ec → merged.exec → JaCoCo XML
 */
export async function mergeAndroidCoverage(
  buildDir: string,
  classfilesZipPath: string,
  ecPaths: string[]
): Promise<string> {
  const mergedDir = path.join(buildDir, 'merged');
  fs.mkdirSync(mergedDir, { recursive: true });

  const jacocoCliPath = getJacocoCliPath();
  const mergedExecPath = path.join(mergedDir, 'merged.exec');
  const xmlPath = path.join(mergedDir, 'merged_report.xml');

  // 解压 classfiles（如果尚未解压）
  const classfilesDir = path.join(buildDir, 'classfiles');
  if (!fs.existsSync(classfilesDir)) {
    fs.mkdirSync(classfilesDir, { recursive: true });
    execSync(`unzip -o "${classfilesZipPath}" -d "${classfilesDir}"`, { timeout: 60000, stdio: 'pipe' });
  }

  // Step 1: 合并所有 .ec → merged.exec
  const quotedPaths = ecPaths.map(p => `"${p}"`).join(' ');
  const mergeCmd = `java -jar "${jacocoCliPath}" merge ${quotedPaths} --destfile "${mergedExecPath}"`;
  execSync(mergeCmd, { timeout: 120000, stdio: 'pipe' });

  // Step 2: 生成 XML 报告
  const reportCmd = `java -jar "${jacocoCliPath}" report "${mergedExecPath}" --classfiles "${classfilesDir}" --xml "${xmlPath}"`;
  execSync(reportCmd, { timeout: 120000, stdio: 'pipe' });

  return xmlPath;
}
