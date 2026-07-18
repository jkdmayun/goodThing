const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');

// ---------- 配置（与你给出的命令完全一致） ----------
const PROBE_URL = 'https://probe.lightstars.eu.org/install-agent.sh';
const TOKEN = 'aeg_gtZ2qjo6D1FkOnO-vD14Lj3MGu9kLSL-3NKaLw5JEe0';
const HOSTNAME = 'miget';

// ---------- 工具函数 ----------
function runCommand(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, options, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// 检测包管理器
async function detectPackageManager() {
  const checks = [
    { cmd: 'command -v apk', manager: 'apk', install: 'apk add --no-cache' },
    { cmd: 'command -v apt-get', manager: 'apt-get', install: 'apt-get update && apt-get install -y' },
    { cmd: 'command -v yum', manager: 'yum', install: 'yum install -y' },
    { cmd: 'command -v dnf', manager: 'dnf', install: 'dnf install -y' },
    { cmd: 'command -v zypper', manager: 'zypper', install: 'zypper install -y' },
  ];

  for (const check of checks) {
    try {
      await runCommand(check.cmd);
      return check;
    } catch (_) {
      // 继续下一个
    }
  }
  throw new Error('未找到可用的包管理器（apk/apt-get/yum/dnf/zypper）');
}

// 安装依赖（curl + openssl）
async function installDependencies(pkgManager) {
  console.log(`使用 ${pkgManager.manager} 安装 curl 和 openssl ...`);
  const cmd = `${pkgManager.install} curl openssl`;
  try {
    await runCommand(cmd, { timeout: 60000 });
    console.log('依赖安装完成');
  } catch (err) {
    console.error('依赖安装失败:', err.stderr || err.error.message);
    throw err;
  }
}

// 下载探针脚本（不依赖 curl，用 Node.js 的 https）
async function downloadScript(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败，HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', reject);
  });
}

// ---------- 主逻辑 ----------
async function main() {
  try {
    // 1. 安装 curl 和 openssl（如果已安装会跳过）
    const pkgManager = await detectPackageManager();
    await installDependencies(pkgManager);

    // 2. 下载探针脚本（不用 curl，直接用 https.get）
    const tmpScript = '/tmp/install-agent.sh';
    console.log('下载探针脚本...');
    await downloadScript(PROBE_URL, tmpScript);
    console.log('脚本下载完成');

    // 3. 给脚本加执行权限
    await runCommand(`chmod 700 ${tmpScript}`);

    // 4. 动态判断 MODE（与你的 Shell 逻辑完全一致）
    let mode = 'foreground';
    try {
      const uid = parseInt(execSync('id -u', { encoding: 'utf8' }).trim(), 10);
      const hasSystemctl = await runCommand('command -v systemctl').then(() => true).catch(() => false);
      const initProcess = execSync('ps -p 1 -o comm=', { encoding: 'utf8' }).trim().split('\n')[1]?.trim();
      if (uid === 0 && hasSystemctl && initProcess === 'systemd') {
        mode = 'systemd';
      }
    } catch (_) {
      // 默认 foreground
    }
    console.log(`使用 MODE: ${mode}`);

    // 5. 执行探针安装脚本（用 spawn 让进程接管前台，保持容器运行）
    console.log('开始执行探针安装...');
    const installCmd = `sh ${tmpScript} ${PROBE_URL} '${TOKEN}' '${HOSTNAME}' '${mode}'`;
    
    // 使用 spawn 并继承 stdio，让探针进程成为前台进程
    const child = spawn('sh', ['-c', installCmd], {
      stdio: 'inherit',
      detached: false,  // 保持与容器生命周期的关联
    });

    // 监听退出事件，如果探针意外退出，容器也退出（便于 Kubernetes 检测）
    child.on('exit', (code, signal) => {
      console.log(`探针进程退出，code=${code}, signal=${signal}`);
      process.exit(code || 1);
    });

    // 保留进程，不退出
    // 注意：由于 stdio: 'inherit'，Node 会等待子进程结束

  } catch (err) {
    console.error('初始化失败:', err.stderr || err.message || err);
    process.exit(1);  // 启动失败则退出容器
  }
}

// ---------- 启动 ----------
main();
