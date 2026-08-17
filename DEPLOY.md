# goodThing 部署指南（Docker / VPS）

本项目是一个 **Hysteria2 探针 Agent 节点**：`index.js` 启动 7682 健康检查服务，
下载并运行探针 agent（`install-agent.sh` 负责下载二进制并校验 SHA-256）。

> 注意：Freebuff 托管只支持 React 网页项目，无法运行本应用。本应用适合部署到
> 你自己的 Docker/VPS 环境。本目录下的 `Dockerfile`、`docker-compose.yml` 即为此准备。

---

## 方式 A：Docker Compose（推荐）

前置条件：装有 Docker Engine 20.10+（含 compose v2 插件）的 Linux VPS。

```bash
# 1. 拉取代码
git clone <你的仓库地址> goodThing
cd goodThing

# 2. 创建环境变量文件（首次部署必填 TOKEN）
# compose 会自动读取项目目录下的 .env，最小内容：
#   TOKEN=你的注册令牌
# 其他变量按需添加（见下方"环境变量"一节）
vim .env

# 3. 构建并启动
docker compose up -d --build

# 4. 验证
docker compose ps          # 状态应为 healthy / running
docker compose logs -f     # 查看 agent 启动日志
curl http://127.0.0.1:7682/   # 应返回 OK
```

### 常用运维命令

```bash
docker compose logs -f            # 跟踪日志
docker compose restart            # 重启
docker compose down               # 停止并删除容器（数据卷保留）
git pull && docker compose up -d --build   # 更新到最新代码
```

---

## 方式 B：直接 docker run（不用 compose）

```bash
docker build -t goodthing-agent .

docker run -d --name goodthing-agent \
  --restart unless-stopped \
  -p 7682:7682/tcp -p 7682:7682/udp \
  -e TOKEN='你的注册令牌' \
  -e SERVER_URL='https://probe.lightstars.eu.org/' \
  -e AEGIS_DATA_DIR='/data/aegis-agent' \
  -v goodthing-data:/data \
  goodthing-agent
```

---

## 方式 C：VPS 直接运行（无 Docker）

前置条件：Node.js ≥ 18、curl。

```bash
git clone <你的仓库地址> goodThing
cd goodThing
npm install            # 无依赖，纯空操作
TOKEN='你的注册令牌' npm start
```

推荐用 systemd 托管，保证掉线自动拉起。创建 `/etc/systemd/system/goodthing.service`：

```ini
[Unit]
Description=goodThing probe agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/goodThing
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
Environment=TOKEN=你的注册令牌
Environment=AEGIS_DATA_DIR=/var/lib/aegis-agent
Environment=SERVER_URL=https://probe.lightstars.eu.org/

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/aegis-agent
sudo systemctl daemon-reload
sudo systemctl enable --now goodthing
sudo systemctl status goodthing
```

---

## 一键启动器 run-agent.sh

与 `node index.js` 等价的独立启动脚本（含用户原始命令块：MODE 检测 +
下载 install-agent.sh + 执行）：

```bash
sh run-agent.sh                        # 已注册后直接跑，无需令牌
TOKEN='你的注册令牌' sh run-agent.sh   # 首次注册必须给令牌
```

- 自动检测 systemd（有则用 systemd 模式，否则前台模式）。
- 前台模式自带守护循环：Agent 退出后 5 秒自动重启。
- 检测到 `agent.json` 自动跳过令牌；令牌可从环境变量、`.env.local`、`.env` 读取。

---

## 环境变量

compose 启动时会自动读取项目目录下的 `.env` 文件。最小配置示例：

```bash
TOKEN=你的注册令牌
```

| 变量 | 必填 | 说明 | 默认 |
|---|---|---|---|
| `TOKEN` | 仅首次注册 | 一次性注册令牌；agent.json 已存在后可留空 | 无 |
| `SERVER_URL` | 否 | 服务端地址 | `https://probe.lightstars.eu.org/` |
| `INSTALL_SCRIPT_URL` | 否 | 安装脚本地址 | `https://probe.lightstars.eu.org/install-agent.sh` |
| `AEGIS_DATA_DIR` | 否 | Agent 数据目录（容器内挂载卷） | `/tmp/aegis-agent-7682` |

## 端口与防火墙

- **7682/tcp**：健康检查（`curl http://<IP>:7682/` 返回 `OK`）。
- **7682/udp**：按原 Dockerfile 暴露保留；探针 agent 的实际流量是**主动出站**
  连向服务端，通常无需额外放行入站端口。
- 如需在云主机防火墙放行：`ufw allow 7682/tcp`（云厂商安全组同理）。

## 数据持久化

- agent 注册信息（`agent.json`）保存在 `AEGIS_DATA_DIR`。compose 方案已挂载
  `agent-data` 卷到 `/data`，容器重建/升级后**无需重新注册**。
- 若要清空注册（换个服务端/身份）：`docker compose down -v` 会删除数据卷。

## 关于一次性注册令牌（重启后如何运行）

- `TOKEN` **只用于首次注册**。首次成功注册后，身份写入
  `AEGIS_DATA_DIR/agent.json`，之后**不再需要令牌**。
- 每次重启/升级直接 `docker compose restart`（或 `up -d --build`）即可：
  `index.js` 会自动检测 `agent.json` 并跳过注册（`install-agent.sh` 原文：
  "已有 agent.json 的升级可以留空"）。
- 唯一前提：`AEGIS_DATA_DIR` 指向**持久化**目录（compose 已挂载卷，
  方式 C 使用 `/var/lib/aegis-agent`）。数据卷一旦删除（`down -v`），
  身份即丢失，届时才需要新令牌重新注册。

## 安全注意

- `index.js` 曾含**硬编码的注册令牌兜底值**（已随仓库公开，现已移除）。请始终用
  `TOKEN` 环境变量提供令牌；旧令牌若仍在服务端有效，请尽快轮换。
- `.env` 含令牌，已加入 `.gitignore` 约定，**切勿提交**。
