# goodThing

Hysteria2 探针 Agent 节点（Node.js 包装器）。

- `index.js` — 主入口：启动 7682 健康检查服务，下载并运行探针 agent（含守护循环，退出自动重启）
- `run-agent.sh` — 一键启动器（用户原始命令块 + 守护循环 + 已注册自动免令牌）
- `Dockerfile` / `docker-compose.yml` — Docker 部署（**Freebuff 托管仅支持 React 项目，本应用请部署到自己的 Docker/VPS**）

> `install-agent.sh` 不随仓库维护：运行时由 `index.js` / `run-agent.sh` 从服务端
> （`INSTALL_SCRIPT_URL`）实时下载，保证与二进制版本一致。

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
| `TOKEN` | 注册令牌（**仅首次注册必填**；已有 agent.json 后可留空） | 无 |
| `INSTALL_SCRIPT_URL` | 安装脚本地址 | `https://probe.lightstars.eu.org/install-agent.sh` |
| `AEGIS_DATA_DIR` | Agent 数据目录 | `/tmp/aegis-agent-7682` |

> 💡 令牌只用于首次注册：首次成功后身份存为 `agent.json`（`AEGIS_DATA_DIR`），
> 之后重启无需令牌。`AEGIS_DATA_DIR` 务必指向持久化目录。
