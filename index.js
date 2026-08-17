#!/usr/bin/env node
// goodThing — Hysteria2 探针 Agent 节点包装器
// 1) 在 7682 端口起健康检查服务（curl http://127.0.0.1:7682/ 返回 OK）
// 2) 从服务端下载 install-agent.sh 并以 foreground 模式运行 agent
// 3) agent 退出后 5 秒自动重启（守护循环）
//
// 环境变量：
//   SERVER_URL         服务端地址           默认 https://probe.lightstars.eu.org/
//   TOKEN              注册令牌（仅首次注册必填；已有 agent.json 后可留空）
//   INSTALL_SCRIPT_URL 安装脚本地址         默认 ${SERVER_URL}/install-agent.sh
//   AEGIS_DATA_DIR     Agent 数据目录        默认 /tmp/aegis-agent-7682
//   HEALTH_PORT        健康检查端口         默认 7682

"use strict";

const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HEALTH_PORT = Number(process.env.HEALTH_PORT || 7682);
const SERVER_URL = (process.env.SERVER_URL || "https://probe.lightstars.eu.org/").replace(/\/+$/, "");
const TOKEN = process.env.TOKEN || "";
const INSTALL_SCRIPT_URL = process.env.INSTALL_SCRIPT_URL || `${SERVER_URL}/install-agent.sh`;
const DATA_DIR = process.env.AEGIS_DATA_DIR || "/tmp/aegis-agent-7682";
const SCRIPT = path.join(DATA_DIR, "install-agent.sh");

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, (res) => {
      // 跟随 301/302 重定向
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        res.resume();
        if (redirects <= 0) return reject(new Error(`GET ${url} -> 重定向次数过多`));
        const next = new URL(res.headers.location, url).toString();
        return download(next, dest, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve()));
      out.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function ensureScript() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(SCRIPT)) {
    console.log(`[goodThing] downloading ${INSTALL_SCRIPT_URL}`);
    await download(INSTALL_SCRIPT_URL, SCRIPT);
    fs.chmodSync(SCRIPT, 0o700);
  }
}

function run() {
  const args = [SCRIPT, SERVER_URL, TOKEN, os.hostname(), "foreground"];
  const child = spawn("sh", args, { stdio: "inherit" });
  child.on("exit", (code) => {
    if (code === 7) {
      // install-agent.sh：首次注册缺少令牌
      console.error("[goodThing] 首次注册需要 TOKEN（export TOKEN=... 或写入 .env）");
    } else if (code !== 0) {
      console.error(`[goodThing] agent 退出（code ${code}），5 秒后重启`);
    }
    setTimeout(run, 5000);
  });
}

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(HEALTH_PORT, "0.0.0.0", () => {
    console.log(`[goodThing] 健康检查服务已启动：:${HEALTH_PORT}`);
  });

ensureScript()
  .then(run)
  .catch((e) => {
    console.error("[goodThing] 启动失败：", e.message);
    process.exit(1);
  });
