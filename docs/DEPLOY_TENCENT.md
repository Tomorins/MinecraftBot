# 腾讯云部署

推荐将 Minecraft Server 和 AI 服务运行在同一台腾讯云 Linux 主机。AI 使用 `127.0.0.1:25565` 连接，不占公网流量；你的 PCL 使用腾讯云公网 IP 连接。

## 1. 网络与服务器

腾讯云安全组入站规则：

```text
来源：你的公网IP/32
协议端口：TCP:25565
策略：允许
```

云主机自己的防火墙也需采用相同限制。离线模式不要向 `0.0.0.0/0` 开放游戏端口。

确认 MC 服务端监听：

```bash
ss -lntp | grep 25565
```

## 2. Node.js 与项目

安装 Node.js 22 LTS 后：

```bash
node --version
corepack enable
sudo mkdir -p /opt/minecraft-ai-player
sudo useradd --system --home /opt/minecraft-ai-player --shell /usr/sbin/nologin minecraft 2>/dev/null || true
sudo chown -R "$USER":"$USER" /opt/minecraft-ai-player
```

将项目上传到 `/opt/minecraft-ai-player`，完成安装后确保服务账号拥有数据目录：

```bash
cd /opt/minecraft-ai-player
pnpm install --frozen-lockfile
cp .env.example .env
chmod 600 .env
pnpm build
pnpm test
sudo chown -R minecraft:minecraft /opt/minecraft-ai-player
```

编辑 `.env`，确认：

```env
MC_HOST=127.0.0.1
MC_PORT=25565
MC_USERNAME=AI_Player
MC_AUTH=offline
MC_OWNER=FuQiang
LLM_MODE=api
LLM_BASE_URL=https://你的API地址/v1
LLM_API_KEY=你的密钥
LLM_MODEL=你的模型
DATA_DIR=/opt/minecraft-ai-player/data
```

## 3. systemd 常驻服务

复制并调整示例服务：

```bash
sudo cp deploy/minecraft-ai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now minecraft-ai
```

查看状态与日志：

```bash
sudo systemctl status minecraft-ai
sudo journalctl -u minecraft-ai -f
curl http://127.0.0.1:3008/health
```

重启与停止：

```bash
sudo systemctl restart minecraft-ai
sudo systemctl stop minecraft-ai
```

如果 Node.js 不在 `/usr/bin/node`，使用 `command -v node` 查找路径并修改 unit 中的 `ExecStart`。

## 4. Docker 方式

Linux 上的 Compose 使用 host network，因而容器中的 `127.0.0.1:25565` 可以访问宿主机 MC 服务端：

```bash
docker compose up -d --build
docker compose logs -f
```

使用非 host network 时，应将 `MC_HOST` 改成 MC 容器的服务名或宿主机网关地址。

## 5. 上线验收

1. MC 服务端日志出现 `AI_Player joined the game`。
2. PCL 使用 `FuQiang` 加入同一地址。
3. 输入 `AI_Player，帮助`，机器人回复命令。
4. 输入 `AI_Player，跟着我`，机器人开始跟随。
5. 输入 `AI_Player，停止`，机器人停止并清理控制状态。
6. 重启 AI 服务，确认自动重新加入。
7. 执行长任务后重启，确认 SQLite 中的未完成任务被恢复。
