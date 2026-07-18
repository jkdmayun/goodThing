const { spawn } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'install-agent.sh');
const SERVER_URL = 'https://probe.lightstars.eu.org';
const TOKEN      = 'aeg_gtZ2qjo6D1FkOnO-vD14Lj3MGu9kLSL-3NKaLw5JEe0';
const NAME       = 'miget';
const MODE       = 'foreground';

// 执行脚本，并让探针进程接管前台
const child = spawn('sh', [SCRIPT_PATH, SERVER_URL, TOKEN, NAME, MODE], {
    stdio: 'inherit',
});

child.on('exit', (code, signal) => {
    console.log(`探针进程退出，code=${code}, signal=${signal}`);
    process.exit(code || 1);
});
