import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

import projectRoutes from './routes/projects';
import coverageRoutes from './routes/coverage';
import uploadRoutes from './routes/upload';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 创建必要的目录
const uploadsDir = path.join(__dirname, '../uploads');
const reportsDir = path.join(__dirname, '../reports');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// 静态文件服务
app.use('/reports', express.static(reportsDir));

// 路由
app.use('/api/projects', projectRoutes);
app.use('/api/coverage', coverageRoutes);
app.use('/api/upload', uploadRoutes);

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
