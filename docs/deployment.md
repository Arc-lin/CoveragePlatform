# 部署指南

本文档介绍 Code Coverage Platform 的部署方式，包括环境准备、服务配置和生产部署。

---

## 环境要求

### 必需

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 18.x | 后端和前端构建 |
| MongoDB | >= 6.0 | 数据存储 |
| npm | >= 9.x | 包管理 |

### 可选（覆盖率转换工具）

| 依赖 | 适用平台 | 说明 |
|------|---------|------|
| Xcode Command Line Tools | iOS | 提供 `xcrun llvm-profdata` 和 `xcrun llvm-cov` |
| Java Runtime (JRE/JDK) | Android | 运行 JaCoCo CLI |
| jacococli.jar | Android | 放置于 `backend/tools/jacococli.jar` |
| `unzip` | 通用 | 解压 IPA/ZIP 文件（macOS/Linux 系统自带） |
| `plutil` | iOS | 解析 Info.plist（macOS 系统自带） |

> **Python 项目**不需要安装额外的服务端工具。Python 覆盖率报告（Cobertura XML / LCOV / JSON）由用户本地或 CI 中生成后直接上传，服务端仅解析报告文件。
>
> 如果不需要 Build 自动合并功能（仅使用手动上传已处理的覆盖率文件），可以不安装可选工具。

---

## 快速启动（开发环境）

### 1. 启动 MongoDB

```bash
# macOS (Homebrew)
brew services start mongodb-community

# Docker
docker run -d --name mongo -p 27017:27017 mongo:7
```

### 2. 启动后端

```bash
cd backend
npm install
npm run dev
```

后端服务运行在 `http://localhost:3001`。

### 3. 启动前端

```bash
cd frontend
npm install
npm start
```

前端应用运行在 `http://localhost:3000`。

---

## 环境变量

### 后端

在 `backend/` 目录下创建 `.env` 文件：

```env
# 服务端口（默认 3001）
PORT=3001

# MongoDB 连接地址（默认 mongodb://localhost:27017/coverage）
MONGODB_URI=mongodb://localhost:27017/coverage

# 运行环境（development 时错误响应包含详细信息）
NODE_ENV=production
```

### 前端

在 `frontend/` 目录下创建 `.env` 文件：

```env
# 后端 API 地址（默认 http://localhost:3001/api）
REACT_APP_API_URL=http://your-server:3001/api
```

---

## 生产部署

### 方式一：直接部署

#### 1. 构建后端

```bash
cd backend
npm install
npm run build
```

编译产物在 `backend/dist/` 目录。

#### 2. 构建前端

```bash
cd frontend
npm install
npm run build
```

编译产物在 `frontend/build/` 目录。

#### 3. 运行后端

```bash
cd backend
NODE_ENV=production node dist/index.js
```

推荐使用 PM2 管理进程：

```bash
npm install -g pm2
cd backend
pm2 start dist/index.js --name coverage-backend
pm2 save
pm2 startup  # 设置开机自启
```

#### 4. 部署前端

前端构建产物是静态文件，可使用 Nginx 提供服务：

```nginx
server {
    listen 80;
    server_name coverage.example.com;

    # 前端静态文件
    location / {
        root /path/to/frontend/build;
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;           # 大文件上传需要较长超时
        client_max_body_size 500m;         # 匹配后端 500MB 上传限制
    }

    # SSE 进度推送需要关闭缓冲
    location /api/builds/pgyer-progress/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        proxy_buffering off;               # SSE 必需
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 600s;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:3001;
    }
}
```

### 方式二：Docker 部署

#### Dockerfile（后端）

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 安装 unzip（用于 IPA/ZIP 解压）
RUN apk add --no-cache unzip

COPY backend/package*.json ./
RUN npm ci --production

COPY backend/dist/ ./dist/

# 创建必要目录
RUN mkdir -p uploads reports builds tools

EXPOSE 3001

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

#### Dockerfile（前端）

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  mongo:
    image: mongo:7
    volumes:
      - mongo-data:/data/db
    ports:
      - "27017:27017"

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "3001:3001"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/coverage
      - NODE_ENV=production
    volumes:
      - uploads-data:/app/uploads
      - reports-data:/app/reports
      - builds-data:/app/builds
      - ./backend/tools:/app/tools    # JaCoCo CLI 等工具
    depends_on:
      - mongo

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  mongo-data:
  uploads-data:
  reports-data:
  builds-data:
```

启动：

```bash
# 先构建后端
cd backend && npm run build && cd ..

# 启动所有服务
docker-compose up -d
```

---

## 磁盘存储说明

后端服务使用以下目录存储数据（相对于 `backend/`）：

| 目录 | 说明 | 大小估算 |
|------|------|---------|
| `uploads/` | 临时上传暂存（处理后自动清理） | 较小 |
| `reports/` | 手动上传的覆盖率报告永久存储 | 每文件 1-50 MB |
| `builds/` | Build 产物、原始覆盖率、合并报告 | 每 Build 10-500 MB |
| `tools/` | 外部工具（如 jacococli.jar） | < 10 MB |

**磁盘规划建议：** 根据团队规模和 Build 频率，预留 10-100 GB 磁盘空间。定期清理过期 Build 可释放空间。

Build 目录结构：
```
builds/{projectId}/{buildId}/
├── binary/          # 构建产物（Mach-O / classfiles.zip / IPA）
├── raw/             # 原始覆盖率文件（.profraw / .ec）
└── merged/          # 合并产物（merged.profdata / merged.info / merged.exec / merged_report.xml）
```

---

## iOS 覆盖率工具安装

macOS 环境需安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

验证：

```bash
xcrun llvm-profdata -h
xcrun llvm-cov -h
```

---

## Android 覆盖率工具安装

### 1. 安装 Java

```bash
# macOS
brew install openjdk

# Ubuntu
sudo apt install default-jdk
```

### 2. 下载 JaCoCo CLI

从 [JaCoCo 官网](https://www.jacoco.org/jacoco/) 下载最新版 jacococli.jar，放置到：

```
backend/tools/jacococli.jar
```

验证：

```bash
java -jar backend/tools/jacococli.jar version
```

---

## 验证部署

```bash
# 1. 健康检查
curl http://localhost:3001/health

# 2. 查看 API 文档
curl http://localhost:3001/api

# 3. 创建测试项目
curl -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"TestApp","platform":"ios","repositoryUrl":"https://github.com/test/repo"}'

# 4. 创建 Python 测试项目
curl -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"PyApp","platform":"python","repositoryUrl":"https://github.com/test/pyrepo"}'

# 5. 检查前端
open http://localhost:3000
```

---

## 常见问题

### MongoDB 连接失败

确认 MongoDB 正在运行，检查 `MONGODB_URI` 配置。如使用 Docker，确保服务间网络互通。

### 上传文件超时

Nginx 默认超时较短，确保配置了 `proxy_read_timeout 300s` 和 `client_max_body_size 500m`。

### iOS 工具不可用

确认在 macOS 环境运行，且已安装 Xcode Command Line Tools。Linux 环境不支持 iOS 覆盖率转换。

### SSE 进度不更新

确保 Nginx 配置了 `proxy_buffering off`，否则 SSE 事件会被缓冲导致前端收不到实时更新。

### 蒲公英下载失败

检查服务器是否能访问 `pgyer.com`。蒲公英下载链接有时效性，过期需重试。部分私有应用可能需要登录才能下载。
