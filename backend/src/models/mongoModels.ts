import mongoose, { Schema, Document } from 'mongoose';

// 项目文档接口
export interface IProject extends Document {
  name: string;
  platform: 'ios' | 'android';
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
  platform: { type: String, required: true, enum: ['ios', 'android'] },
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
FileCoverageSchema.index({ reportId: 1 });
FileCoverageSchema.index({ filePath: 1 });

export const ProjectModel = mongoose.model<IProject>('Project', ProjectSchema);
export const CoverageReportModel = mongoose.model<ICoverageReport>('CoverageReport', CoverageReportSchema);
export const FileCoverageModel = mongoose.model<IFileCoverage>('FileCoverage', FileCoverageSchema);
