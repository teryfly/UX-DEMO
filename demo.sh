#!/bin/bash

# UX DEMO 演示服务管理脚本
# 使用方式: ./demo.sh start|stop|restart|status

PORT=1599
HOST="0.0.0.0"
PID_FILE="/tmp/ux-demo-server.pid"
LOG_FILE="/tmp/ux-demo-server.log"
SERVER_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/server.js"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印信息函数
print_info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

print_success() {
    echo -e "${GREEN}✓ ${NC}$1"
}

print_error() {
    echo -e "${RED}✗ ${NC}$1"
}

print_warning() {
    echo -e "${YELLOW}⚠ ${NC}$1"
}

# 启动服务
start_server() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            print_warning "服务已在运行 (PID: $pid)"
            return 1
        fi
    fi

    print_info "启动 UX DEMO 服务..."
    nohup node "$SERVER_FILE" > "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"

    sleep 1

    if kill -0 "$pid" 2>/dev/null; then
        print_success "服务启动成功 (PID: $pid)"
        print_info "访问地址: http://10.5.0.4:${PORT}"
        print_info "日志文件: $LOG_FILE"
        return 0
    else
        print_error "服务启动失败，请检查日志:"
        cat "$LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
}

# 停止服务
stop_server() {
    if [ ! -f "$PID_FILE" ]; then
        print_warning "服务未运行"
        return 1
    fi

    local pid=$(cat "$PID_FILE")
    if ! kill -0 "$pid" 2>/dev/null; then
        print_warning "进程已不存在 (PID: $pid)"
        rm -f "$PID_FILE"
        return 1
    fi

    print_info "停止服务 (PID: $pid)..."
    kill "$pid"

    local count=0
    while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
        sleep 0.5
        ((count++))
    done

    if kill -0 "$pid" 2>/dev/null; then
        print_warning "进程未响应，强制杀死..."
        kill -9 "$pid"
    fi

    rm -f "$PID_FILE"
    print_success "服务已停止"
    return 0
}

# 重启服务
restart_server() {
    print_info "重启 UX DEMO 服务..."
    stop_server
    sleep 1
    start_server
}

# 查询服务状态
status_server() {
    if [ ! -f "$PID_FILE" ]; then
        print_warning "服务未运行"
        return 1
    fi

    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        print_success "服务运行中 (PID: $pid)"
        print_info "访问地址: http://10.5.0.4:${PORT}"
        print_info "日志文件: $LOG_FILE"
        echo ""
        print_info "最近日志:"
        tail -n 5 "$LOG_FILE"
        return 0
    else
        print_error "进程已停止 (PID: $pid)"
        rm -f "$PID_FILE"
        return 1
    fi
}

# 显示日志
show_log() {
    if [ ! -f "$LOG_FILE" ]; then
        print_warning "日志文件不存在"
        return 1
    fi

    print_info "显示实时日志 (Ctrl+C 退出)..."
    tail -f "$LOG_FILE"
}

# 显示帮助
show_help() {
    cat << EOF
${BLUE}UX DEMO 演示服务管理脚本${NC}

使用方式:
    ./demo.sh start     - 启动服务
    ./demo.sh stop      - 停止服务
    ./demo.sh restart   - 重启服务
    ./demo.sh status    - 查询服务状态
    ./demo.sh log       - 显示实时日志
    ./demo.sh help      - 显示此帮助信息

示例:
    # 启动服务
    ./demo.sh start

    # 查看状态
    ./demo.sh status

    # 显示日志
    ./demo.sh log

    # 停止服务
    ./demo.sh stop

访问地址: http://10.5.0.4:${PORT}
日志文件: ${LOG_FILE}
PID文件: ${PID_FILE}

EOF
}

# 主程序
case "${1:-help}" in
    start)
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        restart_server
        ;;
    status)
        status_server
        ;;
    log)
        show_log
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        print_error "未知命令: $1"
        echo ""
        show_help
        exit 1
        ;;
esac

exit $?
