import mongoose, { Schema, Document } from 'mongoose';

// 项目文档接口
export interface IProject extends Document {
  name: string;
  platform: 'ios' | 'android' | 'python';
  repositoryUrl?: string;
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
  createdAt: Date;
}

// 构建文档接口
export interface IBuild extends Document {
  projectId: mongoose.Types.ObjectId;
  platform: 'ios' | 'android' | 'python';
  commitHash: string;
  branch: string;
  buildVersion?: string;
  gitDiff?: string;
  binaryPath: string;
  status: 'ready' | 'error';
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
  createdAt: Date;
}

// 项目模型
const ProjectSchema = new Schema<IProject>({
  name: { type: String, required: true },
  platform: { type: String, required: true, enum: ['ios', 'android', 'python'] },
  repositoryUrl: { type: String },
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
  createdAt: { type: Date, default: Date.now }
});

// 文件覆盖率模型
const FileCoverageSchema = new Schema<IFileCoverage>({
  reportId: { type: Schema.Types.ObjectId, required: true, ref: 'CoverageReport' },
  filePath: { type: String, required: true },
  lineCoverage: { type: Number, required: true },
  totalLines: { type: Number, required: true },
  coveredLines: { type: Number, required: true },
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

// 构建模型
const BuildSchema = new Schema<IBuild>({
  projectId: { type: Schema.Types.ObjectId, required: true, ref: 'Project' },
  platform: { type: String, required: true, enum: ['ios', 'android', 'python'] },
  commitHash: { type: String, required: true },
  branch: { type: String, required: true },
  buildVersion: { type: String },
  gitDiff: { type: String },
  binaryPath: { type: String, required: true },
  status: { type: String, required: true, enum: ['ready', 'error'], default: 'ready' },
  mergedReportId: { type: Schema.Types.ObjectId, ref: 'CoverageReport' },
  rawUploadCount: { type: Number, default: 0 },
  lastMergedAt: { type: Date },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

BuildSchema.index({ projectId: 1, createdAt: -1 });

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
