const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const https = require('https');

// 远程脚本 URL
const SCRIPT_URL = 'https://probe.lightstars.eu.org/install-agent.sh';
// 环境变量（建议从 process.env 读取）
const SERVER_URL = process.env.SERVER_URL || 'https://probe.lightstars.eu.org/';
const TOKEN      = process.env.TOKEN || 'aeg_gtZ2qjo6D1FkOnO-vD14Lj3MGu9kLSL-3NKaLw5JEe0';
const NAME       = 'Back4App';
const MODE       = 'foreground';

// 临时文件路径
const TMP_SCRIPT = '/tmp/install-agent.sh';

/**
 * 从 URL 下载文件
 */
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            // 处理重定向
            if (response.statusCode === 301 || response.statusCode === 302) {
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`下载失败，HTTP ${response.statusCode}`));
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

async function main() {
    try {
        console.log(`📥 正在下载脚本: ${SCRIPT_URL}`);
        await downloadFile(SCRIPT_URL, TMP_SCRIPT);
        console.log('✅ 下载完成');

        // 添加可执行权限
        fs.chmodSync(TMP_SCRIPT, 0o700);

        // 读取并修改脚本（添加 --insecure）
        let scriptContent = fs.readFileSync(TMP_SCRIPT, 'utf8');
        scriptContent = scriptContent.replace(
            /exec "\$BIN" --server "\$SERVER_URL" --token "\$TOKEN" --name "\$NAME" --data "\$DATA_DIR"/,
            'exec "$BIN" --server "$SERVER_URL" --token "$TOKEN" --name "$NAME" --data "$DATA_DIR" --insecure'
        );
        fs.writeFileSync(TMP_SCRIPT, scriptContent);
        console.log('✅ 已添加 --insecure 参数');

        // 执行脚本
        const args = [TMP_SCRIPT, SERVER_URL, TOKEN, NAME, MODE];
        console.log(`🚀 执行: sh ${args.join(' ')}`);
        const child = spawn('sh', args, { stdio: 'inherit' });

        child.on('exit', (code, signal) => {
            console.log(`⚠️ 探针进程退出，code=${code}, signal=${signal}`);
            process.exit(code || 1);
        });

    } catch (err) {
        console.error(`❌ 错误: ${err.message}`);
        process.exit(1);
    }
}

main();
// #!/usr/bin/env node
// 'use strict';

// const fs = require('fs');
// const os = require('os');
// const path = require('path');
// const http = require('http');
// const https = require('https');
// const crypto = require('crypto');
// const { spawn, spawnSync } = require('child_process');

// process.umask(0o077);

// const APP_PORT = toInt(process.env.PORT, 7682);
// const HY2_PORT = toInt(process.env.HY2_PORT, APP_PORT);
// const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

// const PUBLIC_HOST = cleanHost(process.env.PUBLIC_HOST || '');
// const PUBLIC_PORT = toInt(process.env.PUBLIC_PORT, HY2_PORT);

// const ENV_SUB_PATH = normalizeSubPath(process.env.SUB_PATH || process.env.TOKEN_PATH || '');

// const SNI_HOST = cleanHost(process.env.SNI_HOST || 'www.bing.com') || 'www.bing.com';
// const SNI_GUARD = process.env.SNI_GUARD || 'strict';

// const NODE_NAME_ENV = process.env.NODE_NAME || '';
// const AUTH_PASS_ENV = process.env.AUTH_PASS || '';

// const DEFAULT_BASE64 = /^(1|true|yes)$/i.test(process.env.SUB_BASE64 || '');

// const BASE_DIR = process.env.HY2_DIR || path.join(process.env.HOME || process.cwd(), '.mvh-hy2');
// const BIN = path.join(BASE_DIR, 'hysteria');
// const CONF = path.join(BASE_DIR, 'config.yaml');
// const STATE = path.join(BASE_DIR, 'state.json');
// const CERT = path.join(BASE_DIR, 'cert.pem');
// const KEY = path.join(BASE_DIR, 'key.pem');
// const LOG = path.join(BASE_DIR, 'mvh-hy2.log');

// let state = null;
// let certPin = '';
// let currentChild = null;
// let httpServer = null;
// let stopping = false;

// function toInt(value, fallback) {
//   const n = Number(value);
//   return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
// }

// function ensureDir(dir) {
//   fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
// }

// function log(line) {
//   const msg = `[${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')}] ${line}`;
//   process.stdout.write(msg + '\n');
//   try {
//     fs.appendFileSync(LOG, msg + '\n');
//   } catch (_) {}
// }

// function cleanHost(value) {
//   return String(value || '')
//     .trim()
//     .replace(/^https?:\/\//i, '')
//     .replace(/\/.*$/, '')
//     .replace(/^\[/, '')
//     .replace(/\]$/, '')
//     .replace(/:\d+$/, '');
// }

// function normalizeSubPath(value) {
//   const raw = String(value || '').trim();
//   if (!raw) return '';
//   return raw.replace(/^\/+/, '').replace(/\/+$/, '');
// }

// function randomHex(bytes = 16) {
//   return crypto.randomBytes(bytes).toString('hex');
// }

// function readJson(file, fallback) {
//   try {
//     return JSON.parse(fs.readFileSync(file, 'utf8'));
//   } catch (_) {
//     return fallback;
//   }
// }

// function writeFileSecure(file, content, mode = 0o600) {
//   fs.writeFileSync(file, content, { mode });
//   try {
//     fs.chmodSync(file, mode);
//   } catch (_) {}
// }

// function saveState(nextState) {
//   writeFileSecure(STATE, JSON.stringify(nextState, null, 2) + '\n');
// }

// function initState() {
//   const existing = readJson(STATE, {});

//   const next = {
//     authPass: AUTH_PASS_ENV || existing.authPass || randomHex(16),
//     nodeName: NODE_NAME_ENV || existing.nodeName || 'MVH-HY2',
//     subPath: ENV_SUB_PATH || existing.subPath || `sub-${randomHex(18)}`,
//     createdAt: existing.createdAt || new Date().toISOString()
//   };

//   saveState(next);
//   return next;
// }

// function pickAsset() {
//   const arch = os.arch();

//   if (arch === 'x64') return 'hysteria-linux-amd64';
//   if (arch === 'arm64') return 'hysteria-linux-arm64';
//   if (arch === 'arm') return 'hysteria-linux-arm';
//   if (arch === 'ia32') return 'hysteria-linux-386';

//   return '';
// }

// function downloadToFile(url, destPath, mode = 0o700) {
//   return new Promise((resolve, reject) => {
//     const tmp = `${destPath}.download`;

//     try {
//       fs.rmSync(tmp, { force: true });
//     } catch (_) {}

//     const file = fs.createWriteStream(tmp, { mode: 0o600 });

//     function request(u, redirectsLeft = 5) {
//       https
//         .get(u, (res) => {
//           if (
//             res.statusCode >= 300 &&
//             res.statusCode < 400 &&
//             res.headers.location &&
//             redirectsLeft > 0
//           ) {
//             res.resume();
//             return request(new URL(res.headers.location, u).toString(), redirectsLeft - 1);
//           }

//           if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
//             res.resume();
//             file.close(() => reject(new Error(`download failed: HTTP ${res.statusCode}`)));
//             return;
//           }

//           res.pipe(file);

//           file.on('finish', () => {
//             file.close(() => {
//               try {
//                 fs.renameSync(tmp, destPath);
//                 fs.chmodSync(destPath, mode);
//                 resolve();
//               } catch (e) {
//                 reject(e);
//               }
//             });
//           });
//         })
//         .on('error', (err) => {
//           try {
//             file.close();
//           } catch (_) {}
//           reject(err);
//         });
//     }

//     request(url);
//   });
// }

// function binaryWorks() {
//   if (!fs.existsSync(BIN)) return false;

//   try {
//     const r = spawnSync(BIN, ['version'], {
//       encoding: 'utf8',
//       timeout: 8000
//     });

//     return r.status === 0;
//   } catch (_) {
//     return false;
//   }
// }

// async function ensureBinary() {
//   if (binaryWorks()) {
//     log(`[hy2] binary exists: ${BIN}`);
//     return;
//   }

//   const asset = pickAsset();
//   if (!asset) throw new Error(`unsupported architecture: ${os.arch()}`);

//   const url = `https://download.hysteria.network/app/latest/${asset}`;

//   log(`[hy2] downloading ${asset}`);
//   await downloadToFile(url, BIN, 0o700);

//   if (!binaryWorks()) {
//     throw new Error('downloaded hysteria binary cannot run');
//   }

//   log('[hy2] binary ready');
// }

// function ensureOpenSSL() {
//   const r = spawnSync('openssl', ['version'], {
//     encoding: 'utf8'
//   });

//   if (r.status !== 0) {
//     throw new Error('openssl not found');
//   }
// }

// function ensureCert() {
//   ensureOpenSSL();

//   if (fs.existsSync(CERT) && fs.existsSync(KEY)) {
//     return;
//   }

//   log(`[tls] generating self-signed cert for ${SNI_HOST}`);

//   const args = [
//     'req',
//     '-x509',
//     '-newkey',
//     'rsa:2048',
//     '-nodes',
//     '-keyout',
//     KEY,
//     '-out',
//     CERT,
//     '-days',
//     '3650',
//     '-subj',
//     `/CN=${SNI_HOST}`,
//     '-addext',
//     `subjectAltName=DNS:${SNI_HOST}`
//   ];

//   const r = spawnSync('openssl', args, {
//     stdio: 'ignore'
//   });

//   if (r.status !== 0) {
//     throw new Error(`openssl cert generation failed, status=${r.status}`);
//   }

//   try {
//     fs.chmodSync(KEY, 0o600);
//     fs.chmodSync(CERT, 0o600);
//   } catch (_) {}
// }

// function getCertPin() {
//   const r = spawnSync(
//     'openssl',
//     ['x509', '-noout', '-fingerprint', '-sha256', '-in', CERT],
//     {
//       encoding: 'utf8'
//     }
//   );

//   if (r.status !== 0) {
//     throw new Error('failed to read certificate fingerprint');
//   }

//   const out = String(r.stdout || '').trim();
//   const pin = out.split('=').pop().trim();

//   if (!pin || !/^[0-9A-Fa-f:]+$/.test(pin)) {
//     throw new Error(`invalid certificate fingerprint: ${out}`);
//   }

//   return pin.toUpperCase();
// }

// function writeHy2Config() {
//   const yaml = [
//     `listen: :${HY2_PORT}`,
//     '',
//     'tls:',
//     `  cert: ${CERT}`,
//     `  key: ${KEY}`,
//     `  sniGuard: ${SNI_GUARD}`,
//     '',
//     'auth:',
//     '  type: password',
//     `  password: ${JSON.stringify(state.authPass)}`,
//     '',
//     'masquerade:',
//     '  type: proxy',
//     '  proxy:',
//     '    url: https://www.bing.com/',
//     '    rewriteHost: true',
//     '',
//     'quic:',
//     '  initStreamReceiveWindow: 8388608',
//     '  maxStreamReceiveWindow: 8388608',
//     '  initConnReceiveWindow: 20971520',
//     '  maxConnReceiveWindow: 20971520',
//     '  maxIdleTimeout: 30s',
//     '  maxIncomingStreams: 1024',
//     '  disablePathMTUDiscovery: false',
//     ''
//   ].join('\n');

//   writeFileSecure(CONF, yaml);
//   log(`[hy2] config written: ${CONF}`);
// }

// function getRequestHost(req) {
//   const xfHost = req.headers['x-forwarded-host'];
//   const hostHeader = Array.isArray(xfHost) ? xfHost[0] : xfHost || req.headers.host || '';
//   return cleanHost(hostHeader);
// }

// function buildHy2Uri(req) {
//   const host = PUBLIC_HOST || getRequestHost(req) || 'your-domain.com';
//   const port = PUBLIC_PORT || HY2_PORT;

//   const auth = encodeURIComponent(state.authPass);
//   const name = encodeURIComponent(state.nodeName);

//   const query = new URLSearchParams({
//     insecure: '1',
//     sni: SNI_HOST,
//     pinSHA256: certPin
//   });

//   return `hysteria2://${auth}@${host}:${port}/?${query.toString()}#${name}`;
// }

// function buildSubUrl(req) {
//   const proto =
//     String(req.headers['x-forwarded-proto'] || '')
//       .split(',')[0]
//       .trim() || 'https';

//   const host = req.headers['x-forwarded-host'] || req.headers.host || PUBLIC_HOST || 'your-domain.com';

//   return `${proto}://${host}/${state.subPath}`;
// }

// function send(res, status, content, type = 'text/plain; charset=utf-8') {
//   const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content));

//   res.writeHead(status, {
//     'content-type': type,
//     'content-length': body.length,
//     'cache-control': 'no-store'
//   });

//   res.end(body);
// }

// function startHttpServer() {
//   httpServer = http.createServer((req, res) => {
//     const url = new URL(req.url, 'http://127.0.0.1');

//     const pathname = decodeURIComponent(url.pathname)
//       .replace(/^\/+/, '')
//       .replace(/\/+$/, '');

//     if (req.method !== 'GET' && req.method !== 'HEAD') {
//       return send(res, 405, 'Method Not Allowed\n');
//     }

//     if (pathname === state.subPath) {
//       const uri = buildHy2Uri(req);

//       const wantBase64 =
//         DEFAULT_BASE64 ||
//         /^(1|true|yes)$/i.test(
//           url.searchParams.get('base64') ||
//           url.searchParams.get('b64') ||
//           ''
//         );

//       const body = wantBase64
//         ? Buffer.from(uri + '\n').toString('base64') + '\n'
//         : uri + '\n';

//       return send(res, 200, body);
//     }

//     if (pathname === `${state.subPath}/json`) {
//       const uri = buildHy2Uri(req);

//       return send(
//         res,
//         200,
//         JSON.stringify(
//           {
//             subscription: buildSubUrl(req),
//             node: uri,
//             auth: state.authPass,
//             host: PUBLIC_HOST || getRequestHost(req),
//             port: PUBLIC_PORT || HY2_PORT,
//             sni: SNI_HOST,
//             pinSHA256: certPin
//           },
//           null,
//           2
//         ) + '\n',
//         'application/json; charset=utf-8'
//       );
//     }

//     if (pathname === 'healthz') {
//       return send(res, 200, 'ok\n');
//     }

//     return send(res, 404, 'Not Found\n');
//   });

//   httpServer.listen(APP_PORT, BIND_HOST, () => {
//     log(`[web] listening tcp://${BIND_HOST}:${APP_PORT}`);
//     log(`[hy2] listening udp://0.0.0.0:${HY2_PORT}`);
//     log(`[web] subscription path: /${state.subPath}`);

//     if (PUBLIC_HOST) {
//       log(`[web] subscription URL: https://${PUBLIC_HOST}/${state.subPath}`);
//     } else {
//       log('[web] PUBLIC_HOST is empty; subscription host will be generated from request Host');
//     }
//   });

//   httpServer.on('error', (err) => {
//     log(`[web] fatal: ${err.stack || err.message || err}`);
//     process.exit(1);
//   });
// }

// async function runHy2Forever() {
//   await ensureBinary();

//   let backoff = 2;

//   while (!stopping) {
//     log(`[hy2] starting server with ${CONF}`);

//     currentChild = spawn(BIN, ['server', '-c', CONF], {
//       stdio: ['ignore', 'pipe', 'pipe'],
//       env: {
//         ...process.env,
//         HYSTERIA_DISABLE_UPDATE_CHECK: '1'
//       }
//     });

//     currentChild.stdout.on('data', (d) => {
//       process.stdout.write(`[hy2 stdout] ${d}`);
//     });

//     currentChild.stderr.on('data', (d) => {
//       process.stderr.write(`[hy2 stderr] ${d}`);
//     });

//     const exitInfo = await new Promise((resolve) => {
//       currentChild.on('exit', (code, signal) => resolve({ code, signal }));
//       currentChild.on('error', (error) => resolve({ error }));
//     });

//     currentChild = null;

//     if (stopping) break;

//     if (exitInfo.error) {
//       log(`[hy2] failed to start: ${exitInfo.error.message || exitInfo.error}`);
//     } else {
//       log(`[hy2] exited: code=${exitInfo.code} signal=${exitInfo.signal}`);
//     }

//     log(`[hy2] restart after ${backoff}s`);

//     await new Promise((r) => setTimeout(r, backoff * 1000));
//     backoff = Math.min(backoff * 2, 30);
//   }
// }

// function shutdown(signal) {
//   stopping = true;
//   log(`[signal] ${signal}, shutting down`);

//   try {
//     if (currentChild) currentChild.kill('SIGTERM');
//   } catch (_) {}

//   try {
//     if (httpServer) {
//       httpServer.close(() => process.exit(0));
//     }
//   } catch (_) {
//     process.exit(0);
//   }

//   setTimeout(() => process.exit(0), 3000).unref();
// }

// process.on('SIGINT', () => shutdown('SIGINT'));
// process.on('SIGTERM', () => shutdown('SIGTERM'));

// process.on('uncaughtException', (err) => {
//   log(`[uncaughtException] ${err.stack || err.message || err}`);
// });

// process.on('unhandledRejection', (err) => {
//   log(`[unhandledRejection] ${err.stack || err.message || err}`);
// });

// (async () => {
//   ensureDir(BASE_DIR);

//   state = initState();

//   ensureCert();
//   certPin = getCertPin();

//   writeHy2Config();
//   startHttpServer();

//   log(`[node] ${buildHy2Uri({ headers: { host: PUBLIC_HOST || 'your-domain.com' } })}`);

//   await runHy2Forever();
// })().catch((err) => {
//   log(`[fatal] ${err.stack || err.message || err}`);
//   process.exit(1);
// });
