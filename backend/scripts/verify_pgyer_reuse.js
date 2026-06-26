/*
 * 验证 #3 修复所依赖的 DB 不变量：from-pgyer 复用 Build 而不是无脑 createBuild。
 *
 * 直接打到真实 MongoDB，模拟“同一个 (projectId, buildKey) 第二次下载”这个核心场景：
 *  1) 第二次走 createBuild —— 应当因 (projectId, buildKey) 唯一索引抛 E11000（这正是
 *     旧代码会被 catch 成 status:'error' 的根因）。
 *  2) 改走 “getBuildByProjectAndKey → updateBuild 复用” —— 应当：
 *     - 不新增第二条文档（同一 buildKey 仍只有 1 条）
 *     - buildId 不变（App 侧 resolve 出来的 id 稳定）
 *     - status 复位、rawUploadCount 归零、mergedReportId/lastMergedAt 被 $unset 清空
 *
 * 用法（在 compose 网络内跑，mongo 主机名为 mongo）：
 *   docker run --rm --network coverageplatform_default \
 *     -e MONGODB_URI=mongodb://mongo:27017/coverage \
 *     -v "$PWD/backend":/app -w /app node:20 node scripts/verify_pgyer_reuse.js
 */
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coverage';

// 跟 mongoModels.ts 里 BuildSchema 关键字段对齐（只取本测试用得到的部分 + 唯一索引）
const BuildSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true },
  platform: { type: String, required: true },
  commitHash: { type: String, required: true },
  buildKey: { type: String, required: true },
  branch: { type: String, required: true },
  binaryPath: { type: String, required: true },
  status: { type: String, default: 'ready' },
  mergedReportId: { type: mongoose.Schema.Types.ObjectId },
  rawUploadCount: { type: Number, default: 0 },
  lastMergedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
BuildSchema.index({ projectId: 1, buildKey: 1 }, { unique: true });

// 用独立 collection，避免污染真实 builds 数据
const Build = mongoose.model('PgyerReuseTestBuild', BuildSchema, 'pgyer_reuse_test_builds');

// 复刻 database.ts updateBuild 的 undefined→$unset 语义
async function updateBuild(id, updates) {
  const setFields = { updatedAt: new Date() };
  const unsetFields = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) unsetFields[k] = '';
    else setFields[k] = v;
  }
  const update = { $set: setFields };
  if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;
  return Build.findByIdAndUpdate(id, update, { new: true });
}

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}`);
  if (!cond) failures++;
}

async function main() {
  await mongoose.connect(URI);
  console.log(`connected: ${URI}\n`);

  await Build.init(); // 确保唯一索引建好
  await Build.deleteMany({});

  const projectId = new mongoose.Types.ObjectId();
  const buildKey = 'commit-abc123';

  // 第一次下载：建 Build，再模拟它已经合并过一次（有 mergedReportId / rawUploadCount / lastMergedAt）
  const first = await Build.create({
    projectId, platform: 'ios', commitHash: buildKey, buildKey,
    branch: 'main', binaryPath: '/old/path/App', status: 'ready'
  });
  await updateBuild(first._id, {
    mergedReportId: new mongoose.Types.ObjectId(),
    rawUploadCount: 3,
    lastMergedAt: new Date(),
    status: 'ready'
  });

  console.log('场景一：旧逻辑（无脑 createBuild）应当撞唯一索引');
  let dupThrew = false;
  try {
    await Build.create({
      projectId, platform: 'ios', commitHash: buildKey, buildKey,
      branch: 'main', binaryPath: '/new/path/App', status: 'ready'
    });
  } catch (e) {
    dupThrew = (e && (e.code === 11000 || /E11000/.test(e.message)));
  }
  check('第二次 createBuild 抛 E11000 duplicate key（旧代码的报错根因）', dupThrew);
  check('撞键后集合里仍然只有 1 条', (await Build.countDocuments({ projectId, buildKey })) === 1);

  console.log('\n场景二：新逻辑（getBuildByProjectAndKey → updateBuild 复用）');
  const existing = await Build.findOne({ projectId, buildKey }).sort({ createdAt: -1 });
  check('复用查询命中已有 Build', !!existing && existing._id.equals(first._id));

  const reused = await updateBuild(existing._id, {
    commitHash: buildKey,
    branch: 'release',
    binaryPath: '/new/path/App',
    status: 'ready',
    rawUploadCount: 0,
    mergedReportId: undefined,
    lastMergedAt: undefined
  });

  check('没有新增文档，buildKey 下仍只有 1 条', (await Build.countDocuments({ projectId, buildKey })) === 1);
  check('buildId 保持不变（App resolve 出来的 id 稳定）', reused._id.equals(first._id));
  check('binaryPath 更新成新下载的二进制', reused.binaryPath === '/new/path/App');
  check('branch 更新', reused.branch === 'release');
  check('rawUploadCount 归零', reused.rawUploadCount === 0);
  check('mergedReportId 被 $unset 清空', reused.mergedReportId === undefined || reused.mergedReportId === null);
  check('lastMergedAt 被 $unset 清空', reused.lastMergedAt === undefined || reused.lastMergedAt === null);

  await Build.deleteMany({});
  await mongoose.disconnect();

  console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('运行出错:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(2);
});
