# goodThing

Hysteria2 探针 Agent 节点（Node.js 包装器）。

- `index.js` — 主入口：启动 7682 健康检查服务，下载并运行探针 agent
- `install-agent.sh` — agent 安装/启动脚本（按架构下载二进制并校验 SHA-256）
- `aegis.js` — 调试脚本（`--insecure` 变体，需自行填写 SERVER_URL/TOKEN）
- `Dockerfile` / `docker-compose.yml` — Docker 部署（**Freebuff 托管仅支持 React 项目，本应用请部署到自己的 Docker/VPS**）

## 快速开始（Docker）

见 [DEPLOY.md](DEPLOY.md)。

```bash
vim .env               # 至少设置 TOKEN=你的注册令牌（compose 自动读取）
docker compose up -d --build
```

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `SERVER_URL` | 服务端地址 | `https://probe.lightstars.eu.org/` |
| `TOKEN` | 注册令牌（建议必填，覆盖代码内硬编码兜底值） | 硬编码兜底值 |
| `INSTALL_SCRIPT_URL` | 安装脚本地址 | `https://probe.lightstars.eu.org/install-agent.sh` |
| `AEGIS_DATA_DIR` | Agent 数据目录 | `/tmp/aegis-agent-7682` |

> ⚠️ `index.js` 内含硬编码的注册令牌兜底值，若已泄露请轮换，并始终通过 `TOKEN` 环境变量显式提供。
