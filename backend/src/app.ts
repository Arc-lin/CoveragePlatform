import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

import projectRoutes from './routes/projects';
import coverageRoutes from './routes/coverage';
import uploadRoutes from './routes/upload';
import buildRoutes from './routes/builds';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 创建必要的目录
const uploadsDir = path.join(__dirname, '../uploads');
const reportsDir = path.join(__dirname, '../reports');
const buildsDir = path.join(__dirname, '../builds');
const toolsDir = path.join(__dirname, '../tools');

for (const dir of [uploadsDir, reportsDir, buildsDir, toolsDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 静态文件服务
app.use('/reports', express.static(reportsDir));

// 路由
app.use('/api/projects', projectRoutes);
app.use('/api/coverage', coverageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/builds', buildRoutes);

// 健康检查
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API 文档
app.get('/api', (req: Request, res: Response) => {
  res.json({
    name: 'Code Coverage Platform API',
    version: '1.0.0',
    endpoints: {
      projects: {
        'GET /api/projects': '获取所有项目',
        'POST /api/projects': '创建项目',
        'GET /api/projects/:id': '获取项目详情',
        'PUT /api/projects/:id': '更新项目',
        'DELETE /api/projects/:id': '删除项目'
      },
      coverage: {
        'GET /api/coverage/project/:projectId': '获取项目覆盖率报告列表',
        'GET /api/coverage/:id': '获取覆盖率报告详情',
        'GET /api/coverage/project/:projectId/latest': '获取最新覆盖率报告',
        'GET /api/coverage/project/:projectId/trend': '获取覆盖率趋势',
        'GET /api/coverage/project/:projectId/summary': '获取覆盖率摘要',
        'GET /api/coverage/:id/files': '获取报告的文件覆盖率列表'
      },
      upload: {
        'POST /api/upload/coverage': '上传覆盖率数据'
      },
      builds: {
        'POST /api/builds': '创建 Build（上传构建产物）',
        'POST /api/builds/:buildId/raw-coverage': '上传原始覆盖率文件（SDK 自动调用）',
        'GET /api/builds/project/:projectId': '获取项目的所有 Build',
        'GET /api/builds/:buildId': '获取 Build 详情',
        'GET /api/builds/:buildId/raw-uploads': '获取 Build 的所有原始上传',
        'POST /api/builds/:buildId/remerge': '强制重新合并',
        'DELETE /api/builds/:buildId': '删除 Build'
      }
    }
  });
});

// 404 处理
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// 错误处理
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

export default app;
