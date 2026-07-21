const SCRIPT_URL = 'https://probe.lightstars.eu.org/install-agent.sh';
const SERVER_URL = process.env.SERVER_URL || 'https://probe.lightstars.eu.org/';
const TOKEN      = process.env.TOKEN || 'aeg_gtZ2qjo6D1FkOnO-vD14Lj3MGu9kLSL-3NKaLw5JEe0';
const NAME       = 'Back4App-7682';
const NAME       = 'belmo-7682';
const MODE       = 'foreground';
const TMP_SCRIPT = '/tmp/install-agent.sh';

// ---------- 下载远程脚本 ----------
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`下载失败，HTTP ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
            file.on('error', reject);
        }).on('error', reject);
    });
}

// ---------- 启动 HTTP 服务器（监听 7682） ----------
function startHealthCheckServer() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    });
    server.listen(7682, '0.0.0.0', () => {
        console.log('✅ 健康检查 HTTP 服务器已启动，监听端口 7682');
    });
    server.on('error', (err) => {
        console.error('❌ 启动 HTTP 服务器失败:', err.message);
        process.exit(1);
    });
    return server;
}

// ---------- 主流程 ----------
async function main() {
    // 1. 先启动 HTTP 服务器（确保健康检查通过）
    startHealthCheckServer();

    // 2. 检查环境变量
    if (!SERVER_URL || !TOKEN) {
        console.warn('⚠️  环境变量 SERVER_URL 或 TOKEN 未设置，Agent 将不会被启动。');
        console.warn('    但容器仍然会保持运行（因 HTTP 服务器存在）。');
        // 不退出，让容器存活
        return;
    }

    // 3. 下载并执行 Agent 安装脚本
    try {
        console.log(`📥 正在下载脚本: ${SCRIPT_URL}`);
        await downloadFile(SCRIPT_URL, TMP_SCRIPT);
        console.log('✅ 下载完成');
        fs.chmodSync(TMP_SCRIPT, 0o700);

        console.log('🚀 正在启动 Agent...');
        console.log(`📋 参数: SERVER_URL=${SERVER_URL}, TOKEN=${TOKEN}, NAME=${NAME}, MODE=${MODE}`);

        const args = [TMP_SCRIPT, SERVER_URL, TOKEN, NAME, MODE];
        const child = spawn('sh', args, { stdio: 'inherit' });

        child.on('exit', (code, signal) => {
            console.log(`⚠️  Agent 进程退出，code=${code}, signal=${signal}`);
            // 不退出进程，HTTP 服务器继续运行
        });

        console.log('✅ Agent 启动命令已执行，等待其运行...');
    } catch (err) {
        console.error(`❌ 下载或启动 Agent 失败: ${err.message}`);
        // 即使 Agent 启动失败，HTTP 服务器仍在运行，容器不会退出
        console.warn('⚠️  由于 HTTP 服务器存在，容器将继续运行，但 Agent 可能未正常工作。');
    }
}

main();
