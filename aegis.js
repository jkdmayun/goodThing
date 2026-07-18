const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');

const scriptUrl = 'https://probe.lightstars.eu.org/install-agent.sh';
const token = 'aeg_gtZ2qjo6D1FkOnO-vD14Lj3MGu9kLSL-3NKaLw5JEe0';
const hostname = 'miget';

// 1. 用 Node.js 下载脚本
const downloadAndInstall = () => {
  const file = fs.createWriteStream('/tmp/install-agent.sh');
  https.get(scriptUrl, (response) => {
    response.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        // 2. 下载完成后，执行安装
        const modeCmd = `
          MODE=foreground
          if [ "$(id -u)" -eq 0 ] && command -v systemctl >/dev/null 2>&1 && [ "$(ps -p 1 -o comm= | tr -d '[:space:]')" = "systemd" ]; then MODE=systemd; fi
          chmod 700 /tmp/install-agent.sh
          sh /tmp/install-agent.sh ${scriptUrl} '${token}' '${hostname}' "$MODE"
        `;
        exec(modeCmd, (error, stdout, stderr) => {
          if (error) {
            console.error(`安装失败: ${error.message}`);
            console.error(stderr);
            return;
          }
          console.log('安装成功', stdout);
        });
      });
    });
  }).on('error', (err) => {
    console.error('下载脚本失败:', err);
  });
};

// 调用
downloadAndInstall();
