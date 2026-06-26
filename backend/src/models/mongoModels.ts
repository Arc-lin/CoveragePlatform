import mongoose, { Schema, Document } from 'mongoose';

// 项目文档接口
export interface IProject extends Document {
  name: string;
  platform: 'ios' | 'android' | 'python';
  repositoryUrl?: string;
  accessToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

// 覆盖率报告文档接口
export interface ICoverageReport extends Document {
  projectId: mongoose.Types.ObjectId;
  commitHash: string;
  branch: string;
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  incrementalCoverage?: number;
  gitDiff?: string;
  reportPath?: string;
  buildId?: mongoose.Types.ObjectId;
  source: 'manual' | 'auto';
  // 多仓库组件化项目（目前只有 Android 用）：按模块/仓库拆分的覆盖率汇总，
  // 整份报告的 lineCoverage/incrementalCoverage 等字段是这些模块按行数加权聚合出来的
  moduleCoverages?: {
    module: string;
    repositoryUrl?: string;
    commitHash?: string;
    lineCoverage: number;
    functionCoverage: number;
    branchCoverage: number;
    incrementalCoverage?: number;
    totalLines: number;
    coveredLines: number;
    // 这个模块自己的 JaCoCo XML 路径——查某个文件的行级覆盖率时，必须用这个文件所属
    // 模块自己的报告，不能直接用整份报告顶层的 reportPath（那只是第一个模块的报告）
    reportPath?: string;
    // 这个模块自己的 git diff 原文快照（merge 时从 Build.moduleDiffs 落盘文件读入），
    // 让多仓库报告像单仓库 report.gitDiff 一样自包含，增量明细不再依赖 Build + 磁盘文件
    gitDiff?: string;
  }[];
  createdAt: Date;
}

// 构建文档接口
export interface IBuild extends Document {
  projectId: mongoose.Types.ObjectId;
  platform: 'ios' | 'android' | 'python';
  commitHash: string;
  // 组件化项目用的"构建身份"：壳工程 commit + 所有组件 commit 拼起来算出的复合指纹。
  // 非组件化项目不需要单独传，默认等于 commitHash——upsert/resolve 都按这个字段匹配，
  // commitHash 字段始终保留真实的壳工程 commit，专门给源码拉取/展示用，语义不变。
  buildKey: string;
  branch: string;
  buildVersion?: string;
  // 单仓库 diff：现在统一走 diffs.zip 落盘（gitDiffPath）；gitDiff 内联字段仅 from-pgyer 和
  // 旧记录还在用，合并时优先 gitDiffPath、回退 gitDiff
  gitDiff?: string;
  gitDiffPath?: string;
  // 组件化项目：壳工程仓库里拉不到的文件，按这份清单依次尝试各组件自己的仓库 + commit。
  // 每个组件各自的 commitHash（不是 buildKey 复合指纹），用于直接去对应仓库拉源码
  componentRepos?: { name: string; repositoryUrl: string; commitHash: string }[];
  // 多仓库组件化项目（目前只有 Android Gradle 多模块用）：按模块拆分的 git diff，存的是
  // 落盘文件路径，不是 diff 原文——diff 原文走 POST /api/builds 的 diffs.zip 文件字段上传，
  // 跟 binary/classfiles 一样"传文件存磁盘、数据库只记路径"，不占用表单字段/MongoDB 文档大小
  // 限制（之前 {module, diff} 内联存原文的设计有这个问题，已改掉）。单仓库项目继续只用上面
  // 那个全量 gitDiff 字符串字段，不受影响
  moduleDiffs?: { module: string; diffPath: string }[];
  // 原始的 build-fingerprint.json（构建身份计算依据），纯存档/排查用，不参与匹配逻辑——
  // 匹配逻辑统一走 buildKey（= sha256(build-fingerprint.json) 或单仓库项目的 commitHash）
  buildFingerprint?: string;
  binaryPath: string;
  // iOS 专用：以独立动态 framework 形式集成的组件二进制路径（上传 .ipa 时自动从
  // Frameworks/ 目录提取），llvm-cov export 需要同时拿到这些二进制才能解析出组件源码覆盖率
  frameworkBinaryPaths?: string[];
  status: 'ready' | 'processing' | 'error';
  mergedReportId?: mongoose.Types.ObjectId;
  rawUploadCount: number;
  lastMergedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// 原始覆盖率上传文档接口
export interface IRawUpload extends Document {
  buildId: mongoose.Types.ObjectId;
  filePath: string;
  originalFilename: string;
  fileSize: number;
  deviceInfo?: string;
  testerName?: string;
  status: 'uploaded' | 'merged' | 'error';
  errorMessage?: string;
  createdAt: Date;
}

// 文件覆盖率文档接口
export interface IFileCoverage extends Document {
  reportId: mongoose.Types.ObjectId;
  filePath: string;
  lineCoverage: number;
  totalLines: number;
  coveredLines: number;
  lines?: { lineNumber: number; isCovered: boolean; coveredInstructions?: number; missedInstructions?: number }[];
  // 多仓库组件化项目：这个文件属于哪个模块（对应 moduleCoverages[].module），
  // 单仓库项目不传，前端没有模块分组时按"未分组"处理
  module?: string;
  createdAt: Date;
}

// 项目模型
const ProjectSchema = new Schema<IProject>({
  name: { type: String, required: true },
  platform: { type: String, required: true, enum: ['ios', 'android', 'python'] },
  repositoryUrl: { type: String },
  accessToken: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 覆盖率报告模型
const CoverageReportSchema = new Schema<ICoverageReport>({
  projectId: { type: Schema.Types.ObjectId, required: true, ref: 'Project' },
  commitHash: { type: String, required: true },
  branch: { type: String, required: true },
  lineCoverage: { type: Number, required: true },
  functionCoverage: { type: Number, required: true },
  branchCoverage: { type: Number, required: true },
  incrementalCoverage: { type: Number },
  gitDiff: { type: String },
  reportPath: { type: String },
  buildId: { type: Schema.Types.ObjectId, ref: 'Build' },
  source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  moduleCoverages: [{
    module: { type: String, required: true },
    repositoryUrl: { type: String },
    commitHash: { type: String },
    lineCoverage: { type: Number, required: true },
    functionCoverage: { type: Number, required: true },
    branchCoverage: { type: Number, required: true },
    incrementalCoverage: { type: Number },
    totalLines: { type: Number, required: true },
    coveredLines: { type: Number, required: true },
    reportPath: { type: String },
    gitDiff: { type: String },
    _id: false
  }],
  createdAt: { type: Date, default: Date.now }
});

// 文件覆盖率模型
const FileCoverageSchema = new Schema<IFileCoverage>({
  reportId: { type: Schema.Types.ObjectId, required: true, ref: 'CoverageReport' },
  filePath: { type: String, required: true },
  lineCoverage: { type: Number, required: true },
  totalLines: { type: Number, required: true },
  coveredLines: { type: Number, required: true },
  lines: [{
    lineNumber: Number,
    isCovered: Boolean,
    coveredInstructions: Number,
    missedInstructions: Number
  }],
  module: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// 创建索引
ProjectSchema.index({ name: 1 });
ProjectSchema.index({ platform: 1 });
CoverageReportSchema.index({ projectId: 1, createdAt: -1 });
CoverageReportSchema.index({ commitHash: 1 });
CoverageReportSchema.index({ buildId: 1 });
FileCoverageSchema.index({ reportId: 1 });
FileCoverageSchema.index({ filePath: 1 });
FileCoverageSchema.index({ reportId: 1, filePath: 1 });

// 构建模型
const BuildSchema = new Schema<IBuild>({
  projectId: { type: Schema.Types.ObjectId, required: true, ref: 'Project' },
  platform: { type: String, required: true, enum: ['ios', 'android', 'python'] },
  commitHash: { type: String, required: true },
  buildKey: { type: String, required: true },
  branch: { type: String, required: true },
  buildVersion: { type: String },
  gitDiff: { type: String },
  gitDiffPath: { type: String },
  componentRepos: [{
    name: { type: String, required: true },
    repositoryUrl: { type: String, required: true },
    commitHash: { type: String, required: true },
    _id: false
  }],
  moduleDiffs: [{
    module: { type: String, required: true },
    diffPath: { type: String, required: true },
    _id: false
  }],
  buildFingerprint: { type: String },
  binaryPath: { type: String, required: true },
  frameworkBinaryPaths: [{ type: String }],
  status: { type: String, required: true, enum: ['ready', 'processing', 'error'], default: 'ready' },
  mergedReportId: { type: Schema.Types.ObjectId, ref: 'CoverageReport' },
  rawUploadCount: { type: Number, default: 0 },
  lastMergedAt: { type: Date },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

BuildSchema.index({ projectId: 1, createdAt: -1 });
// 同一个 commit/构建身份可能被 CI 重复构建多次（同一份代码，不同打包批次，或组件化项目
// 用复合指纹当身份），按 (projectId, buildKey) 查找已有 Build 用于复用/覆盖，而不是每次新建一条。
// 非组件化项目 buildKey 默认等于 commitHash，效果跟原来按 commitHash 查找完全一样。
// unique: true——光在应用层"先查后写"防不住两个并发请求同时建 Build（POST /api/builds 那边
// 已经用 withBuildLock 按这个组合键加锁了，这里是数据库层的最后一道保险：锁要是哪天被绕过/
// 漏加，唯一索引会让第二次插入直接报错，而不是悄悄插出两条对应同一个构建身份的 Build）
BuildSchema.index({ projectId: 1, buildKey: 1 }, { unique: true });

// 原始覆盖率上传模型
const RawUploadSchema = new Schema<IRawUpload>({
  buildId: { type: Schema.Types.ObjectId, required: true, ref: 'Build' },
  filePath: { type: String, required: true },
  originalFilename: { type: String, required: true },
  fileSize: { type: Number, required: true },
  deviceInfo: { type: String },
  testerName: { type: String },
  status: { type: String, required: true, enum: ['uploaded', 'merged', 'error'], default: 'uploaded' },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now }
});

RawUploadSchema.index({ buildId: 1, createdAt: -1 });

export const ProjectModel = mongoose.model<IProject>('Project', ProjectSchema);
export const CoverageReportModel = mongoose.model<ICoverageReport>('CoverageReport', CoverageReportSchema);
export const FileCoverageModel = mongoose.model<IFileCoverage>('FileCoverage', FileCoverageSchema);
export const BuildModel = mongoose.model<IBuild>('Build', BuildSchema);
export const RawUploadModel = mongoose.model<IRawUpload>('RawUpload', RawUploadSchema);
