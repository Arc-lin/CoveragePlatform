# 后端 API 文档

Code Coverage Platform 后端提供 RESTful API，支持项目管理、覆盖率报告、文件上传和 Build 管理等功能。

**Base URL:** `http://localhost:3001/api`

## 通用响应格式

所有 API 响应遵循统一格式：

```json
{
  "success": true,
  "data": { ... },
  "message": "可选的消息"
}
```

错误响应：

```json
{
  "success": false,
  "message": "错误描述",
  "error": "详细错误信息（仅开发环境）"
}
```

---

## 全局端点

### `GET /health`

健康检查。

**响应示例：**
```json
{ "status": "ok", "timestamp": "2026-03-07T04:00:00.000Z" }
```

### `GET /api`

返回所有 API 端点的自描述文档。

---

## 项目 API (`/api/projects`)

### `GET /api/projects`

获取所有项目，支持搜索和筛选。

| Query 参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| `search` | string | 否 | 模糊搜索项目名 |
| `platform` | `ios` \| `android` \| `python` | 否 | 按平台筛选 |

> `search` 优先级高于 `platform`，两者同时提供时仅使用 `search`。

**响应 (200)：**
```json
{
  "success": true,
  "data": [
    {
      "id": "60f7...",
      "name": "MyApp",
      "platform": "ios",
      "repositoryUrl": "https://github.com/user/repo",
      "createdAt": "2026-03-01T00:00:00.000Z",
      "updatedAt": "2026-03-07T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/projects`

创建项目。

**请求体 (JSON)：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 项目名称 |
| `platform` | `ios` \| `android` \| `python` | 是 | 平台类型 |
| `repositoryUrl` | string | 是 | 代码仓库地址 |

**响应 (201)：** 返回创建的 Project 对象。

### `GET /api/projects/:id`

获取项目详情。

**错误：** 404 — 项目不存在

### `PUT /api/projects/:id`

更新项目。请求体中的字段均为可选，只更新提供的字段。

### `DELETE /api/projects/:id`

删除项目（级联删除关联的覆盖率报告）。

---

## 覆盖率 API (`/api/coverage`)

### `GET /api/coverage/project/:projectId`

获取项目的所有覆盖率报告列表。

**错误：** 404 — 项目不存在

### `GET /api/coverage/:id`

获取覆盖率报告详情。

**响应 (200)：**
```json
{
  "success": true,
  "data": {
    "id": "60f7...",
    "projectId": "60f6...",
    "commitHash": "abc1234",
    "branch": "main",
    "lineCoverage": 85.5,
    "functionCoverage": 90.0,
    "branchCoverage": 78.2,
    "incrementalCoverage": 92.0,
    "gitDiff": "...",
    "reportPath": "/path/to/report",
    "buildId": "60f8...",
    "source": "manual",
    "createdAt": "2026-03-07T00:00:00.000Z"
  }
}
```

### `GET /api/coverage/project/:projectId/latest`

获取项目最新一条覆盖率报告。

### `GET /api/coverage/project/latest-batch?ids=id1,id2,id3`

批量获取多个项目的最新覆盖率报告。

| Query 参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| `ids` | string | 是 | 逗号分隔的项目 ID |

### `GET /api/coverage/project/:projectId/trend?days=30`

获取覆盖率趋势数据。

| Query 参数 | 类型 | 必填 | 默认值 | 说明 |
|-----------|------|------|--------|------|
| `days` | number | 否 | 30 | 回溯天数 |

### `GET /api/coverage/project/:projectId/summary`

获取项目覆盖率汇总信息。

### `GET /api/coverage/:id/files`

获取报告中各文件的覆盖率列表。

### `GET /api/coverage/:id/file?path=src/main.ts`

获取单个文件的行级覆盖率详情。

| Query 参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| `path` | string | 是 | 文件路径（需 URL 编码） |

**响应 (200)：**
```json
{
  "success": true,
  "data": {
    "filePath": "src/main.ts",
    "lineCoverage": 85.0,
    "totalLines": 100,
    "coveredLines": 85,
    "lines": [
      { "lineNumber": 1, "executionCount": 5, "isCovered": true }
    ]
  }
}
```

### `GET /api/coverage/:id/file/incremental?path=src/main.ts`

获取单个文件的增量覆盖率（仅显示变更行）。响应额外包含 `incrementalSummary` 字段。

### `POST /api/coverage/:id/incremental-files`

提交 git diff 获取增量文件覆盖率。

**请求体 (JSON)：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `diffContent` | string | 是 | git diff 原始输出 |

**响应 (200)：**
```json
{
  "success": true,
  "data": [ ... ],
  "summary": {
    "totalFiles": 5,
    "totalChangedLines": 120,
    "averageIncrementalCoverage": 87.5
  }
}
```

### `GET /api/coverage/:id/incremental`

使用报告已存储的 gitDiff 获取增量文件覆盖率（无需额外提交 diff）。

### `GET /api/coverage/:id/source?path=src/main.ts`

从 GitHub 获取源代码文件内容。仅支持 GitHub 仓库。

### `DELETE /api/coverage/:id`

删除覆盖率报告。

---

## 上传 API (`/api/upload`)

### `POST /api/upload/coverage`

上传覆盖率数据文件并创建报告。

**Content-Type:** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | 是 | 覆盖率文件（`.ec`, `.exec`, `.profraw`, `.profdata`, `.info`, `.xml`, `.json`, `.zip`） |
| `projectId` | string | 是 | 项目 ID |
| `commitHash` | string | 是 | Git commit hash |
| `branch` | string | 是 | Git 分支名 |
| `platform` | string | 否 | 覆盖项目默认平台 |
| `gitDiff` | string | 否 | Git diff 内容（用于增量覆盖率） |

**文件大小限制：** 100 MB

**响应 (201)：**
```json
{
  "success": true,
  "message": "Coverage report uploaded successfully",
  "reportId": "60f7...",
  "data": {
    "lineCoverage": 85.5,
    "functionCoverage": 90.0,
    "branchCoverage": 78.2,
    "incrementalCoverage": 92.0
  }
}
```

**curl 示例：**
```bash
# iOS (LCOV)
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=60f6abcd1234567890abcdef" \
  -F "commitHash=abc1234" \
  -F "branch=main" \
  -F "file=@coverage.info"

# Android (JaCoCo XML)
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=60f6abcd1234567890abcdef" \
  -F "commitHash=abc1234" \
  -F "branch=main" \
  -F "file=@jacocoTestReport.xml"

# Python (Cobertura XML)
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=60f6abcd1234567890abcdef" \
  -F "commitHash=abc1234" \
  -F "branch=main" \
  -F "file=@coverage.xml"

# Python (带增量覆盖率)
curl -X POST http://localhost:3001/api/upload/coverage \
  -F "projectId=60f6abcd1234567890abcdef" \
  -F "commitHash=abc1234" \
  -F "branch=feature-branch" \
  -F "file=@coverage.xml" \
  -F "gitDiff=</tmp/diff.txt"
```

### `POST /api/upload/coverage/batch`

批量上传覆盖率文件（**尚未实现**，返回 501）。

---

## Build API (`/api/builds`)

Build 管理用于自动化覆盖率收集流程：开发者上传构建产物 → 测试人员使用 App → SDK 自动上传原始覆盖率 → 服务端合并生成报告。

### `POST /api/builds`

创建 Build（上传构建产物）。

**Content-Type:** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `binary` | File | 是 | 构建产物（iOS: Mach-O 二进制；Android: classfiles.zip） |
| `projectId` | string | 是 | 项目 ID |
| `commitHash` | string | 是 | Git commit hash |
| `branch` | string | 是 | Git 分支名 |
| `buildVersion` | string | 否 | 构建版本号 |
| `gitDiff` | string | 否 | Git diff 内容 |

**文件大小限制：** 500 MB

**响应 (201)：**
```json
{
  "success": true,
  "data": {
    "id": "60f8...",
    "projectId": "60f6...",
    "platform": "ios",
    "commitHash": "abc1234",
    "branch": "main",
    "buildVersion": "1.0.0",
    "binaryPath": "/path/to/binary",
    "status": "ready",
    "rawUploadCount": 0,
    "createdAt": "2026-03-07T00:00:00.000Z",
    "updatedAt": "2026-03-07T00:00:00.000Z"
  }
}
```

### `POST /api/builds/from-pgyer`

从蒲公英（Pgyer）下载 IPA 自动创建 Build（仅限 iOS）。

**请求体 (JSON)：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `projectId` | string | 是 | 项目 ID |
| `pgyerUrl` | string | 是 | 蒲公英下载页 URL（如 `https://www.pgyer.com/xxxxx`） |
| `commitHash` | string | 是 | Git commit hash |
| `branch` | string | 是 | Git 分支名 |
| `buildVersion` | string | 否 | 构建版本号 |
| `gitDiff` | string | 否 | Git diff 内容 |

**响应 (202)：** 立即返回任务 ID，下载在后台异步执行。
```json
{ "success": true, "data": { "taskId": "uuid-string" } }
```

使用 SSE 接口 `GET /api/builds/pgyer-progress/:taskId` 监听进度。

### `GET /api/builds/pgyer-progress/:taskId`

蒲公英下载进度的 Server-Sent Events (SSE) 流。

**响应类型：** `text/event-stream`

每 500ms 推送一个事件，格式：
```
data: {"status":"downloading","filename":"App_1.0.ipa","progress":{"downloaded":5242880,"total":104857600}}
```

状态流转：`fetching_plist` → `downloading` → `extracting` → `complete` / `error`

### `POST /api/builds/:buildId/raw-coverage`

SDK 上传原始覆盖率文件并自动触发合并。

**Content-Type:** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | 是 | 原始覆盖率文件（iOS: `.profraw`；Android: `.ec` / `.exec`） |
| `deviceInfo` | string | 否 | 设备信息 |
| `testerName` | string | 否 | 测试人员名 |

**文件大小限制：** 100 MB

**行为：** 上传后自动合并所有已上传的原始文件，生成/更新覆盖率报告。使用 per-build 锁防止并发合并。

### `GET /api/builds/project/:projectId`

获取项目的所有 Build 列表。

### `GET /api/builds/:buildId`

获取 Build 详情。

### `GET /api/builds/:buildId/raw-uploads`

获取 Build 的所有原始覆盖率上传记录。

### `POST /api/builds/:buildId/remerge`

强制重新合并 Build 的所有原始覆盖率文件。

### `DELETE /api/builds/:buildId`

删除 Build（级联删除磁盘文件、原始上传记录和合并报告）。

---

## 端点总览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api` | API 文档索引 |
| **项目** | | |
| GET | `/api/projects` | 获取所有项目 |
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/:id` | 获取项目详情 |
| PUT | `/api/projects/:id` | 更新项目 |
| DELETE | `/api/projects/:id` | 删除项目 |
| **覆盖率** | | |
| GET | `/api/coverage/project/:projectId` | 获取项目报告列表 |
| GET | `/api/coverage/project/latest-batch` | 批量获取最新报告 |
| GET | `/api/coverage/project/:projectId/latest` | 获取最新报告 |
| GET | `/api/coverage/project/:projectId/trend` | 获取趋势数据 |
| GET | `/api/coverage/project/:projectId/summary` | 获取汇总信息 |
| GET | `/api/coverage/:id` | 获取报告详情 |
| GET | `/api/coverage/:id/files` | 获取文件覆盖率列表 |
| GET | `/api/coverage/:id/file` | 获取文件行级覆盖率 |
| GET | `/api/coverage/:id/file/incremental` | 获取文件增量覆盖率 |
| GET | `/api/coverage/:id/incremental` | 获取增量文件列表 |
| POST | `/api/coverage/:id/incremental-files` | 提交 diff 获取增量 |
| GET | `/api/coverage/:id/source` | 获取源代码 |
| DELETE | `/api/coverage/:id` | 删除报告 |
| **上传** | | |
| POST | `/api/upload/coverage` | 上传覆盖率文件 |
| POST | `/api/upload/coverage/batch` | 批量上传（未实现） |
| **Build** | | |
| POST | `/api/builds` | 创建 Build（上传产物） |
| POST | `/api/builds/from-pgyer` | 从蒲公英下载创建 Build |
| GET | `/api/builds/pgyer-progress/:taskId` | 下载进度 SSE |
| POST | `/api/builds/:buildId/raw-coverage` | SDK 上传原始覆盖率 |
| GET | `/api/builds/project/:projectId` | 获取项目 Build 列表 |
| GET | `/api/builds/:buildId` | 获取 Build 详情 |
| GET | `/api/builds/:buildId/raw-uploads` | 获取原始上传列表 |
| POST | `/api/builds/:buildId/remerge` | 强制重新合并 |
| DELETE | `/api/builds/:buildId` | 删除 Build |
