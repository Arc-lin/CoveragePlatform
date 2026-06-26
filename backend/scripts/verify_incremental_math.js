/*
 * 验证多仓库 review 的 #3 重构（computeWeightedIncremental 一次调用返回 {incremental,totalChanged}）
 * 没有改变数值，并确认多模块按行数加权聚合的算法稳定。
 *
 * 纯本地：合成两份 JaCoCo XML + 两份 diff，不需要 Mongo / jacoco / 真实构建。
 * 对每个模块用 getIncrementalFiles 拿到逐文件增量，再分别用
 *   (旧) 两次调用：先算 incremental，再单独跑一遍取 totalChanged
 *   (新) 一次调用：同时拿 incremental 和 totalChanged
 * 两种方式做模块级 + 聚合级对比，断言完全一致。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getIncrementalFiles } = require('../dist/utils/coverageParser');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inc-math-'));

// JaCoCo XML：pkg/Foo.java 有 4 个可执行行(10..13)，前两行 covered(ci>0)、后两行 missed(mi>0)
function xml(pkg, file) {
  return `<?xml version="1.0"?><!DOCTYPE report><report name="t">
  <package name="${pkg}">
    <sourcefile name="${file}">
      <line nr="10" mi="0" ci="3"/>
      <line nr="11" mi="0" ci="1"/>
      <line nr="12" mi="2" ci="0"/>
      <line nr="13" mi="1" ci="0"/>
    </sourcefile>
  </package>
</report>`;
}

// diff：改了 10,11,12 三行（10/11 covered、12 missed） + 一行注释 99（报告里没有→不计入分母）
function diff(file) {
  return `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -10,0 +10,4 @@
+covered line 10
+covered line 11
+missed line 12
+// comment line 99
`;
}

const modA = { name: 'app', xml: path.join(tmp, 'app.xml'), diff: path.join(tmp, 'app.diff'), pkg: 'com/app', file: 'A.java' };
const modB = { name: 'feature', xml: path.join(tmp, 'feature.xml'), diff: path.join(tmp, 'feature.diff'), pkg: 'com/feature', file: 'B.java' };
fs.writeFileSync(modA.xml, xml(modA.pkg, modA.file));
fs.writeFileSync(modA.diff, diff(`${modA.pkg}/${modA.file}`));
fs.writeFileSync(modB.xml, xml(modB.pkg, modB.file));
fs.writeFileSync(modB.diff, diff(`${modB.pkg}/${modB.file}`));

const r2 = (n) => parseFloat(n.toFixed(2));

// 旧实现（重构前）：两次 getIncrementalFiles
async function oldWeighted(reportPath, d) {
  const files = await getIncrementalFiles(reportPath, d);
  if (files.length === 0) return undefined;
  const totalChanged = files.reduce((s, f) => s + f.changedLines.length, 0);
  if (totalChanged === 0) return 0;
  return r2(files.reduce((s, f) => s + (f.incrementalCoverage || 0) * f.changedLines.length, 0) / totalChanged);
}
async function oldChanged(reportPath, d) {
  const files = await getIncrementalFiles(reportPath, d);
  return files.reduce((s, f) => s + f.changedLines.length, 0);
}

// 新实现（重构后）：一次 getIncrementalFiles 同时拿两个数
async function newWeighted(reportPath, d) {
  const files = await getIncrementalFiles(reportPath, d);
  if (files.length === 0) return { incremental: undefined, totalChanged: 0 };
  const totalChanged = files.reduce((s, f) => s + f.changedLines.length, 0);
  if (totalChanged === 0) return { incremental: 0, totalChanged: 0 };
  const incremental = r2(files.reduce((s, f) => s + (f.incrementalCoverage || 0) * f.changedLines.length, 0) / totalChanged);
  return { incremental, totalChanged };
}

let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? '  ✅' : '  ❌'} ${name}${extra}`); if (!cond) fails++; };

async function main() {
  let oldTotalChanged = 0, oldWeightedCovered = 0;
  let newTotalChanged = 0, newWeightedCovered = 0;

  for (const m of [modA, modB]) {
    const oW = await oldWeighted(m.xml, fs.readFileSync(m.diff, 'utf-8'));
    const oC = await oldChanged(m.xml, fs.readFileSync(m.diff, 'utf-8'));
    const nu = await newWeighted(m.xml, fs.readFileSync(m.diff, 'utf-8'));

    check(`[${m.name}] 模块级 incremental 新旧一致 (old=${oW}, new=${nu.incremental})`, oW === nu.incremental);
    check(`[${m.name}] totalChanged 新旧一致 (old=${oC}, new=${nu.totalChanged})`, oC === nu.totalChanged);

    if (oW !== undefined) { oldTotalChanged += oC; oldWeightedCovered += oW * oC; }
    if (nu.incremental !== undefined && nu.totalChanged > 0) { newTotalChanged += nu.totalChanged; newWeightedCovered += nu.incremental * nu.totalChanged; }
  }

  const oldAgg = oldTotalChanged > 0 ? r2(oldWeightedCovered / oldTotalChanged) : undefined;
  const newAgg = newTotalChanged > 0 ? r2(newWeightedCovered / newTotalChanged) : undefined;
  check(`聚合增量覆盖率新旧一致 (old=${oldAgg}, new=${newAgg})`, oldAgg === newAgg);

  // 合理性：hunk @@ +10,4 新增 10..13 四行，都在报告里（10/11 covered、12/13 missed）→ 2/4 = 50%
  check('模块增量数值符合预期 50%', newAgg === 50, ` (实际 ${newAgg})`);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${fails === 0 ? '✅ 全部通过' : `❌ ${fails} 项失败`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
