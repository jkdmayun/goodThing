const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'install-agent.sh');
const SERVER_URL = 'https://probe.lightstars.eu.org';
const TOKEN      = 'aeg_gtZ2qjo6D1FkOnO-vD14Lj3MGu9kLSL-3NKaLw5JEe0';
const NAME       = 'miget';
const MODE       = 'foreground';

// 1. 读取原始安装脚本
let scriptContent = fs.readFileSync(SCRIPT_PATH, 'utf8');

// 2. 修改启动命令，添加 --insecure（跳过证书验证）
//    原行：exec "$BIN" --server "$SERVER_URL" --token "$TOKEN" --name "$NAME" --data "$DATA_DIR"
//    改为：exec "$BIN" --server "$SERVER_URL" --token "$TOKEN" --name "$NAME" --data "$DATA_DIR" --insecure
scriptContent = scriptContent.replace(
    /exec "\$BIN" --server "\$SERVER_URL" --token "\$TOKEN" --name "\$NAME" --data "\$DATA_DIR"/,
    'exec "$BIN" --server "$SERVER_URL" --token "$TOKEN" --name "$NAME" --data "$DATA_DIR" --insecure'
);

// 3. 将修改后的脚本写入临时文件
const tmpScript = '/tmp/install-agent.sh';
fs.writeFileSync(tmpScript, scriptContent);
fs.chmodSync(tmpScript, 0o700);

console.log('✅ 已生成修改后的安装脚本（含 --insecure）');

// 4. 执行脚本
const args = [tmpScript, SERVER_URL, TOKEN, NAME, MODE];
console.log(`🚀 执行: sh ${args.join(' ')}`);
const child = spawn('sh', args, { stdio: 'inherit' });

child.on('exit', (code, signal) => {
    console.log(`⚠️ 探针进程退出，code=${code}, signal=${signal}`);
    process.exit(code || 1);
});
