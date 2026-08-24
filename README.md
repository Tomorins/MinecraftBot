# MinecraftBot

基于 Mineflayer、MCP 和可验证 Skill 状态机的 Minecraft Java 版自主玩家。它以独立游戏角色加入服务器，主要依靠协议级结构化数据感知世界，并能够导航、采集、合成、战斗、建造和持续执行长任务。

推荐配合独立的 [Demiurge](https://github.com/Dancncn/Demiurge) 桌面 Agent 使用：Demiurge 提供人物设定、当前 LLM、长期记忆、桌面图片对话和高层决策；MinecraftBot 负责连接服务器、结构化感知和可靠执行。两个项目相互独立，不要求 Minecraft 客户端安装 Mod。

## 两种运行模式

| 模式 | 规划模型 | 适合场景 |
| --- | --- | --- |
| Demiurge MCP（推荐） | 使用 Demiurge 当前配置的唯一 LLM | 共享人物、长期记忆、多人聊天身份和桌面图片对话 |
| 独立模式 | MinecraftBot 自己调用 OpenAI-compatible API | 不运行 Demiurge 的服务器机器人或开发调试 |

项目不会提交 `.env`、API Key、运行日志、SQLite 记忆数据库或本地 Minecraft 数据。

## 已实现能力

- 离线或微软身份连接、自动重连、固定角色名。
- 玩家、背包、装备、实体、方块、时间、天气和事件感知。
- 场景摘要、空间位置记忆、任务持久化及掉线恢复。
- 外部 LLM API 规划、失败恢复及严格 JSON 校验。
- 精确物品、方块、生物、配方数据库和递归材料计算。
- 本地攻略 RAG，可导入 Markdown/TXT 攻略。
- Skill 资源锁、优先级抢占、超时、取消、进度、重试及结果验证。
- 导航、跟随、挖掘、采集、放置、合成、熔炼、战斗、逃生、进食、交付、箱子存取、建造和探索。
- 低血量逃生、卡死、背包满、工具低耐久监控。
- SQLite 记忆、JSON 健康接口、结构化日志。
- 深度缓冲几何重投影、残差区域聚类、已知变化掩膜和可选 VLM 分析接口。
- Mock LLM 和 Mock Executor，可在没有 MC 服务器或 API Key 时测试主体系统。
- MCP stdio 工具/资源、游戏事件通知，以及 Demiurge 人设、会话和长期记忆闭环。

## 运行结构

```text
PCL（FuQiang） ───────公网──────> 腾讯云 Minecraft Server
                                      ↑
本机 Demiurge ──MCP stdio──> Mineflayer AI_Player
      │ 当前角色/长期记忆           │ 结构化感知/RAG/Skill Runtime
      └────唯一 LLM 规划与对话──────┘
```

## 环境要求

- Minecraft Java 服务端。
- Node.js 22.13 或更高版本。
- pnpm 10 或更高版本，也可以通过 Corepack 启用。
- MCP 模式需要已配置 LLM 的 Demiurge；独立运行模式才需要 OpenAI-compatible API。

## 本地安装

```bash
corepack enable
pnpm install
cp .env.example .env
```

独立运行时至少修改：

```env
MC_HOST=127.0.0.1
MC_PORT=25565
MC_USERNAME=AI_Player
MC_AUTH=offline
MC_OWNER=FuQiang

LLM_MODE=api
LLM_BASE_URL=https://你的API地址/v1
LLM_API_KEY=你的密钥
LLM_MODEL=你的模型名
```

先进行离线自检：

```bash
pnpm typecheck
pnpm test
pnpm smoke
```

启动开发模式：

```bash
pnpm dev
```

生产模式：

```bash
pnpm build
NODE_ENV=production pnpm start
```

## 使用 Demiurge（推荐）

分别构建两个独立项目：

```bash
# 本项目
pnpm install --frozen-lockfile
pnpm build

# Demiurge（单独克隆）
git clone https://github.com/Dancncn/Demiurge.git
cd Demiurge
npm install
npm run tauri dev
```

Windows 构建 Demiurge 还需要 Rust stable（MSVC）、Visual Studio 2022 Build Tools 的“使用 C++ 的桌面开发”以及 Windows SDK；若出现找不到 `link.exe`，请先补齐这些组件。

在 Demiurge 的“设置 → Minecraft”中选择本项目目录和 Node.js 可执行文件，填写腾讯云服务端公网地址、AI 游戏用户名 `AI_Player` 与主用户游戏名 `FuQiang`，最后打开“启用”。保存设置后 Demiurge 会自动启动 MCP 子进程；退出、禁用或修改配置时会停止/重启它。

MCP 模式会强制使用 `MCP_STDIO=true`、`LLM_MODE=mock`，但这里的 `mock` 只表示 Mineflayer 禁止调用内部规划模型。所有规划、人格与对话仍由 Demiurge 当前配置的真实 LLM 完成。公开聊天与私聊都会携带真实发言用户名、频道、主用户标识和场景。玩家输入 `AI_Player，跟着我` 即可自然点名；未点名的公开消息由模型结合对话语境判断是否在和它说话。对话和关键经历写入当前角色的同一 memory namespace；自动长期记忆由代码强制写入场景、频道、玩家用户名和主用户标识，不依赖记忆提取模型自行保留这些信息。

桌面输入区支持 JPEG、PNG、GIF、WebP 原生多模态图片（单张 10 MB、合计 20 MB），图片只发给 Demiurge 当前模型，不经过游戏聊天。

完整配置与联机验收见 [Demiurge 集成指南](docs/DEMIURGE_INTEGRATION.md)。

## Minecraft 服务端配置

`server.properties`：

```properties
online-mode=false
server-port=25565
server-ip=
white-list=true
```

重启服务端后，在服务端控制台执行：

```text
whitelist on
whitelist add FuQiang
whitelist add AI_Player
```

离线模式没有可靠的账号身份验证。腾讯云安全组应只允许你的公网 IP 访问 `TCP:25565`，或通过 Tailscale/WireGuard 连接，不能依赖白名单防止同名冒充。

## 游戏内命令

`MC_OWNER` 指定主用户，用户名比较不区分大小写，但事件和记忆会保留玩家实际显示的精确用户名。模型会把主用户和其他玩家的关系、权限及记忆分开。其他玩家仍可以公开聊天、私聊和请求普通帮助。MCP 模式下自然语言消息统一交给 Demiurge 当前角色判断和处理；独立模式只执行主用户明确叫出 AI 游戏用户名的任务。

```text
AI_Player，帮助
AI_Player，状态
AI_Player，停止
AI_Player，跟着我
AI_Player，去 120 64 -30
AI_Player，收集16个橡木
AI_Player，制作一把石镐并交给我
AI_Player，探索周围区域
```

固定 `@AI` 前缀已取消。直接使用设置中的 AI 游戏用户名称呼它；私聊天然视为对 AI 说话，未点名的公开聊天则由模型判断是否需要加入对话。

## 攻略知识库

精确配方和注册表由当前服务端版本的 `minecraft-data` 提供，不经过向量检索。自然语言攻略可以批量导入：

```bash
pnpm knowledge:index ./my-guides
```

支持递归读取 `.md` 和 `.txt`。默认使用本地哈希向量，不会额外产生 embedding API 成本；后续可以替换 `GuideRag` 的向量实现。

## 健康检查

默认只监听腾讯云本机：

```text
GET http://127.0.0.1:3008/health
GET http://127.0.0.1:3008/metrics
```

将 `HEALTH_PORT=0` 可关闭。不要把健康端口直接暴露到公网。

## 视觉模块

主体系统不依赖截图。`src/vision` 已实现：

- 基于上一帧深度和相机矩阵的几何重投影。
- 实际帧与预测帧的 RGB 残差。
- 已知动作区域掩膜。
- 连通区域聚类和阈值过滤。
- 异常事件及可选 VLM 调用。

Mineflayer 本身不提供原生 RGB 与深度缓冲，因此启用视觉时需要离屏渲染器或客户端 Mod 提供帧。项目已提供 `HttpFrameSource`，设置 `VISION_ENABLED=true` 和 `VISION_FRAME_URL=http://127.0.0.1:端口/frame` 即可接入。没有外部帧源时保持 `VISION_ENABLED=false`，所有游戏能力继续使用结构化感知。

## 安全边界

- 默认关闭 PVP：`ALLOW_PVP=false`。
- 可关闭丢弃物品：`ALLOW_DROP_ITEMS=false`。
- 单次计划最多 `MAX_PLAN_STEPS` 步。
- 单次目标距离受 `MAX_ACTION_DISTANCE` 限制。
- 独立模式只接受主用户明确叫出 AI 游戏用户名的任务；MCP 模式由 Demiurge 判断未点名公开聊天是否需要回应。
- LLM 只能选择注册 Skill；参数经过 Zod 校验。
- API Key 只从环境变量读取，日志会进行字段脱敏。
- 紧急逃生优先级高于普通任务，可以抢占移动和视角。

更具体的腾讯云部署步骤见 [docs/DEPLOY_TENCENT.md](docs/DEPLOY_TENCENT.md)，Skill 接口见 [docs/SKILLS.md](docs/SKILLS.md)，视觉接入约定见 [docs/VISION.md](docs/VISION.md)。

## 项目边界

- 当前面向 Minecraft Java 版，协议连接由 Mineflayer 提供。
- 结构化感知是默认主路径；局部视觉和 VLM 需要额外帧源。
- 微秒/毫秒级移动与战斗细节由执行器和 Skill 处理，LLM 不参与每一帧控制。
- 离线服务器无法可靠验证用户名归属，应限制服务器端口来源或使用私有网络。
- MCP 模式下所有公开聊天都可能触发 Demiurge 的语境判断，应结合服务器人数评估 API 成本。

## 开发与验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

测试不要求真实 Minecraft 服务器或真实 LLM Key；Mock Executor 和 Mock LLM 会覆盖规划、Skill、记忆、MCP 通知与视觉残差的主体链路。
