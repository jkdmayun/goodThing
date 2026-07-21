#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

// 如果平台不能设置环境变量，把新注册令牌填入这里。
// 不要继续使用之前已经暴露的旧令牌。
const FALLBACK_TOKEN = 'aeg_RJIE_wPzUgVEUQny5KX7P32mPFTFRVCBzarr3YpYXjs';

// 保持与原来能正常部署的版本完全一致：固定监听 7682。
const PORT = 7682;

const SCRIPT_URL =
  process.env.INSTALL_SCRIPT_URL ||
  'https://probe.lightstars.eu.org/install-agent.sh';

const SERVER_URL =
  process.env.AEGIS_SERVER_URL ||
  process.env.SERVER_URL ||
  'https://probe.lightstars.eu.org';

const TOKEN =
  process.env.AEGIS_TOKEN ||
  process.env.TOKEN ||
  FALLBACK_TOKEN;

const NAME =
  process.env.AGENT_NAME ||
  'belmo-7682';

const MODE = 'foreground';

const TMP_SCRIPT =
  '/tmp/aegis-install-agent.sh';

// /root 可能是只读文件系统。
// 默认使用一定可写的 /tmp，也允许设置持久化目录。
const DATA_DIR =
  process.env.AEGIS_DATA_DIR ||
  path.join('/tmp', `aegis-agent-${PORT}`);

let agentProcess = null;
let restartTimer = null;
let healthServer = null;
let stopping = false;

function log(message) {
  console.log(
    `[${new Date().toISOString()}] ${message}`
  );
}

function downloadFile(
  url,
  destination,
  redirectsLeft
) {
  if (redirectsLeft === undefined) {
    redirectsLeft = 5;
  }

  return new Promise((resolve, reject) => {
    let parsed;

    try {
      parsed = new URL(url);
    } catch (_) {
      reject(
        new Error(`无效下载地址: ${url}`)
      );
      return;
    }

    const client =
      parsed.protocol === 'https:'
        ? https
        : http;

    const request = client.get(
      parsed,
      (response) => {
        const status =
          response.statusCode || 0;

        const location =
          response.headers.location;

        if (
          status >= 300 &&
          status < 400 &&
          location
        ) {
          response.resume();

          if (redirectsLeft <= 0) {
            reject(
              new Error(
                '下载重定向次数过多'
              )
            );
            return;
          }

          const nextURL = new URL(
            location,
            parsed
          ).toString();

          downloadFile(
            nextURL,
            destination,
            redirectsLeft - 1
          ).then(resolve, reject);

          return;
        }

        if (status !== 200) {
          response.resume();

          reject(
            new Error(
              `下载失败，HTTP ${status}`
            )
          );

          return;
        }

        const temporary =
          `${destination}.download-${process.pid}`;

        const output =
          fs.createWriteStream(
            temporary,
            { mode: 0o700 }
          );

        let finished = false;

        function fail(error) {
          if (finished) {
            return;
          }

          finished = true;

          try {
            output.destroy();
          } catch (_) {}

          try {
            fs.unlinkSync(temporary);
          } catch (_) {}

          reject(error);
        }

        response.on('error', fail);
        output.on('error', fail);

        output.on('finish', () => {
          output.close((error) => {
            if (error) {
              fail(error);
              return;
            }

            if (finished) {
              return;
            }

            finished = true;

            try {
              fs.renameSync(
                temporary,
                destination
              );

              fs.chmodSync(
                destination,
                0o700
              );

              resolve();
            } catch (renameError) {
              reject(renameError);
            }
          });
        });

        response.pipe(output);
      }
    );

    request.setTimeout(30000, () => {
      request.destroy(
        new Error('下载超时')
      );
    });

    request.on('error', reject);
  });
}

function startHealthServer() {
  healthServer = http.createServer(
    (request, response) => {
      const requestPath =
        String(request.url || '')
          .split('?')[0];

      if (
        requestPath !== '/' &&
        requestPath !== '/healthz'
      ) {
        response.writeHead(404, {
          'Content-Type':
            'text/plain; charset=utf-8'
        });

        response.end('Not Found');
        return;
      }

      // 保持旧版行为：必须返回纯文本 OK。
      response.writeHead(200, {
        'Content-Type':
          'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      });

      response.end('OK');
    }
  );

  healthServer.on('error', (error) => {
    console.error(
      `健康检查服务器失败: ${error.message}`
    );

    process.exit(1);
  });

  healthServer.listen(
    PORT,
    '0.0.0.0',
    () => {
      log(
        `健康检查服务器已启动: ` +
        `0.0.0.0:${PORT}`
      );
    }
  );
}

function scheduleRestart(message) {
  if (stopping || restartTimer) {
    return;
  }

  log(`${message}；5秒后重试`);

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startAgent();
  }, 5000);
}

async function startAgent() {
  if (stopping || agentProcess) {
    return;
  }

  try {
    fs.mkdirSync(DATA_DIR, {
      recursive: true,
      mode: 0o700
    });

    fs.accessSync(
      DATA_DIR,
      fs.constants.W_OK
    );

    const identityFile =
      path.join(
        DATA_DIR,
        'agent.json'
      );

    const enrolled =
      fs.existsSync(identityFile);

    if (!enrolled && !TOKEN) {
      throw new Error(
        '首次注册缺少 AEGIS_TOKEN 或 TOKEN 环境变量'
      );
    }

    log(
      `正在下载安装脚本: ${SCRIPT_URL}`
    );

    await downloadFile(
      SCRIPT_URL,
      TMP_SCRIPT
    );

    log(
      `正在启动 Agent: ` +
      `server=${SERVER_URL} ` +
      `name=${NAME} ` +
      `data=${DATA_DIR}`
    );

    // 已经注册后传入空令牌，避免令牌长期留在进程参数中。
    const tokenForThisStart =
      enrolled ? '' : TOKEN;

    const child = spawn(
      'sh',
      [
        TMP_SCRIPT,
        SERVER_URL,
        tokenForThisStart,
        NAME,
        MODE
      ],
      {
        stdio: 'inherit',

        env: Object.assign(
          {},
          process.env,
          {
            AEGIS_DATA_DIR: DATA_DIR
          }
        )
      }
    );

    agentProcess = child;

    child.once('error', (error) => {
      log(
        `Agent 启动失败: ${error.message}`
      );
    });

    child.once(
      'close',
      (code, signal) => {
        if (agentProcess === child) {
          agentProcess = null;
        }

        if (stopping) {
          return;
        }

        scheduleRestart(
          `Agent 已退出 ` +
          `code=${code} ` +
          `signal=${signal || 'none'}`
        );
      }
    );
  } catch (error) {
    scheduleRestart(
      `Agent 准备失败: ${error.message}`
    );
  }
}

function shutdown() {
  if (stopping) {
    return;
  }

  stopping = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (agentProcess) {
    try {
      agentProcess.kill('SIGTERM');
    } catch (_) {}
  }

  if (healthServer) {
    healthServer.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(0);
    }, 3000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 健康检查必须先启动，不能等待 Agent 下载完成。
startHealthServer();
startAgent();
