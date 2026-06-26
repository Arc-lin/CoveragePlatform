import fs from 'fs';
import path from 'path';

/**
 * 跨 Docker volume 挂载点移动文件。fs.renameSync 在源/目标分属不同挂载点时
 * 会抛 EXDEV（cross-device link not permitted），用 copy+unlink 规避。
 */
export function moveFile(src: string, dest: string): void {
  fs.copyFileSync(src, dest);
  fs.unlinkSync(src);
}

/**
 * 把不可信的上传/远端文件名净化成一个安全的 basename，供拼接成磁盘路径时使用。
 *
 * 两类风险一起堵掉：
 *  1) 路径穿越——originalname 形如 `../../../etc/x.zip` 时，path.join 会逃出预期目录。
 *     先 path.basename 去掉所有目录成分。
 *  2) 命令注入——净化后的名字最终会拼进 `unzip "<path>"`/`jacococli merge "<path>"` 这类
 *     shell 命令里，文件名带 `"`、`` ` ``、`$()`、`;` 等就能闭合引号执行任意命令。
 *     只保留 [A-Za-z0-9._-]，其它字符（含空格、引号、shell 元字符）一律替换成 `_`。
 *
 * 扩展名里的 `.`/`-` 在允许集合内，所以 `.ec`/`.profraw`/`.ipa` 等后缀判断不受影响。
 */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name || '').replace(/[^A-Za-z0-9._-]/g, '_');
  // 去掉前导的 '.'，避免净化后变成 '.'/'..' 或隐藏文件；为空时兜底一个固定名
  const cleaned = base.replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : 'upload';
}
