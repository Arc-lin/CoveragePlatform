# Code Coverage Platform

一个支持 iOS 和 Android 双端的代码覆盖率统计平台，提供增量覆盖率分析、可视化报告展示和历史趋势追踪。

## 📋 功能特性

- **双端支持**: 同时支持 iOS (LLVM Sanitizer Coverage) 和 Android (JaCoCo)
- **增量覆盖率**: 基于 Git Diff 的增量代码覆盖率统计
- **可视化报告**: 美观的 HTML 报告，支持行级覆盖率展示
- **历史趋势**: 覆盖率变化趋势图表
- **团队管理**: 项目和团队维度的覆盖率管理
- **CI/CD 集成**: 支持命令行上传，易于集成到 CI/CD 流程

## 🏗️ 项目结构

```
CodeCoveragePlatform/
├── backend/                 # 后端服务 (Node.js + Express + TypeScript)
│   ├── src/
│   │   ├── app.ts          # 应用入口
│   │   ├── models/         # 数据模型
│   │   ├── routes/         # API 路由
│   │   └── services/       # 业务逻辑
│   └── package.json
├── frontend/               # 前端应用 (React + TypeScript)
│   ├── src/
│   │   ├── components/     # 组件
│   │   ├── pages/          # 页面
│   │   └── services/       # API 服务
│   └── package.json
├── android-coverage/       # Android 覆盖率方案
│   ├── README.md           # 集成文档
│   ├── CoverageCollector.kt
│   ├── CoverageUploader.kt
│   ├── build.gradle.example
│   └── incremental_coverage.py
├── ios-coverage/          # iOS 覆盖率方案
│   ├── README.md          # 集成文档
│   ├── CoverageCollector.h/m
│   ├── CoverageCollector.swift
│   └── coverage_report.sh
└── docs/                  # 文档
```

## 🚀 快速开始

### 1. 启动后端服务

```bash
cd backend
npm install
npm run dev
```

后端服务将在 `http://localhost:3001` 启动

### 2. 启动前端应用

```bash
cd frontend
npm install
npm start
```

前端应用将在 `http://localhost:3000` 启动

### 3. 集成到移动应用

#### Android

参考 `android-coverage/README.md` 进行集成

```kotlin
// Application.onCreate()
CoverageCollector.init(this)
```

#### iOS

参考 `ios-coverage/README.md` 进行集成

```objc
// AppDelegate.m
[CoverageCollector initializeCollector];
```

## 📊 覆盖率报告上传

### 命令行上传

```bash
# Android
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=1" \
  -F "platform=android" \
  -F "commitHash=abc123" \
  -F "branch=main" \
  -F "file=@app/build/outputs/code_coverage/coverage.ec"

# iOS
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=2" \
  -F "platform=ios" \
  -F "commitHash=def456" \
  -F "branch=develop" \
  -F "file=@Demo.profraw"
```

### CI/CD 集成

#### GitHub Actions 示例

```yaml
name: Coverage Report

on:
  push:
    branches: [ main, develop ]

jobs:
  upload-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Upload Coverage
        run: |
          curl -X POST ${{ secrets.COVERAGE_PLATFORM_URL }}/api/upload/coverage \
            -F "projectId=${{ secrets.PROJECT_ID }}" \
            -F "platform=android" \
            -F "commitHash=${{ github.sha }}" \
            -F "branch=${{ github.ref_name }}" \
            -F "file=@app/build/outputs/code_coverage/coverage.ec"
```

## 📈 API 文档

### 项目 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/projects` | 获取所有项目 |
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/:id` | 获取项目详情 |
| PUT | `/api/projects/:id` | 更新项目 |
| DELETE | `/api/projects/:id` | 删除项目 |

### 覆盖率 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/coverage/project/:id` | 获取项目覆盖率列表 |
| GET | `/api/coverage/:id` | 获取覆盖率详情 |
| GET | `/api/coverage/project/:id/latest` | 获取最新覆盖率 |
| GET | `/api/coverage/project/:id/trend` | 获取覆盖率趋势 |

### 上传 API

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/upload/coverage` | 上传覆盖率数据 |

## 🛠️ 技术栈

- **Backend**: Node.js, Express, TypeScript, SQLite
- **Frontend**: React, TypeScript, Bootstrap, Material Design
- **Android**: JaCoCo, Kotlin
- **iOS**: LLVM Sanitizer Coverage, Objective-C/Swift

## 📚 详细文档

- [Android 覆盖率方案](android-coverage/README.md)
- [iOS 覆盖率方案](ios-coverage/README.md)
- [后端 API 文档](docs/api.md)
- [部署指南](docs/deployment.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License
