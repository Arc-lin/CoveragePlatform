# Code Coverage Platform - 项目总结

## 📋 项目概述

成功搭建了一个支持 **iOS** 和 **Android** 双端的代码覆盖率统计平台，具备以下核心功能：

- ✅ **双端支持**: iOS (LLVM Sanitizer Coverage) + Android (JaCoCo)
- ✅ **增量覆盖率**: 基于 Git Diff 的增量代码覆盖率分析
- ✅ **可视化平台**: React + Bootstrap 前端，美观的覆盖率报告展示
- ✅ **RESTful API**: Node.js + Express 后端，完整的项目管理接口
- ✅ **报告上传**: 支持命令行和 API 上传覆盖率数据

---

## 🏗️ 技术架构

### 后端 (Backend)
- **框架**: Node.js + Express + TypeScript
- **数据库**: 内存数据库 (可替换为 SQLite/MySQL/PostgreSQL)
- **文件存储**: 本地文件系统 (可替换为云存储)
- **API 设计**: RESTful API，支持 CORS

### 前端 (Frontend)
- **框架**: React 18 + TypeScript
- **UI 组件**: Bootstrap 5 + React-Bootstrap
- **图表**: Chart.js (支持覆盖率趋势图)
- **HTTP 客户端**: Axios

### Android 覆盖率方案
- **工具**: JaCoCo 0.8.11
- **插桩方式**: 编译时字节码插桩
- **数据收集**: 运行时自动收集，支持手动触发
- **报告格式**: XML/HTML/LCOV

### iOS 覆盖率方案
- **工具**: LLVM Sanitizer Coverage
- **插桩方式**: 编译参数注入 `-sanitize-coverage=func,trace-pc-guard`
- **数据收集**: `__sanitizer_cov_trace_pc_guard` 回调
- **报告格式**: .profraw → .profdata → LCOV

---

## 📁 项目结构

```
CodeCoveragePlatform/
├── backend/                    # 后端服务
│   ├── src/
│   │   ├── app.ts             # Express 应用入口
│   │   ├── index.ts           # 服务启动入口
│   │   ├── models/
│   │   │   └── database.ts    # 数据库模型 (内存实现)
│   │   ├── routes/
│   │   │   ├── projects.ts    # 项目 API
│   │   │   ├── coverage.ts    # 覆盖率 API
│   │   │   └── upload.ts      # 上传 API
│   │   ├── services/
│   │   │   ├── projectService.ts
│   │   │   └── coverageService.ts
│   │   ├── types/
│   │   │   └── index.ts       # TypeScript 类型定义
│   │   └── utils/
│   │       └── coverageParser.ts  # 覆盖率解析器
│   └── package.json
├── frontend/                   # 前端应用
│   ├── src/
│   │   ├── App.tsx            # 主应用组件
│   │   ├── components/
│   │   │   └── Layout.tsx     # 布局组件
│   │   ├── pages/
│   │   │   ├── Home.tsx       # 首页仪表盘
│   │   │   ├── Projects.tsx   # 项目管理
│   │   │   ├── Reports.tsx    # 覆盖率报告
│   │   │   └── Upload.tsx     # 报告上传
│   │   ├── services/
│   │   │   └── api.ts         # API 服务
│   │   └── types/
│   │       └── index.ts       # 类型定义
│   └── package.json
├── android-coverage/           # Android 覆盖率方案
│   ├── README.md              # 集成文档
│   ├── CoverageCollector.kt   # 覆盖率收集器
│   ├── CoverageUploader.kt    # 覆盖率上传器
│   ├── build.gradle.example   # Gradle 配置示例
│   └── incremental_coverage.py # 增量覆盖率分析脚本
├── ios-coverage/              # iOS 覆盖率方案
│   ├── README.md              # 集成文档
│   ├── CoverageCollector.h/m  # Objective-C 收集器
│   ├── CoverageCollector.swift # Swift 收集器
│   ├── coverage_report.sh     # 报告生成脚本
│   └── gitdiff/
│       └── utils/
│           └── diffParser.rb  # Git diff 解析器
├── start.sh                   # 一键启动脚本
└── README.md                  # 项目文档
```

---

## 🚀 快速启动

### 1. 一键启动（推荐）

```bash
cd /Users/arclin/Desktop/CodeCoveragePlatform
./start.sh all
```

服务启动后：
- 前端: http://localhost:3000
- 后端: http://localhost:3001

### 2. 手动启动

**后端:**
```bash
cd backend
npm run dev
```

**前端:**
```bash
cd frontend
npm start
```

---

## 📊 API 接口

### 项目管理
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/projects` | 获取所有项目 |
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/:id` | 获取项目详情 |
| PUT | `/api/projects/:id` | 更新项目 |
| DELETE | `/api/projects/:id` | 删除项目 |

### 覆盖率管理
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/coverage/project/:id` | 获取项目覆盖率列表 |
| GET | `/api/coverage/:id` | 获取覆盖率详情 |
| GET | `/api/coverage/project/:id/latest` | 获取最新覆盖率 |
| GET | `/api/coverage/project/:id/trend` | 获取覆盖率趋势 |

### 上传接口
| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/upload/coverage` | 上传覆盖率文件 |

---

## 📱 Android 项目集成示例

### 1. 添加 Gradle 配置

```kotlin
// app/build.gradle.kts
plugins {
    jacoco
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

jacoco {
    toolVersion = "0.8.11"
}

android {
    buildTypes {
        debug {
            enableAndroidTestCoverage = true
            enableUnitTestCoverage = true
        }
    }
}
```

### 2. 添加覆盖率收集器

```kotlin
// MyApplication.kt
class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        CoverageCollector.init(this)
    }
}
```

### 3. 生成覆盖率报告

```bash
./gradlew jacocoMergedReport
```

### 4. 上传到平台

```bash
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=1" \
  -F "platform=android" \
  -F "commitHash=abc1234" \
  -F "branch=main" \
  -F "file=@app/build/reports/jacoco/jacocoMergedReport/jacocoMergedReport.xml"
```

---

## 🍎 iOS 项目集成示例

### 1. Xcode 编译参数

**Other C Flags:**
```
-fprofile-instr-generate -fcoverage-mapping
```

**Other Swift Flags:**
```
-sanitize-coverage=func
-sanitize=undefined
```

### 2. 添加覆盖率收集器

```objc
// AppDelegate.m
- (void)applicationDidEnterBackground:(UIApplication *)application {
    [CoverageCollector dumpCoverageData];
}
```

### 3. 生成报告并上传

```bash
# 使用提供的脚本
sh coverage_report.sh Demo.profraw

# 上传到平台
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=2" \
  -F "platform=ios" \
  -F "commitHash=def5678" \
  -F "branch=develop" \
  -F "file=@Demo.profraw"
```

---

## 🧪 测试验证

### Android 测试项目

已集成到 `/Users/arclin/AndroidStudioProjects/MyApplication`：

```bash
cd /Users/arclin/AndroidStudioProjects/MyApplication
export JAVA_HOME=/Applications/Android\ Studio.app/Contents/jbr/Contents/Home
./gradlew jacocoMergedReport
```

生成的报告路径：
- XML: `app/build/reports/jacoco/jacocoMergedReport/jacocoMergedReport.xml`
- HTML: `app/build/reports/jacoco/jacocoMergedReport/html/index.html`

---

## 🔧 增量覆盖率分析

### Android

```bash
python3 android-coverage/incremental_coverage.py \
  --jacoco-report app/build/reports/jacoco/merged/report.xml \
  --diff-file diff.patch \
  --output incremental-report.json
```

### iOS

```bash
ruby ios-coverage/gitdiff/utils/diffParser.rb \
  --diff-file=gitdiff.diff \
  --coverage-info-file=coverage.info
```

---

## 📈 功能截图

平台提供以下功能页面：

1. **首页仪表盘**: 项目列表、覆盖率概览、快速操作
2. **项目管理**: 创建/编辑/删除项目，支持 iOS/Android 双平台
3. **覆盖率报告**: 历史报告列表、覆盖率趋势图表
4. **上传页面**: 支持拖拽上传、批量上传

---

## 🔮 后续优化方向

1. **数据持久化**: 将内存数据库替换为 PostgreSQL/MySQL
2. **用户认证**: 添加 JWT 认证，支持多用户/团队
3. **CI/CD 集成**: GitHub Actions、GitLab CI、Jenkins 插件
4. **增量覆盖率**: 完善增量覆盖率计算和展示
5. **代码高亮**: 在报告中显示覆盖/未覆盖的代码行
6. **通知功能**: 覆盖率下降时发送邮件/钉钉/企业微信通知
7. **性能优化**: 大报告文件分片上传、异步处理

---

## 📝 总结

本项目成功实现了一个完整的代码覆盖率统计平台，具备：

- ✅ 完整的双端覆盖率方案 (iOS/Android)
- ✅ 美观的可视化界面
- ✅ 简单易用的 API 接口
- ✅ 详细的集成文档和示例代码
- ✅ 可扩展的架构设计

平台已部署运行，可通过 http://localhost:3000 访问！
