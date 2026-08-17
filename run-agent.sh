#!/bin/sh
# goodThing 一键启动器（与 node index.js 等价，不依赖 Node 的前台版本）
#
# 用法：
#   sh run-agent.sh                  # 已注册（存在 agent.json）后直接跑，无需令牌
#   TOKEN=你的注册令牌 sh run-agent.sh  # 首次注册必须给令牌
#
# - 自动检测 systemd：有则用 systemd 模式（安装为常驻服务），否则前台模式
# - 前台模式自带守护循环：agent 退出后 5 秒自动重启
# - 检测到 agent.json 自动跳过令牌；令牌按 环境变量 > .env.local > .env 读取
set -eu

SERVER_URL="${SERVER_URL:-https://probe.lightstars.eu.org/}"
INSTALL_SCRIPT_URL="${INSTALL_SCRIPT_URL:-${SERVER_URL%/}/install-agent.sh}"
AEGIS_DATA_DIR="${AEGIS_DATA_DIR:-$HOME/.aegis-agent}"

# 从文件读取令牌（保留已设置的环境变量优先），去掉行尾引号/空白
read_token_from() {
  [ -f "$1" ] || return 0
  grep -s '^TOKEN=' "$1" 2>/dev/null | tail -n 1 | sed 's/^TOKEN=//; s/^["'"'"']//; s/["'"'"']$//' || true
}
if [ -z "${TOKEN:-}" ]; then
  TOKEN="$(read_token_from .env.local)"
fi
if [ -z "${TOKEN:-}" ]; then
  TOKEN="$(read_token_from .env)"
fi
export TOKEN

# 模式检测（与原命令块一致）
MODE=foreground
if [ "$(id -u)" -eq 0 ] && command -v systemctl >/dev/null 2>&1 && \
   [ "$(ps -p 1 -o comm= | tr -d '[:space:]')" = "systemd" ]; then
  MODE=systemd
fi

# 下载安装脚本
curl -fsSL "$INSTALL_SCRIPT_URL" -o /tmp/install-agent.sh
chmod 700 /tmp/install-agent.sh

if [ "$MODE" = "systemd" ]; then
  echo "[run-agent] systemd 模式：安装并启用 aegis-agent 服务"
  exec sh /tmp/install-agent.sh "$SERVER_URL" "$TOKEN" "$(hostname)" systemd
fi

# 前台模式 + 守护循环
echo "[run-agent] 前台模式：${SERVER_URL}（数据目录 $AEGIS_DATA_DIR）"
while :; do
  sh /tmp/install-agent.sh "$SERVER_URL" "$TOKEN" "$(hostname)" foreground \
    || echo "[run-agent] agent 退出（code $?），5 秒后重启…" >&2
  sleep 5
done
