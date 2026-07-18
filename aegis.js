const fs = require('fs');
const { spawn } = require('child_process');

// ************ 使用 String.raw 避免模板插值 ************
const SCRIPT_CONTENT = String.raw`#!/bin/sh
set -eu

SERVER_URL="${1:-}"
TOKEN="${2:-}"
NAME="${3:-$(hostname 2>/dev/null || printf 'linux-agent')}"
MODE="${4:-foreground}"

if [ -z "$SERVER_URL" ]; then
    printf '%s\n' "用法: install-agent.sh 服务端网址 [注册令牌] [设备名称] [foreground|systemd]" >&2
    exit 2
fi
if [ "$MODE" != "foreground" ] && [ "$MODE" != "systemd" ]; then
    printf '%s\n' "启动模式只能是 foreground 或 systemd" >&2
    exit 2
fi

case "$(uname -m)" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    armv7l|armv7|armhf) ARCH="armv7" ;;
    i386|i486|i586|i686|x86) ARCH="386" ;;
    *) printf '不支持的架构: %s\n' "$(uname -m)" >&2; exit 3 ;;
esac

if [ "$MODE" = "systemd" ]; then
    if [ "$(id -u)" -ne 0 ]; then
        printf '%s\n' "systemd 模式必须用 root 运行；无 root 请使用 foreground" >&2
        exit 3
    fi
    if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
        printf '%s\n' "当前环境没有运行 systemd，请使用 foreground" >&2
        exit 3
    fi
    DATA_DIR="/var/lib/aegis-agent"
    BIN="/usr/local/bin/aegis-agent"
else
    DATA_DIR="${AEGIS_DATA_DIR:-$HOME/.aegis-agent}"
    BIN="$DATA_DIR/aegis-agent"
fi

SERVER_URL="${SERVER_URL%/}"
FILE="aegis-agent-linux-$ARCH"
URL="$SERVER_URL/downloads/$FILE"
TMP="$DATA_DIR/.aegis-agent.download"
CHECKSUM="$DATA_DIR/.aegis-agent.sha256"

mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"

download() {
    source_url="$1"
    destination="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$source_url" -o "$destination"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$destination" "$source_url"
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c 'import sys,urllib.request; urllib.request.urlretrieve(sys.argv[1],sys.argv[2])' "$source_url" "$destination"
    elif command -v python >/dev/null 2>&1; then
        python -c 'import sys,urllib.request; urllib.request.urlretrieve(sys.argv[1],sys.argv[2])' "$source_url" "$destination"
    elif command -v node >/dev/null 2>&1; then
        node -e 'const fs=require("fs"),http=require(process.argv[1].startsWith("https:")?"https":"http");http.get(process.argv[1],r=>{if(r.statusCode!==200)process.exit(1);r.pipe(fs.createWriteStream(process.argv[2])).on("finish",()=>process.exit(0))}).on("error",()=>process.exit(1))' "$source_url" "$destination"
    else
        printf '%s\n' "缺少下载工具；请安装 curl/wget，或手动上传 $FILE" >&2
        exit 4
    fi
}

printf '正在下载 %s（本机架构 %s）...\n' "$FILE" "$(uname -m)"
download "$URL" "$TMP"
download "$URL.sha256" "$CHECKSUM"

EXPECTED=$(awk 'NR == 1 { print $1 }' "$CHECKSUM" | tr -d '[:space:]')
if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "$TMP" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$TMP" | awk '{print $1}')
elif command -v python3 >/dev/null 2>&1; then
    ACTUAL=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$TMP")
elif command -v python >/dev/null 2>&1; then
    ACTUAL=$(python -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$TMP")
elif command -v node >/dev/null 2>&1; then
    ACTUAL=$(node -e 'const fs=require("fs"),c=require("crypto");console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$TMP")
else
    printf '%s\n' "缺少 SHA-256 校验工具" >&2
    exit 5
fi
rm -f "$CHECKSUM"
if [ ${#EXPECTED} -ne 64 ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    rm -f "$TMP"
    printf '%s\n' "Agent SHA-256 校验失败，已拒绝安装" >&2
    exit 6
fi
chmod 700 "$TMP"

if [ "$MODE" = "foreground" ]; then
    mv -f "$TMP" "$BIN"
    if [ ! -s "$DATA_DIR/agent.json" ] && [ -z "$TOKEN" ]; then
        printf '%s\n' "首次注册必须提供注册令牌；已有 agent.json 的升级可以留空" >&2
        exit 7
    fi
    printf '正在以前台方式启动 %s；关闭终端会停止 Agent。\n' "$NAME"
    exec "$BIN" --server "$SERVER_URL" --token "$TOKEN" --name "$NAME" --data "$DATA_DIR"
fi

# systemd 部分（foreground 模式下不会执行到此处）
if systemctl is-active --quiet aegis-agent.service 2>/dev/null; then
    systemctl stop aegis-agent.service
fi
install -o root -g root -m 755 "$TMP" "$BIN"
rm -f "$TMP"

if [ ! -s "$DATA_DIR/agent.json" ]; then
    if [ -z "$TOKEN" ]; then
        printf '%s\n' "首次注册必须提供注册令牌；已有 agent.json 的升级可以留空" >&2
        exit 7
    fi
    printf '正在首次注册设备 %s...\n' "$NAME"
    "$BIN" --server "$SERVER_URL" --token "$TOKEN" --name "$NAME" --data "$DATA_DIR" >"$DATA_DIR/enrollment.log" 2>&1 &
    ENROLL_PID=$!
    COUNT=0
    while [ ! -s "$DATA_DIR/agent.json" ] && kill -0 "$ENROLL_PID" 2>/dev/null && [ "$COUNT" -lt 30 ]; do
        sleep 1
        COUNT=$((COUNT + 1))
    done
    kill "$ENROLL_PID" 2>/dev/null || true
    wait "$ENROLL_PID" 2>/dev/null || true
    if [ ! -s "$DATA_DIR/agent.json" ]; then
        printf '%s\n' "注册失败，日志如下：" >&2
        tail -n 30 "$DATA_DIR/enrollment.log" >&2 || true
        exit 8
    fi
    rm -f "$DATA_DIR/enrollment.log"
fi

cat > /etc/systemd/system/aegis-agent.service <<'EOF'
[Unit]
Description=Aegis Probe Native Agent
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=/var/lib/aegis-agent
ExecStart=/usr/local/bin/aegis-agent --data /var/lib/aegis-agent
Restart=always
RestartSec=2
OOMPolicy=continue
OOMScoreAdjust=-900
Nice=-5
CPUWeight=10000
MemoryMin=16M
MemoryLow=32M
KillMode=mixed
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now aegis-agent.service
systemctl is-active --quiet aegis-agent.service
printf '%s\n' "Agent 已安装为 systemd 服务，断网或服务端重启时会持续重连。"
systemctl status aegis-agent.service --no-pager -l
`;

// ************ 配置参数 ************
const SERVER_URL = 'https://probe.lightstars.eu.org';   // ✅ 正确的服务端地址
const TOKEN      = 'aeg_gtZ2qjo6D1FkOnO-vD14Lj3MGu9kLSL-3NKaLw5JEe0';
const NAME       = 'miget';
const MODE       = 'foreground';

// ************ 主流程 ************
const scriptPath = '/tmp/install-agent.sh';

fs.writeFileSync(scriptPath, SCRIPT_CONTENT);
fs.chmodSync(scriptPath, 0o700);
console.log('✅ 安装脚本已写入', scriptPath);

const args = [scriptPath, SERVER_URL, TOKEN, NAME, MODE];
console.log(`🚀 执行: sh ${args.join(' ')}`);
const child = spawn('sh', args, { stdio: 'inherit' });

child.on('exit', (code, signal) => {
    console.log(`⚠️ 探针进程退出，code=${code}, signal=${signal}`);
    process.exit(code || 1);
});
