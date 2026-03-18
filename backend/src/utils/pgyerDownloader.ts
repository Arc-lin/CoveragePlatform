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

  // 解析 plist XML
  const result = await parseStringPromise(xmlContent, { explicitArray: true });

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

  return binaryPath;
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
    const itemsArray = getDictValue(plistDict, 'items');
    if (!itemsArray || !Array.isArray(itemsArray)) return null;

    const firstItem = itemsArray[0];
    if (!firstItem || !firstItem.dict) return null;

    const assetsArray = getDictValue(firstItem.dict[0] || firstItem, 'assets');
    if (!assetsArray || !Array.isArray(assetsArray)) return null;

    // assets 是一个 dict 数组
    for (const assetContainer of assetsArray) {
      const dicts = assetContainer.dict || [assetContainer];
      for (const dict of dicts) {
        const kind = getDictValue(dict, 'kind');
        if (kind === 'software-package') {
          const url = getDictValue(dict, 'url');
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
 * 从 xml2js 解析的 dict 结构中按 key 名获取值
 * plist dict 在 xml2js 中表示为: { key: ['key1', 'key2'], string: ['val1', 'val2'], ... }
 */
function getDictValue(dict: any, keyName: string): any {
  if (!dict || !dict.key) return null;
  const keys: string[] = Array.isArray(dict.key) ? dict.key : [dict.key];
  const idx = keys.indexOf(keyName);
  if (idx === -1) return null;

  // 值可能是 string, array, dict, true, false 等类型
  for (const type of ['string', 'array', 'dict', 'integer', 'real', 'true', 'false']) {
    if (dict[type]) {
      const values = Array.isArray(dict[type]) ? dict[type] : [dict[type]];
      // 计算这个 key 对应第几个此类型的值
      // plist dict 中 key 和 value 是交替的，所以我们需要按位置匹配
      // xml2js 会按类型分组值，我们需要按原始顺序找到第 idx 个值
      // 简化处理：如果只有一种值类型（常见情况），直接按 idx 索引
      if (values[idx] !== undefined) {
        return values[idx];
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
