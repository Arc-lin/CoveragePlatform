#!/bin/bash

# CoveragePlatform 启动脚本（生产版本）
# 用法：./start-coverage-platform-prod.sh [YOUR_LOCAL_IP]
# 例如：./start-coverage-platform-prod.sh 192.168.0.113

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_BUILD_DIR="$SCRIPT_DIR/frontend/build"
MONGODB_DIR="/Users/ling/Downloads/mongodb-macos-aarch64--8.2.5"
DATA_DIR="$SCRIPT_DIR/data/db"

export PATH="$MONGODB_DIR/bin:$PATH"

# 获取局域网 IP（如果没有传入参数）
if [ -n "$1" ]; then
    LOCAL_IP="$1"
else
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
fi

echo "========================================"
echo "  CoveragePlatform 启动脚本（生产版）"
echo "========================================"
echo "  本机 IP: $LOCAL_IP"
echo ""

# 停止之前的服务
echo "正在停止之前的服务..."
pkill -x mongod 2>/dev/null
pkill -f "ts-node-dev" 2>/dev/null
pkill -f "react-scripts start" 2>/dev/null
pkill -f "serve" 2>/dev/null
sleep 2

# 启动 MongoDB 服务
start_mongodb() {
    echo "正在启动 MongoDB..."
    mkdir -p "$DATA_DIR"
    $MONGODB_DIR/bin/mongod --dbpath "$DATA_DIR" --bind_ip localhost > /tmp/mongodb.log 2>&1 &
    sleep 3
    if pgrep -x "mongod" > /dev/null; then
        echo "✅ MongoDB 服务已启动"
        return 0
    else
        echo "❌ MongoDB 启动失败"
        cat /tmp/mongodb.log
        return 1
    fi
}

# 启动后端服务
start_backend() {
    echo "正在启动后端服务..."
    cd "$BACKEND_DIR"

    # 检查 .env 文件是否存在
    if [ ! -f ".env" ]; then
        echo "创建 .env 配置文件..."
        cp .env.example .env
    fi

    # 后台启动后端
    npm run dev > /tmp/coverage-backend.log 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID > /tmp/coverage-backend.pid
    echo "✅ 后端服务已启动 (PID: $BACKEND_PID)"
    echo "   访问地址：http://$LOCAL_IP:3001"
}

# 启动前端服务（使用生产构建）
start_frontend() {
    echo "正在启动前端服务（生产版本）..."
    cd "$FRONTEND_BUILD_DIR"

    # 使用 serve 启动静态文件服务，配置代理
    serve -s . -l 3000 --cors > /tmp/coverage-frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > /tmp/coverage-frontend.pid
    echo "✅ 前端服务已启动 (PID: $FRONTEND_PID)"
    echo "   访问地址：http://$LOCAL_IP:3000"
}

# 主函数
main() {
    echo ""
    echo "步骤 1/3: 启动 MongoDB 服务..."
    start_mongodb

    echo ""
    echo "步骤 2/3: 启动后端服务..."
    start_backend

    echo ""
    echo "步骤 3/3: 启动前端服务..."
    start_frontend

    echo ""
    echo "========================================"
    echo "  🎉 启动完成!"
    echo "========================================"
    echo ""
    echo "  📱 局域网访问地址："
    echo "     前端：http://$LOCAL_IP:3000"
    echo "     后端：http://$LOCAL_IP:3001"
    echo ""
    echo "  🏠 本机访问地址："
    echo "     前端：http://localhost:3000"
    echo "     后端：http://localhost:3001"
    echo ""
    echo "  停止服务："
    echo "    pkill -x mongod"
    echo "    pkill -f 'ts-node-dev'"
    echo "    pkill -f 'serve'"
    echo ""
    echo "  查看日志："
    echo "    tail -f /tmp/mongodb.log"
    echo "    tail -f /tmp/coverage-backend.log"
    echo "    tail -f /tmp/coverage-frontend.log"
    echo ""
}

main
