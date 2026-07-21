#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

process.umask(0o077);

// 如果平台不能设置环境变量，可把新注册令牌填入下面的引号中。
const FALLBACK_TOKEN = '';

const PORT = positiveInteger(process.env.PORT, 7682);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

const ALLOW_INSECURE_HTTP = /^(1|true|yes)$/i.test(
  process.env.AEGIS_INSECURE_HTTP || ''
);

// 不在程序加载阶段校验，以免配置错误导致健康检查也无法启动。
const RAW_SERVER_URL = String(
  process.env.AEGIS_SERVER_URL ||
  process.env.SERVER_URL ||
  'https://probe.lightstars.eu.org'
).trim();

const TOKEN = String(
  process.env.AEGIS_TOKEN ||
  process.env.TOKEN ||
  FALLBACK_TOKEN
).trim();
const FALLBACK_TOKEN = 'aeg_RJIE_wPzUgVEUQny5KX7P32mPFTFRVCBzarr3YpYXjs';
const AGENT_NAME = String(
  process.env.AGENT_NAME ||
  `belmo-${PORT}`
).trim();

const EXPECTED_VERSION = String(
  process.env.AEGIS_EXPECT_VERSION ||
  '1.4.2'
).trim();

const state = {
  startedAt: Date.now(),
  dataDir: '',
  agentVersion: '',
  agentRunning: false,
  agentPid: 0,
  enrolled: false,
  lastStartAt: 0,
  lastExitCode: null,
  lastExitSignal: '',
  lastError: '',
  restartCount: 0
};

let dataDir = '';
let agentBinary = '';
let serverURL = '';
let agentChild = null;
let healthServer = null;
let restartTimer = null;
let enrollmentTimer = null;
let stopping = false;
let restartAttempt = 0;
let enrollmentRestartRequested = false;

function positiveInteger(value, fallback) {
  const parsed = Number(value);

  return (
    Number.isInteger(parsed) &&
    parsed > 0 &&
    parsed <= 65535
  ) ? parsed : fallback;
}

function normalizeServerURL(value) {
  let parsed;

  try {
    parsed = new URL(String(value || '').trim());
  } catch (_) {
    throw new Error('SERVER_URL不是有效网址');
  }

  if (
    parsed.protocol !== 'https:' &&
    parsed.protocol !== 'http:'
  ) {
    throw new Error('SERVER_URL只支持HTTPS或HTTP');
  }

  if (
    parsed.protocol === 'http:' &&
    !isLoopback(parsed.hostname) &&
    !ALLOW_INSECURE_HTTP
  ) {
    throw new Error('非本机HTTP不安全；请使用HTTPS');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';

  return parsed.toString().replace(/\/+$/, '');
}

function isLoopback(hostname) {
  const value = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();

  return (
    value === '127.0.0.1' ||
    value === 'localhost' ||
    value === '::1'
  );
}

function log(message) {
  const timestamp = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');

  process.stdout.write(`[${timestamp}] ${message}\n`);
}

function safeRemove(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch (_) {
    // 忽略临时文件不存在或无法删除。
  }
}

function candidateDataDirectories() {
  const candidates = [];

  if (process.env.AEGIS_DATA_DIR) {
    candidates.push({
      path: path.resolve(process.env.AEGIS_DATA_DIR),
      persistent: true,
      source: 'AEGIS_DATA_DIR'
    });
  }

  candidates.push({
    path: path.join(process.cwd(), '.aegis-agent'),
    persistent: true,
    source: '当前项目目录'
  });

  for (const base of ['/data', '/workspace']) {
    if (fs.existsSync(base)) {
      candidates.push({
        path: path.join(base, '.aegis-agent'),
        persistent: true,
        source: base
      });
    }
  }

  if (process.env.HOME) {
    candidates.push({
      path: path.join(
        process.env.HOME,
        '.aegis-agent'
      ),
      persistent: process.env.HOME !== '/tmp',
      source: 'HOME'
    });
  }

  candidates.push({
    path: path.join(
      os.tmpdir(),
      `aegis-agent-${PORT}`
    ),
    persistent: false,
    source: '临时目录'
  });

  const seen = new Set();

  return candidates.filter((item) => {
    const resolved = path.resolve(item.path);

    if (seen.has(resolved)) {
      return false;
    }

    seen.add(resolved);
    item.path = resolved;

    return true;
  });
}

function testWritableExecutableDirectory(directory) {
  const writeTest = path.join(
    directory,
    `.aegis-write-test-${process.pid}`
  );

  const execTest = path.join(
    directory,
    `.aegis-exec-test-${process.pid}.sh`
  );

  try {
    fs.mkdirSync(directory, {
      recursive: true,
      mode: 0o700
    });

    try {
      fs.chmodSync(directory, 0o700);
    } catch (_) {
      // 某些挂载目录不允许 chmod，但仍可能可写。
    }

    fs.writeFileSync(writeTest, 'ok\n', {
      mode: 0o600
    });

    fs.writeFileSync(
      execTest,
      '#!/bin/sh\nexit 0\n',
      { mode: 0o700 }
    );

    fs.chmodSync(execTest, 0o700);

    const result = spawnSync(execTest, [], {
      stdio: 'ignore',
      timeout: 3000
    });

    if (result.status !== 0) {
      throw new Error(
        result.error
          ? result.error.message
          : '目录禁止执行程序'
      );
    }

    return {
      ok: true,
      error: ''
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  } finally {
    safeRemove(writeTest);
    safeRemove(execTest);
  }
}

function chooseDataDirectory() {
  const failures = [];

  for (const candidate of candidateDataDirectories()) {
    const result = testWritableExecutableDirectory(
      candidate.path
    );

    if (!result.ok) {
      failures.push(
        `${candidate.path}: ${result.error}`
      );
      continue;
    }

    if (!candidate.persistent) {
      log(
        `⚠️ 只能使用临时目录 ${candidate.path}；` +
        '容器重建后可能需要重新注册'
      );
    }

    log(
      `✅ Agent数据目录: ${candidate.path}` +
      `（${candidate.source}）`
    );

    return candidate.path;
  }

  throw new Error(
    '找不到可写且允许执行程序的目录：' +
    failures.join('；')
  );
}

function copyIdentityIfAvailable(destination) {
  const destinationIdentity = path.join(
    destination,
    'agent.json'
  );

  if (fs.existsSync(destinationIdentity)) {
    return;
  }

  const oldDirectories = [
    process.env.HOME
      ? path.join(process.env.HOME, '.aegis-agent')
      : '',
    '/root/.aegis-agent'
  ];

  for (const oldDirectory of oldDirectories) {
    if (
      !oldDirectory ||
      path.resolve(oldDirectory) ===
      path.resolve(destination)
    ) {
      continue;
    }

    const oldIdentity = path.join(
      oldDirectory,
      'agent.json'
    );

    try {
      if (!fs.statSync(oldIdentity).isFile()) {
        continue;
      }

      fs.copyFileSync(
        oldIdentity,
        destinationIdentity,
        fs.constants.COPYFILE_EXCL
      );

      fs.chmodSync(
        destinationIdentity,
        0o600
      );

      log(
        `✅ 已从 ${oldIdentity} 迁移原Agent身份，` +
        '无需重新注册'
      );

      return;
    } catch (_) {
      // 继续检查其他旧目录。
    }
  }
}

function assetForCurrentArchitecture() {
  switch (process.arch) {
    case 'x64':
      return 'aegis-agent-linux-amd64';

    case 'arm64':
      return 'aegis-agent-linux-arm64';

    case 'arm':
      return 'aegis-agent-linux-armv7';

    case 'ia32':
      return 'aegis-agent-linux-386';

    default:
      throw new Error(
        `不支持的CPU架构: ${process.arch}`
      );
  }
}

function openURL(
  url,
  redirectsLeft = 5,
  previousProtocol = ''
) {
  return new Promise((resolve, reject) => {
    let parsed;

    try {
      parsed = new URL(url);
    } catch (_) {
      reject(new Error(`无效下载地址: ${url}`));
      return;
    }

    if (
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'http:'
    ) {
      reject(
        new Error(
          `不支持的下载协议: ${parsed.protocol}`
        )
      );
      return;
    }

    if (
      previousProtocol === 'https:' &&
      parsed.protocol === 'http:'
    ) {
      reject(
        new Error(
          '拒绝从HTTPS降级重定向到HTTP'
        )
      );
      return;
    }

    const client =
      parsed.protocol === 'https:'
        ? https
        : http;

    const request = client.get(
      parsed,
      {
        headers: {
          'User-Agent':
            'Aegis-Node-Supervisor/1.1',
          Accept: '*/*'
        }
      },
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

          resolve(
            openURL(
              nextURL,
              redirectsLeft - 1,
              parsed.protocol
            )
          );

          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();

          reject(
            new Error(
              `下载失败，HTTP ${status}`
            )
          );

          return;
        }

        resolve(response);
      }
    );

    request.setTimeout(30000, () => {
      request.destroy(
        new Error('下载连接超时')
      );
    });

    request.on('error', reject);
  });
}

async function downloadText(
  url,
  maximumBytes
) {
  const response = await openURL(url);
  const chunks = [];
  let total = 0;

  return new Promise((resolve, reject) => {
    response.on('data', (chunk) => {
      total += chunk.length;

      if (total > maximumBytes) {
        response.destroy(
          new Error('下载内容超过限制')
        );
        return;
      }

      chunks.push(chunk);
    });

    response.on('end', () => {
      resolve(
        Buffer.concat(chunks).toString('utf8')
      );
    });

    response.on('error', reject);
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash =
      crypto.createHash('sha256');

    const input =
      fs.createReadStream(file);

    input.on('data', (chunk) => {
      hash.update(chunk);
    });

    input.on('end', () => {
      resolve(hash.digest('hex'));
    });

    input.on('error', reject);
  });
}

async function downloadBinary(
  url,
  destination,
  expectedHash
) {
  const temporary =
    `${destination}.download-${process.pid}`;

  safeRemove(temporary);

  try {
    const response = await openURL(url);

    const output = fs.createWriteStream(
      temporary,
      { mode: 0o600 }
    );

    const hash =
      crypto.createHash('sha256');

    let total = 0;

    await new Promise((resolve, reject) => {
      let settled = false;

      const fail = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      response.on('data', (chunk) => {
        total += chunk.length;

        if (total > 64 * 1024 * 1024) {
          response.destroy(
            new Error(
              'Agent文件异常地超过64MiB'
            )
          );
          return;
        }

        hash.update(chunk);
      });

      response.on('error', fail);
      output.on('error', fail);

      output.on('finish', () => {
        output.close((error) => {
          if (error) {
            fail(error);
            return;
          }

          if (!settled) {
            settled = true;
            resolve();
          }
        });
      });

      response.pipe(output);
    });

    const actualHash =
      hash.digest('hex');

    if (actualHash !== expectedHash) {
      throw new Error(
        `Agent SHA-256校验失败: ${actualHash}`
      );
    }

    fs.chmodSync(temporary, 0o700);
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o700);
  } finally {
    safeRemove(temporary);
  }
}

function readAgentVersion(binary) {
  try {
    const result = spawnSync(
      binary,
      ['--version'],
      {
        encoding: 'utf8',
        timeout: 10000
      }
    );

    if (result.status !== 0) {
      return '';
    }

    return String(
      result.stdout ||
      result.stderr ||
      ''
    ).trim();
  } catch (_) {
    return '';
  }
}

async function ensureAgentBinary() {
  const asset =
    assetForCurrentArchitecture();

  const binaryURL =
    `${serverURL}/downloads/${asset}`;

  const checksumURL =
    `${binaryURL}.sha256`;

  let expectedHash = '';

  try {
    const checksum = await downloadText(
      checksumURL,
      16 * 1024
    );

    const match = checksum.match(
      /\b[a-fA-F0-9]{64}\b/
    );

    if (!match) {
      throw new Error(
        '服务端返回的SHA-256格式错误'
      );
    }

    expectedHash =
      match[0].toLowerCase();
  } catch (error) {
    const cachedVersion =
      readAgentVersion(agentBinary);

    if (cachedVersion) {
      state.agentVersion =
        cachedVersion;

      log(
        '⚠️ 无法获取更新校验值，' +
        `继续使用缓存Agent: ${error.message}`
      );

      return;
    }

    throw error;
  }

  let currentHash = '';

  try {
    currentHash = await sha256File(
      agentBinary
    );
  } catch (_) {
    // 本地文件不存在时进行下载。
  }

  if (currentHash !== expectedHash) {
    log(`📥 正在下载 ${asset}`);

    await downloadBinary(
      binaryURL,
      agentBinary,
      expectedHash
    );

    log(
      '✅ Agent下载及SHA-256校验完成'
    );
  } else {
    fs.chmodSync(agentBinary, 0o700);

    log(
      '✅ 本地Agent已经是服务端最新文件'
    );
  }

  const version =
    readAgentVersion(agentBinary);

  if (!version) {
    throw new Error(
      'Agent文件已下载，但无法在当前目录执行'
    );
  }

  state.agentVersion = version;

  log(`✅ ${version}`);

  if (
    EXPECTED_VERSION &&
    !version.includes(EXPECTED_VERSION)
  ) {
    log(
      `⚠️ 服务端仍在下发旧Agent；` +
      `期望 ${EXPECTED_VERSION}，` +
      `实际 ${version}`
    );

    log(
      '⚠️ 请升级Aegis服务端的downloads目录'
    );
  }
}

function identityFile() {
  return path.join(
    dataDir,
    'agent.json'
  );
}

function isEnrolled() {
  try {
    const info =
      fs.statSync(identityFile());

    return (
      info.isFile() &&
      info.size > 0
    );
  } catch (_) {
    return false;
  }
}

function clearEnrollmentTimer() {
  if (enrollmentTimer) {
    clearInterval(enrollmentTimer);
    enrollmentTimer = null;
  }
}

function scheduleAgentRestart(
  delay,
  reason
) {
  if (stopping || restartTimer) {
    return;
  }

  const wait = Math.max(0, delay);

  log(
    `↻ ${wait / 1000}秒后重新启动Agent` +
    (reason ? `：${reason}` : '')
  );

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startAgent();
  }, wait);
}

function startAgent() {
  if (stopping || agentChild) {
    return;
  }

  const enrolled = isEnrolled();
  state.enrolled = enrolled;

  if (!enrolled && !TOKEN) {
    state.lastError =
      '首次注册缺少AEGIS_TOKEN或TOKEN环境变量';

    log(`❌ ${state.lastError}`);

    log(
      'ℹ️ 在面板创建新注册令牌并设置环境变量后重启程序'
    );

    return;
  }

  const argumentsList = [
    '--server',
    serverURL,
    '--name',
    AGENT_NAME,
    '--data',
    dataDir
  ];

  if (!enrolled) {
    argumentsList.push(
      '--token',
      TOKEN
    );
  }

  if (serverURL.startsWith('http://')) {
    argumentsList.push(
      '--insecure-http'
    );
  }

  log(
    `🚀 启动Agent：` +
    `server=${serverURL} ` +
    `name=${AGENT_NAME} ` +
    `data=${dataDir}`
  );

  if (!enrolled) {
    log(
      '🔐 正在首次注册；令牌不会写入日志'
    );
  }

  state.lastStartAt = Date.now();
  state.lastError = '';
  enrollmentRestartRequested = false;

  const child = spawn(
    agentBinary,
    argumentsList,
    {
      cwd: dataDir,
      stdio: 'inherit',
      env: process.env
    }
  );

  agentChild = child;
  state.agentRunning = true;
  state.agentPid = child.pid || 0;

  child.once('error', (error) => {
    state.lastError = error.message;

    log(
      `❌ Agent启动失败: ${error.message}`
    );
  });

  child.once('close', (code, signal) => {
    clearEnrollmentTimer();

    if (agentChild === child) {
      agentChild = null;
    }

    state.agentRunning = false;
    state.agentPid = 0;
    state.lastExitCode = code;
    state.lastExitSignal = signal || '';

    if (stopping) {
      return;
    }

    const ranFor =
      Date.now() - state.lastStartAt;

    if (
      enrollmentRestartRequested &&
      isEnrolled()
    ) {
      state.enrolled = true;
      restartAttempt = 0;
      state.restartCount += 1;

      scheduleAgentRestart(
        500,
        '注册完成，已从后续命令行移除令牌'
      );

      return;
    }

    restartAttempt =
      ranFor >= 60000
        ? 0
        : Math.min(
            restartAttempt + 1,
            6
          );

    state.restartCount += 1;

    const delay = Math.min(
      5000 * 2 ** restartAttempt,
      60000
    );

    log(
      `⚠️ Agent已退出，` +
      `code=${code} ` +
      `signal=${signal || 'none'}`
    );

    scheduleAgentRestart(
      delay,
      '保持探针持续在线'
    );
  });

  if (!enrolled) {
    enrollmentTimer = setInterval(() => {
      if (
        !agentChild ||
        enrollmentRestartRequested ||
        !isEnrolled()
      ) {
        return;
      }

      enrollmentRestartRequested = true;
      state.enrolled = true;

      log(
        '✅ 注册成功，正在安全重启以清除进程参数中的注册令牌'
      );

      agentChild.kill('SIGTERM');
    }, 500);
  }
}

function healthPayload() {
  return {
    ok: true,
    service: 'aegis-node-supervisor',
    uptimeSeconds: Math.floor(
      (Date.now() - state.startedAt) / 1000
    ),
    agentRunning: state.agentRunning,
    agentPid: state.agentPid,
    agentVersion: state.agentVersion,
    enrolled: state.enrolled,
    dataDir: state.dataDir,
    lastExitCode: state.lastExitCode,
    lastExitSignal: state.lastExitSignal,
    lastError: state.lastError,
    restartCount: state.restartCount
  };
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
            'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });

        response.end(
          JSON.stringify({
            ok: false,
            error: 'not_found'
          })
        );

        return;
      }

      response.writeHead(200, {
        'Content-Type':
          'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });

      response.end(
        JSON.stringify(
          healthPayload()
        )
      );
    }
  );

  healthServer.on('error', (error) => {
    log(
      `❌ 健康检查服务器失败: ${error.message}`
    );

    shutdown(1);
  });

  healthServer.listen(
    PORT,
    BIND_HOST,
    () => {
      log(
        `✅ 健康检查: ` +
        `http://${BIND_HOST}:${PORT}/healthz`
      );
    }
  );
}

async function prepareAndStartAgent() {
  try {
    await ensureAgentBinary();
    startAgent();
  } catch (error) {
    state.lastError = error.message;

    log(
      `❌ Agent准备失败: ${error.message}`
    );

    if (!stopping) {
      restartTimer = setTimeout(() => {
        restartTimer = null;
        prepareAndStartAgent();
      }, 60000);

      log(
        '↻ 60秒后重新尝试下载并启动Agent'
      );
    }
  }
}

function shutdown(exitCode) {
  if (stopping) {
    return;
  }

  stopping = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = null;
  clearEnrollmentTimer();

  if (agentChild) {
    try {
      agentChild.kill('SIGTERM');
    } catch (_) {
      // Agent可能已经退出。
    }
  }

  if (healthServer) {
    healthServer.close(() => {
      process.exit(exitCode);
    });

    setTimeout(() => {
      process.exit(exitCode);
    }, 5000).unref();
  } else {
    process.exit(exitCode);
  }
}

async function main() {
  // 必须最先启动健康检查，避免其他配置错误导致托管平台判定失败。
  startHealthServer();

  try {
    serverURL =
      normalizeServerURL(
        RAW_SERVER_URL
      );

    dataDir =
      chooseDataDirectory();

    state.dataDir = dataDir;

    copyIdentityIfAvailable(
      dataDir
    );

    state.enrolled =
      isEnrolled();

    agentBinary = path.join(
      dataDir,
      'aegis-agent'
    );

    await prepareAndStartAgent();
  } catch (error) {
    state.lastError = error.message;

    log(
      `❌ 初始化失败: ${error.message}`
    );

    log(
      '⚠️ 健康检查服务器继续运行，便于通过/healthz查看错误'
    );
  }
}

process.on('SIGTERM', () => {
  shutdown(0);
});

process.on('SIGINT', () => {
  shutdown(0);
});

process.on(
  'uncaughtException',
  (error) => {
    state.lastError = error.message;

    log(
      `❌ 未捕获异常: ` +
      `${error.stack || error.message}`
    );
  }
);

process.on(
  'unhandledRejection',
  (error) => {
    const message =
      error instanceof Error
        ? error.stack || error.message
        : String(error);

    state.lastError = message;

    log(
      `❌ 未处理Promise错误: ${message}`
    );
  }
);

main();
