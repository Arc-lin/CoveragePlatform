# Code Coverage Platform

一个支持 iOS、Android 和 Python 的代码覆盖率统计平台，提供增量覆盖率分析、可视化报告展示和历史趋势追踪。

## 📋 功能特性

- **多平台支持**: 同时支持 iOS (LLVM Profile Instrumentation)、Android (JaCoCo) 和 Python (coverage.py)
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
│   ├── 接口文档.md          # 后端 API 文档
│   └── package.json
├── frontend/               # 前端应用 (React + TypeScript)
│   ├── src/
│   │   ├── components/     # 组件
│   │   ├── pages/          # 页面
│   │   └── services/       # API 服务
│   └── package.json
├── android-coverage/       # Android 覆盖率方案
│   ├── 接入文档.md          # 集成文档
│   ├── CoverageCollector.kt
│   ├── CoverageUploader.kt
│   ├── build.gradle.example
│   └── incremental_coverage.py
├── ios-coverage/          # iOS 覆盖率方案
│   ├── 接入文档.md         # 集成文档
│   ├── CoverageCollector.h/m
│   └── coverage_report.sh
├── python-coverage/       # Python 覆盖率方案
│   └── 接入文档.md         # 集成文档
└── docs/                  # 本地参考资料（API 文档、部署指南、测试计划等，已 gitignore，不会提交）
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

### 3. 集成到项目

#### Android

参考 [android-coverage/接入文档.md](android-coverage/接入文档.md) 进行集成

```kotlin
// Application.onCreate()
CoverageCollector.init(this)
```

#### iOS

参考 [ios-coverage/接入文档.md](ios-coverage/接入文档.md) 进行集成（只提供 Objective-C 实现，
Swift 项目通过 Bridging Header 混编接入）

```objc
// AppDelegate.m
[CoverageCollector initializeCollector];
```

#### Python

参考 [python-coverage/接入文档.md](python-coverage/接入文档.md) 进行集成，手动上传方式，无需 SDK：

```bash
# 1. 安装 coverage.py
pip install coverage pytest

# 2. 运行测试并收集覆盖率
coverage run -m pytest

# 3. 生成 Cobertura XML 报告
coverage xml -o coverage.xml

# 4. 上传到平台
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "file=@coverage.xml" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)"
```

## 📊 覆盖率报告上传

### 命令行上传

```bash
# Android（先生成 XML 报告再上传）
./gradlew jacocoUITestReport   # 生成 XML

curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=<PROJECT_ID>" \
  -F "platform=android" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)" \
  -F "file=@app/build/reports/jacoco/jacocoUITestReport/jacocoUITestReport.xml" \
  -F "gitDiff=$(git diff <base_commit>..HEAD -- app/src/main/java/)"

# iOS（需先将 .profraw 转换为 LCOV .info 格式再上传）
# Step 1: 合并 profraw → profdata
xcrun llvm-profdata merge -sparse *.profraw -o merged.profdata
# Step 2: 导出 LCOV
xcrun llvm-cov export <binary> -instr-profile=merged.profdata -format=lcov > coverage.info
# Step 3: 上传
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=<PROJECT_ID>" \
  -F "platform=ios" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)" \
  -F "file=@coverage.info"

# Python
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=<PROJECT_ID>" \
  -F "platform=python" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)" \
  -F "file=@coverage.xml"
```

### CI/CD 集成

#### GitHub Actions 示例（Android）

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

      - name: Run connected tests & generate coverage
        run: |
          ./gradlew connectedDevDebugAndroidTest
          ./gradlew jacocoUITestReport

      - name: Generate git diff
        run: |
          BASE_COMMIT=$(git merge-base origin/main HEAD)
          git diff $BASE_COMMIT HEAD --unified=0 -- app/src/main/java/ > /tmp/diff.txt

      - name: Upload Coverage
        run: |
          curl -X POST ${{ secrets.COVERAGE_PLATFORM_URL }}/api/upload/coverage \
            -F "projectId=${{ secrets.PROJECT_ID }}" \
            -F "platform=android" \
            -F "commitHash=${{ github.sha }}" \
            -F "branch=${{ github.ref_name }}" \
            -F "file=@app/build/reports/jacoco/jacocoUITestReport/jacocoUITestReport.xml" \
            -F "gitDiff=</tmp/diff.txt"
```

#### GitHub Actions 示例（Python）

```yaml
name: Python Coverage

on:
  push:
    branches: [ main, develop ]

jobs:
  upload-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0   # 需要完整 git 历史用于增量覆盖率

      - uses: actions/setup-python@v5
        with:
          python-version: '3.x'

      - name: Run tests with coverage
        run: |
          pip install coverage pytest
          coverage run -m pytest
          coverage xml -o coverage.xml

      - name: Generate git diff
        run: |
          BASE_COMMIT=$(git merge-base origin/main HEAD)
          git diff $BASE_COMMIT HEAD --unified=0 > /tmp/diff.txt

      - name: Upload Coverage
        run: |
          curl -X POST ${{ secrets.COVERAGE_PLATFORM_URL }}/api/upload/coverage \
            -F "projectId=${{ secrets.PROJECT_ID }}" \
            -F "commitHash=${{ github.sha }}" \
            -F "branch=${{ github.ref_name }}" \
            -F "file=@coverage.xml" \
            -F "gitDiff=</tmp/diff.txt"
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
| POST | `/api/upload/coverage/batch` | 批量上传覆盖率数据 |

### 增量与文件覆盖率 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/coverage/:id/incremental` | 获取增量覆盖率（基于已存储的 gitDiff） |
| GET | `/api/coverage/:id/files` | 获取文件覆盖率列表 |
| GET | `/api/coverage/:id/source?path=` | 获取带覆盖率的源码（支持 GitHub/GitLab/Gitee/Bitbucket） |

## 🛠️ 技术栈

- **Backend**: Node.js, Express, TypeScript, MongoDB
- **Frontend**: React, TypeScript, Bootstrap
- **Android**: JaCoCo, Kotlin
- **iOS**: LLVM Profile Instrumentation, Objective-C（Swift 项目通过 Bridging Header 混编接入）
- **Python**: coverage.py (Cobertura XML / LCOV / JSON)

## 📚 详细文档

- [Android 覆盖率方案](android-coverage/接入文档.md)
- [iOS 覆盖率方案](ios-coverage/接入文档.md)
- [Python 覆盖率方案](python-coverage/接入文档.md)
- [后端 API 文档](backend/接口文档.md)

`docs/` 目录下还有本地保留的部署指南、测试计划等参考资料，未提交到仓库（已 gitignore），仅供本地查阅。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License
