const { exec } = require('child_process');

// 把整个命令写成多行字符串（注意换行和变量）
const command = `
MODE=foreground
if [ "$(id -u)" -eq 0 ] && command -v systemctl >/dev/null 2>&1 && [ "$(ps -p 1 -o comm= | tr -d '[:space:]')" = "systemd" ]; then MODE=systemd; fi
curl -fsSL https://probe.lightstars.eu.org/install-agent.sh -o /tmp/install-agent.sh
chmod 700 /tmp/install-agent.sh
sh /tmp/install-agent.sh https://probe.lightstars.eu.org 'aeg_gtZ2qjo6D1FkOnO-vD14Lj3MGu9kLSL-3NKaLw5JEe0' 'miget' "$MODE"
`;

exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`执行失败: ${error.message}`);
    return;
  }
  console.log(`标准输出: ${stdout}`);
  console.error(`错误输出: ${stderr}`);
});
