const fs = require('fs');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

const SCRIPT_URL =
    process.env.INSTALL_SCRIPT_URL ||
    'https://probe.lightstars.eu.org/install-agent.sh';

const SERVER_URL =
    process.env.SERVER_URL ||
    'https://probe.lightstars.eu.org/';

// 优先读取平台环境变量。
// 如果平台不能设置环境变量，把新令牌填入下面的空字符串。
const TOKEN =
    process.env.TOKEN ||
    'aeg_RJIE_wPzUgVEUQny5KX7P32mPFTFRVCBzarr3YpYXjs';

// 保持原来的设备名称。
const NAME = 'belmo-7682';
const MODE = 'foreground';
const TMP_SCRIPT = '/tmp/install-agent.sh';

// 唯一关键修复：不再使用只读的 /root/.aegis-agent。
const DATA_DIR =
    process.env.AEGIS_DATA_DIR ||
    '/tmp/aegis-agent-7682';

// ---------- 下载远程脚本 ----------
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);

        const client =
            url.startsWith('https:')
                ? https
                : http;

        client.get(url, (response) => {
            if (
                response.statusCode === 301 ||
                response.statusCode === 302
            ) {
                response.resume();

                file.close(() => {
                    const nextURL = new URL(
                        response.headers.location,
                        url
                    ).toString();

                    downloadFile(nextURL, dest)
                        .then(resolve)
                        .catch(reject);
                });

                return;
            }

            if (response.statusCode !== 200) {
                response.resume();

                file.close(() => {
                    reject(
                        new Error(
                            `下载失败，HTTP ${response.statusCode}`
                        )
                    );
                });

                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });

            file.on('error', reject);
        }).on('error', reject);
    });
}

// ---------- 启动 HTTP 服务器（监听 7682） ----------
function startHealthCheckServer() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/plain'
        });

        res.end('OK');
    });

    server.listen(7682, '0.0.0.0', () => {
        console.log(
            '✅ 健康检查 HTTP 服务器已启动，监听端口 7682'
        );
    });

    server.on('error', (err) => {
        console.error(
            '❌ 启动 HTTP 服务器失败:',
            err.message
        );

        process.exit(1);
    });

    return server;
}

// ---------- 主流程 ----------
async function main() {
    // 1. 先启动 HTTP 服务器。
    startHealthCheckServer();

    // 2. 没有令牌时保持 HTTP 服务运行。
    if (!SERVER_URL || !TOKEN) {
        console.warn(
            '⚠️ 环境变量 SERVER_URL 或 TOKEN 未设置，Agent 将不会被启动。'
        );

        console.warn(
            '   但容器仍然会保持运行（因 HTTP 服务器存在）。'
        );

        return;
    }

    // 3. 下载并执行 Agent 安装脚本。
    try {
        console.log(
            `📥 正在下载脚本: ${SCRIPT_URL}`
        );

        await downloadFile(
            SCRIPT_URL,
            TMP_SCRIPT
        );

        console.log('✅ 下载完成');

        fs.chmodSync(
            TMP_SCRIPT,
            0o700
        );

        console.log(
            '🚀 正在启动 Agent...'
        );

        // 不再把注册令牌输出到日志。
        console.log(
            `📋 参数: SERVER_URL=${SERVER_URL}, ` +
            `TOKEN=<已隐藏>, ` +
            `NAME=${NAME}, ` +
            `MODE=${MODE}, ` +
            `DATA_DIR=${DATA_DIR}`
        );

        const args = [
            TMP_SCRIPT,
            SERVER_URL,
            TOKEN,
            NAME,
            MODE
        ];

        const child = spawn(
            'sh',
            args,
            {
                stdio: 'inherit',

                // 把可写目录传给 install-agent.sh。
                env: Object.assign(
                    {},
                    process.env,
                    {
                        AEGIS_DATA_DIR:
                            DATA_DIR
                    }
                )
            }
        );

        child.on('exit', (code, signal) => {
            console.log(
                `⚠️ Agent 进程退出，` +
                `code=${code}, ` +
                `signal=${signal}`
            );
        });

        console.log(
            '✅ Agent 启动命令已执行，等待其运行...'
        );
    } catch (err) {
        console.error(
            `❌ 下载或启动 Agent 失败: ${err.message}`
        );

        console.warn(
            '⚠️ 由于 HTTP 服务器存在，容器将继续运行，但 Agent 可能未正常工作。'
        );
    }
}

main();
