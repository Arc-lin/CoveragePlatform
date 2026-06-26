import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sanitizeFilename } from './fsUtils';

// 内存锁，按任意字符串 key 序列化执行——用于同一 Build 的并发合并（key=buildId），
// 也用于同一 (projectId, buildKey) 的并发创建/复用（key="build-create:projectId:buildKey"）
const buildLocks = new Map<string, Promise<unknown>>();

// 工具调用统一返回 argv 数组（[可执行文件, ...前缀参数]），配合 execFileSync 使用——
// 文件路径作为独立的 argv 元素传给子进程，不经过 shell，从根本上消除把不可信文件名/
// classRoot 拼进命令字符串导致的注入（之前是拼成带引号的字符串交给 execSync）

// 优先使用 JAVA_HOME 中的 java，保证 macOS 环境下能找到 JDK
function getJavaArgv(): string[] {
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const javaBin = path.join(javaHome, 'bin', 'java');
    if (fs.existsSync(javaBin)) return [javaBin];
  }
  return ['java'];
}

// llvm-profdata/llvm-cov 是标准 LLVM 工具，不是 Xcode 专属——profraw/coverage-mapping
// 格式实测可以被开源 LLVM（apk/apt 装的 llvmNN 包）正常解析，不需要 Xcode。
// 优先用 xcrun（macOS 有 Xcode 时），找不到再去找 Linux 上 apk 装的 llvmNN/bin/ 目录。
function findLLVMToolArgv(toolName: 'llvm-profdata' | 'llvm-cov'): string[] {
  try {
    execFileSync('xcrun', [toolName, '-h'], { stdio: 'pipe', timeout: 5000 });
    return ['xcrun', toolName];
  } catch {
    // 非 macOS 或没有 Xcode，继续往下找 Linux 上的开源 LLVM
  }

  try {
    const usrLib = '/usr/lib';
    const llvmDirs = fs.readdirSync(usrLib)
      .filter(name => /^llvm\d+$/.test(name))
      .sort((a, b) => parseInt(b.slice(4), 10) - parseInt(a.slice(4), 10)); // 取最高版本号优先
    for (const dir of llvmDirs) {
      const binPath = path.join(usrLib, dir, 'bin', toolName);
      if (fs.existsSync(binPath)) return [binPath];
    }
  } catch {
    // /usr/lib 不存在或不可读，忽略，走兜底
  }

  return [toolName]; // 兜底：依赖 PATH（如果装的是无版本号后缀的 llvm-profdata/llvm-cov）
}

export async function withBuildLock(key: string, fn: () => Promise<unknown>): Promise<void> {
  const prev = buildLocks.get(key) || Promise.resolve();
  const current = prev.then(fn, fn);
  buildLocks.set(key, current);
  try {
    await current;
  } finally {
    // 没有其它请求排在自己后面（map 里这个 key 还指向自己这个 promise）就清掉，
    // 不然 build-create:<projectId>:<buildKey> 这种 key 一个构建身份一个，越积越多，
    // 进程长期运行下去会无限增长——清的时候用 === 比较是不是自己，避免误删后面排队的
    if (buildLocks.get(key) === current) {
      buildLocks.delete(key);
    }
  }
}

/**
 * 检查服务端转换工具是否可用
 */
export function checkToolAvailability(): { ios: boolean; android: boolean; errors: string[] } {
  const errors: string[] = [];
  let ios = true;
  let android = true;

  try {
    const profdata = findLLVMToolArgv('llvm-profdata');
    const cov = findLLVMToolArgv('llvm-cov');
    execFileSync(profdata[0], [...profdata.slice(1), '-h'], { stdio: 'pipe', timeout: 5000 });
    execFileSync(cov[0], [...cov.slice(1), '-h'], { stdio: 'pipe', timeout: 5000 });
  } catch {
    ios = false;
    errors.push('llvm-profdata/llvm-cov not available. iOS profraw conversion will not work. Install Xcode Command Line Tools (macOS) or llvm (apt/apk install llvm).');
  }

  try {
    const java = getJavaArgv();
    execFileSync(java[0], [...java.slice(1), '-version'], { stdio: 'pipe', timeout: 5000 });
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
  machoBinaryPaths: string | string[],
  profrawPaths: string[]
): Promise<string> {
  const mergedDir = path.join(buildDir, 'merged');
  fs.mkdirSync(mergedDir, { recursive: true });

  const profdataPath = path.join(mergedDir, 'merged.profdata');
  const lcovPath = path.join(mergedDir, 'merged.info');

  // Step 1: 合并所有 profraw → profdata
  const profdataTool = findLLVMToolArgv('llvm-profdata');
  execFileSync(
    profdataTool[0],
    [...profdataTool.slice(1), 'merge', '-sparse', ...profrawPaths, '-o', profdataPath],
    { timeout: 120000, stdio: 'pipe' }
  );

  // Step 2: 导出 profdata → LCOV
  // 组件以独立动态 framework 形式集成时，覆盖率映射数据在它自己的二进制里，不在主 App 二进制里——
  // llvm-cov export 支持传多个二进制（第一个位置参数 + 多个 -object），把所有相关二进制都传进去
  // 才能拿到组件自己的源码覆盖率，不然组件文件永远不会出现在导出结果里
  const binaries = Array.isArray(machoBinaryPaths) ? machoBinaryPaths : [machoBinaryPaths];
  const [primaryBinary, ...additionalBinaries] = binaries;
  const objectArgs = additionalBinaries.flatMap(p => ['-object', p]);
  const covTool = findLLVMToolArgv('llvm-cov');
  const lcovOutput = execFileSync(
    covTool[0],
    [...covTool.slice(1), 'export', primaryBinary, ...objectArgs, `-instr-profile=${profdataPath}`, '-format=lcov'],
    { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }
  );
  fs.writeFileSync(lcovPath, lcovOutput);

  return lcovPath;
}

// 多仓库组件化项目（Gradle 多模块 + Maven AAR）的 classfiles.zip manifest 格式：
// { "entries": [{ "module": "feature-home", "classRoot": "components/feature-home",
//                  "repositoryUrl": "...", "commitHash": "..." }, ...] }
// classRoot 是相对 classfiles.zip 解压后根目录的相对路径。没有 manifest.json 时
// 退化成老的单一扁平目录行为（壳工程单仓库项目，零改动）。
export interface ClassfilesManifestEntry {
  module: string;
  classRoot: string;
  repositoryUrl?: string;
  commitHash?: string;
}

export interface AndroidMergeResult {
  // 主报告路径：没有 manifest 时是唯一的报告；有 manifest 时是第一个模块的报告
  // （调用方需要整体数字时应该用 modules 加权聚合，不要只看这个）
  reportPath: string;
  modules?: { module: string; xmlPath: string; repositoryUrl?: string; commitHash?: string }[];
}

/**
 * Android 覆盖率转换管线
 * 合并所有 .ec → merged.exec → JaCoCo XML（按 classfiles.zip 是否带 manifest.json
 * 分单仓库/多模块两种模式，对同一份 merged.exec 出报告）
 */
export async function mergeAndroidCoverage(
  buildDir: string,
  classfilesZipPath: string,
  ecPaths: string[]
): Promise<AndroidMergeResult> {
  const mergedDir = path.join(buildDir, 'merged');
  fs.mkdirSync(mergedDir, { recursive: true });

  const jacocoCliPath = getJacocoCliPath();
  const mergedExecPath = path.join(mergedDir, 'merged.exec');
  const javaArgv = getJavaArgv();

  // 解压 classfiles（如果尚未解压）
  const classfilesDir = path.join(buildDir, 'classfiles');
  if (!fs.existsSync(classfilesDir)) {
    fs.mkdirSync(classfilesDir, { recursive: true });
    // classfilesZipPath 源自上传 binary 的路径（文件名已在路由层 sanitizeFilename 净化），
    // 这里仍用 execFileSync 走参数数组形式，避免任何路径拼进 shell 字符串
    execFileSync('unzip', ['-o', classfilesZipPath, '-d', classfilesDir], { timeout: 60000, stdio: 'pipe' });
  }

  // Step 1: 合并所有 .ec → merged.exec（不管单仓库还是多模块，探针数据本来就是同一个进程里
  // 收集的，不分模块，所以只需要合并一次）
  execFileSync(
    javaArgv[0],
    [...javaArgv.slice(1), '-jar', jacocoCliPath, 'merge', ...ecPaths, '--destfile', mergedExecPath],
    { timeout: 120000, stdio: 'pipe' }
  );

  // Step 2: 生成 XML 报告
  const manifestPath = path.join(classfilesDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    // 单仓库项目：老行为，一个 classfiles 目录出一份报告
    const xmlPath = path.join(mergedDir, 'merged_report.xml');
    execFileSync(
      javaArgv[0],
      [...javaArgv.slice(1), '-jar', jacocoCliPath, 'report', mergedExecPath, '--classfiles', classfilesDir, '--xml', xmlPath],
      { timeout: 120000, stdio: 'pipe' }
    );
    return { reportPath: xmlPath };
  }

  // 多模块项目：manifest 列出的每个模块各自的 class 目录，对同一份 merged.exec
  // 分别跑一次 report——这样每份 XML 天然只包含这个模块自己的类，不需要事后按包名猜归属
  const manifest: { entries: ClassfilesManifestEntry[] } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const modules: { module: string; xmlPath: string; repositoryUrl?: string; commitHash?: string }[] = [];
  for (const entry of manifest.entries) {
    // entry.classRoot / entry.module 来自 zip 内 manifest（不可信）：classRoot 限制在
    // classfilesDir 内防穿越，module 净化成安全 basename 后才用于拼 XML 文件名；两者都作为
    // 独立 argv 传给 execFileSync，不进 shell
    const moduleClassDir = path.join(classfilesDir, entry.classRoot);
    const rel = path.relative(classfilesDir, moduleClassDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`classfiles.zip manifest.json classRoot escapes archive: ${entry.classRoot}`);
    }
    const xmlPath = path.join(mergedDir, `${sanitizeFilename(entry.module)}_report.xml`);
    execFileSync(
      javaArgv[0],
      [...javaArgv.slice(1), '-jar', jacocoCliPath, 'report', mergedExecPath, '--classfiles', moduleClassDir, '--xml', xmlPath],
      { timeout: 120000, stdio: 'pipe' }
    );
    modules.push({ module: entry.module, xmlPath, repositoryUrl: entry.repositoryUrl, commitHash: entry.commitHash });
  }

  if (modules.length === 0) {
    throw new Error('classfiles.zip manifest.json has no entries');
  }

  return { reportPath: modules[0].xmlPath, modules };
}
