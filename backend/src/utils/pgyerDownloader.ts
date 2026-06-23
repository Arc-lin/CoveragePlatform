import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parseStringPromise } from 'xml2js';

const IOS_USER_AGENT = 'com.apple.appstored/1.0 iOS/18.0 model/iPhone15,2 hwp/t8120 build/23D127 (6; dt:282) AMS/1';

/**
 * 从蒲公英 URL 中提取 key
 * 支持格式: https://www.pgyer.com/{key} 或 https://pgyer.com/{key}
 */
export function extractPgyerKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('pgyer.com')) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    const key = segments[0];
    // key 应该是一个较长的十六进制字符串
    if (/^[a-f0-9]{16,}$/i.test(key)) return key;
    return null;
  } catch {
    return null;
  }
}

/**
 * 从蒲公英获取 IPA 下载 URL
 * 1. 请求 plist 接口
 * 2. 解析 XML，找到 kind=software-package 的 URL
 * 3. 从 URL 中提取文件名
 */
export async function getIPADownloadUrl(pgyerKey: string): Promise<{ url: string; filename: string }> {
  const plistUrl = `https://www.pgyer.com/app/plist/${pgyerKey}/install/s.plist`;

  const xmlContent = await fetchUrl(plistUrl, {
    'User-Agent': IOS_USER_AGENT,
    'Accept': '*/*',
  });

  // 解析 plist XML，保留子节点顺序以支持混合类型 dict
  const result = await parseStringPromise(xmlContent, {
    explicitArray: true,
    explicitChildren: true,
    preserveChildrenOrder: true
  });

  // 导航 plist 结构: plist > dict > items(array) > dict > assets(array) > dict(kind=software-package)
  const ipaUrl = extractSoftwarePackageUrl(result);
  if (!ipaUrl) {
    throw new Error('No software-package URL found in plist response');
  }

  // 提取文件名
  const filename = extractFilenameFromUrl(ipaUrl);

  return { url: ipaUrl, filename };
}

/**
 * 下载 IPA 文件，支持进度回调
 */
export async function downloadIPA(
  downloadUrl: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const makeRequest = (url: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects'));
      }

      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { headers: { 'User-Agent': IOS_USER_AGENT } }, (res) => {
        // 处理重定向
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return makeRequest(res.headers.location, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;

        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (onProgress) {
            onProgress(downloaded, total);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });

        res.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on('error', reject);
    };

    makeRequest(downloadUrl);
  });
}

/**
 * 从 IPA 中提取 Mach-O 二进制文件
 * IPA 结构: Payload/AppName.app/AppName (Mach-O)
 */
export async function extractBinaryFromIPA(ipaPath: string, extractDir: string): Promise<string> {
  // 解压 IPA
  fs.mkdirSync(extractDir, { recursive: true });
  execSync(`unzip -o "${ipaPath}" -d "${extractDir}"`, { timeout: 120000, stdio: 'pipe' });

  // 找到 .app 目录
  const payloadDir = path.join(extractDir, 'Payload');
  if (!fs.existsSync(payloadDir)) {
    throw new Error('Invalid IPA: no Payload directory found');
  }

  const appDirs = fs.readdirSync(payloadDir).filter(d => d.endsWith('.app'));
  if (appDirs.length === 0) {
    throw new Error('Invalid IPA: no .app bundle found in Payload');
  }

  const appDir = path.join(payloadDir, appDirs[0]);

  // 从 Info.plist 获取可执行文件名
  const infoPlistPath = path.join(appDir, 'Info.plist');
  let executableName: string;

  try {
    // 使用 plutil 将 Info.plist 转换为 JSON
    const jsonStr = execSync(`plutil -convert json -o - "${infoPlistPath}"`, {
      timeout: 10000,
      encoding: 'utf-8'
    });
    const infoPlist = JSON.parse(jsonStr);
    executableName = infoPlist.CFBundleExecutable;
    if (!executableName) {
      throw new Error('CFBundleExecutable not found');
    }
  } catch {
    // fallback: 使用 .app 名称去掉 .app 后缀
    executableName = appDirs[0].replace(/\.app$/, '');
  }

  const binaryPath = path.join(appDir, executableName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Executable '${executableName}' not found in ${appDirs[0]}`);
  }

  // ENABLE_DEBUG_DYLIB=YES（Xcode 默认 Debug 配置开启）时，CFBundleExecutable 指向的只是个
  // 几十 KB 的瘦启动器，真正的代码和覆盖率映射数据在同目录下的 <executableName>.debug.dylib
  // 里——存在的话优先用这个，否则覆盖率数据全部对不上（壳工程自己的文件也会从报告里消失）
  const debugDylibPath = `${binaryPath}.debug.dylib`;
  if (fs.existsSync(debugDylibPath)) {
    return debugDylibPath;
  }

  return binaryPath;
}

/**
 * 找出 .app 包里 Frameworks/ 目录下所有嵌入的动态 framework 的可执行二进制。
 *
 * 组件以独立动态 framework 形式集成时（不是静态库），它的覆盖率映射数据在它自己的
 * 二进制里，不在主 App 二进制里——llvm-cov 需要同时拿到这些二进制才能解析出组件自己的
 * 源码覆盖率，否则组件文件永远不会出现在覆盖率报告里。
 *
 * @param appDir .app 包目录（extractBinaryFromIPA 解压出来的那个）
 */
export function extractFrameworkBinaries(appDir: string): string[] {
  const frameworksDir = path.join(appDir, 'Frameworks');
  if (!fs.existsSync(frameworksDir)) {
    return [];
  }

  const binaries: string[] = [];
  const frameworkDirs = fs.readdirSync(frameworksDir).filter(d => d.endsWith('.framework'));
  for (const frameworkDir of frameworkDirs) {
    const frameworkName = frameworkDir.replace(/\.framework$/, '');
    const binaryPath = path.join(frameworksDir, frameworkDir, frameworkName);
    if (fs.existsSync(binaryPath)) {
      binaries.push(binaryPath);
    }
  }
  return binaries;
}

// === 内部辅助函数 ===

function fetchUrl(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects'));
      }

      const client = requestUrl.startsWith('https') ? https : http;
      const req = client.get(requestUrl, { headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return makeRequest(res.headers.location, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      });
      req.on('error', reject);
    };

    makeRequest(url);
  });
}

/**
 * 从 xml2js 解析后的 plist 结构中提取 software-package URL
 * plist 结构:
 * <plist><dict>
 *   <key>items</key>
 *   <array><dict>
 *     <key>assets</key>
 *     <array>
 *       <dict><key>kind</key><string>software-package</string><key>url</key><string>...</string></dict>
 *     </array>
 *   </dict></array>
 * </dict></plist>
 */
function extractSoftwarePackageUrl(plistObj: any): string | null {
  try {
    const plistDict = plistObj.plist.dict[0];
    // getDictValue 返回 array 时为子节点列表（$$）
    const itemsChildren = getDictValue(plistDict, 'items');
    if (!Array.isArray(itemsChildren)) return null;

    for (const child of itemsChildren) {
      if (child['#name'] !== 'dict') continue;
      const assetsChildren = getDictValue(child, 'assets');
      if (!Array.isArray(assetsChildren)) continue;

      for (const assetNode of assetsChildren) {
        if (assetNode['#name'] !== 'dict') continue;
        const kind = getDictValue(assetNode, 'kind');
        if (kind === 'software-package') {
          const url = getDictValue(assetNode, 'url');
          if (url) return url;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 从 xml2js 解析的 dict 结构中按 key 名获取值。
 * 依赖 parseStringPromise 选项 { explicitChildren: true, preserveChildrenOrder: true }，
 * 通过 $$ 有序子节点正确处理混合类型 dict，避免按类型分组后索引错位的问题。
 *
 * 返回值：
 *   - string/integer/real: 对应的文本内容（string 类型）
 *   - true/false: boolean
 *   - array: 子节点数组（$$），每个子节点含 #name 字段
 *   - dict: dict 子节点本身
 */
function getDictValue(dict: any, keyName: string): any {
  if (!dict || !Array.isArray(dict.$$)) return null;

  const children: any[] = dict.$$;
  for (let i = 0; i < children.length - 1; i++) {
    const child = children[i];
    if (child['#name'] === 'key' && child._ === keyName) {
      const valueNode = children[i + 1];
      if (!valueNode) return null;
      switch (valueNode['#name']) {
        case 'string':
        case 'integer':
        case 'real':
          return valueNode._ ?? null;
        case 'true':
          return true;
        case 'false':
          return false;
        case 'array':
          // 返回 array 的有序子节点列表
          return Array.isArray(valueNode.$$) ? valueNode.$$ : [];
        case 'dict':
          return valueNode;
        default:
          return valueNode._ ?? null;
      }
    }
  }
  return null;
}

function extractFilenameFromUrl(downloadUrl: string): string {
  try {
    const url = new URL(downloadUrl);
    const disposition = url.searchParams.get('response-content-disposition');
    if (disposition) {
      const decoded = decodeURIComponent(disposition);
      const match = decoded.match(/filename="(.+?)"/);
      if (match) return match[1];
    }
    // fallback: 从路径提取
    const pathParts = url.pathname.split('/');
    const last = pathParts[pathParts.length - 1];
    if (last.endsWith('.ipa')) return last;
    return 'app.ipa';
  } catch {
    return 'app.ipa';
  }
}
