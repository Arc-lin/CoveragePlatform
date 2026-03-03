#!/bin/bash

# Code Coverage Platform 启动脚本
# 使用方法: ./start.sh [backend|frontend|all]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

start_backend() {
    print_info "Starting Backend Server..."
    cd "$SCRIPT_DIR/backend"
    
    # 检查依赖
    if [ ! -d "node_modules" ]; then
        print_warn "Backend dependencies not found, installing..."
        npm install
    fi
    
    # 启动服务
    npm run dev &
    BACKEND_PID=$!
    echo $BACKEND_PID > /tmp/coverage-backend.pid
    print_success "Backend started on http://localhost:3001 (PID: $BACKEND_PID)"
}

start_frontend() {
    print_info "Starting Frontend App..."
    cd "$SCRIPT_DIR/frontend"
    
    # 检查依赖
    if [ ! -d "node_modules" ]; then
        print_warn "Frontend dependencies not found, installing..."
        npm install --legacy-peer-deps
    fi
    
    # 启动应用
    npm start &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > /tmp/coverage-frontend.pid
    print_success "Frontend started on http://localhost:3000 (PID: $FRONTEND_PID)"
}

stop_all() {
    print_info "Stopping all services..."
    
    if [ -f /tmp/coverage-backend.pid ]; then
        kill $(cat /tmp/coverage-backend.pid) 2>/dev/null || true
        rm -f /tmp/coverage-backend.pid
        print_info "Backend stopped"
    fi
    
    if [ -f /tmp/coverage-frontend.pid ]; then
        kill $(cat /tmp/coverage-frontend.pid) 2>/dev/null || true
        rm -f /tmp/coverage-frontend.pid
        print_info "Frontend stopped"
    fi
    
    print_success "All services stopped"
}

show_help() {
    echo "Code Coverage Platform 启动脚本"
    echo ""
    echo "使用方法: ./start.sh [command]"
    echo ""
    echo "Commands:"
    echo "  backend     只启动后端服务"
    echo "  frontend    只启动前端应用"
    echo "  all         启动前后端服务 (默认)"
    echo "  stop        停止所有服务"
    echo "  status      查看服务状态"
    echo "  help        显示帮助信息"
    echo ""
    echo "示例:"
    echo "  ./start.sh all     # 启动完整平台"
    echo "  ./start.sh backend # 只启动后端"
    echo "  ./start.sh stop    # 停止所有服务"
}

check_status() {
    echo "Service Status:"
    echo "---------------"
    
    if [ -f /tmp/coverage-backend.pid ] && kill -0 $(cat /tmp/coverage-backend.pid) 2>/dev/null; then
        print_success "Backend: Running (PID: $(cat /tmp/coverage-backend.pid))"
        echo "  URL: http://localhost:3001"
    else
        print_error "Backend: Stopped"
    fi
    
    if [ -f /tmp/coverage-frontend.pid ] && kill -0 $(cat /tmp/coverage-frontend.pid) 2>/dev/null; then
        print_success "Frontend: Running (PID: $(cat /tmp/coverage-frontend.pid))"
        echo "  URL: http://localhost:3000"
    else
        print_error "Frontend: Stopped"
    fi
}

# 捕获 Ctrl+C 信号
trap stop_all SIGINT SIGTERM

# 主逻辑
case "${1:-all}" in
    backend)
        start_backend
        wait
        ;;
    frontend)
        start_frontend
        wait
        ;;
    all)
        print_info "Starting Code Coverage Platform..."
        start_backend
        sleep 2
        start_frontend
        print_success "=================================="
        print_success "Platform is running!"
        print_success "=================================="
        print_info "Backend:  http://localhost:3001"
        print_info "Frontend: http://localhost:3000"
        print_info ""
        print_info "Press Ctrl+C to stop all services"
        wait
        ;;
    stop)
        stop_all
        ;;
    status)
        check_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
