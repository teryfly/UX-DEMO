#!/usr/bin/env bash
# 启动「手术安全核查制度闭环管理系统」仿真演示
cd "$(dirname "$0")"
PORT="${1:-8099}"
echo "正在启动演示服务： http://localhost:${PORT}/"
echo "（按 Ctrl+C 停止）"
python3 -m http.server "$PORT"
