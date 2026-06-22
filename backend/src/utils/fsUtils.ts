import fs from 'fs';

/**
 * 跨 Docker volume 挂载点移动文件。fs.renameSync 在源/目标分属不同挂载点时
 * 会抛 EXDEV（cross-device link not permitted），用 copy+unlink 规避。
 */
export function moveFile(src: string, dest: string): void {
  fs.copyFileSync(src, dest);
  fs.unlinkSync(src);
}
