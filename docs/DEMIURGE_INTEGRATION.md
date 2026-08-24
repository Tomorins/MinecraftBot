# Demiurge × Minecraft AI 联机与配置

## 最终运行关系

Demiurge 与 Minecraft AI Player 是两个独立项目。Demiurge 通过标准输入/输出启动 Minecraft 项目的 MCP 服务；Mineflayer 再作为第二个 Minecraft 客户端连接服务器。

```text
同一台 Windows 电脑
├─ PCL 启动的玩家 FuQiang ───────────┐
├─ Demiurge（当前角色 + 唯一 LLM）   ├─公网─> 腾讯云 MC Server
└─ Mineflayer 子进程 AI_Player ──────┘
```

不需要第二台电脑、第二个 PCL 窗口或客户端 Mod。PCL 只负责你自己的可视角色；Mineflayer 使用协议直接登录另一个名字。离线服务器必须保证两个用户名不同。

## 服务端

腾讯云 Java 服务端的 `server.properties`：

```properties
online-mode=false
server-port=25565
server-ip=
white-list=true
```

控制台执行：

```text
whitelist add FuQiang
whitelist add AI_Player
```

离线模式无法验证同名玩家身份。安全组应只允许你当前公网 IP 访问 `TCP:25565`，或者改用 Tailscale/WireGuard。

## 构建 Minecraft 项目

```powershell
cd C:\Users\fuqiang\Desktop\mc
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

构建后的 MCP 入口是：

```text
C:\Users\fuqiang\Desktop\mc\dist\mcp\index.js
```

## 构建并启动 Demiurge

Demiurge 桌面端是 Tauri/Rust 应用。Windows 首次构建前请安装：

- Node.js 22.13 或更高版本。
- Rust stable（MSVC toolchain）。
- Visual Studio 2022 Build Tools 中的“使用 C++ 的桌面开发”和 Windows SDK。

然后执行：

```powershell
cd C:\Users\fuqiang\Desktop\mc\Demiurge
npm install
npm run tauri dev
```

如果提示找不到 `link.exe`，说明 Visual C++ Build Tools 尚未安装完整；这不是 Minecraft MCP 配置错误。

## Demiurge 设置

打开“设置 → Minecraft”，填写：

- 项目：选择 `C:\Users\fuqiang\Desktop\mc`，界面会推导 MCP 入口与独立数据目录。
- Node.js：选择 `node.exe`；它必须是 Node 22.13 或更高版本。
- 地址：腾讯云公网 IP 或域名，端口通常为 `25565`。
- 登录：`offline`，角色名 `AI_Player`。
- AI 游戏用户名：`AI_Player`；玩家可以在公开聊天中直接叫这个名字。
- 主用户游戏名：`FuQiang`。其他玩家仍能互动，但身份、权限和长期记忆会按用户名区分。
- 安全：PVP 默认关闭，最大行动距离默认 128。
- 启用：完成以上配置后再打开；保存即启动，修改后保存即重启，关闭应用会终止子进程。

设置页不会要求 Minecraft 专用的模型、API Key 或 Base URL。生成的子进程环境固定包含：

```env
MCP_STDIO=true
LLM_MODE=mock
HEALTH_PORT=0
```

这表示 Mineflayer 不能调用内部 LLM，不表示 Demiurge 使用模拟模型。Demiurge 当前设置中的 provider、model、base URL 和凭据是唯一模型来源。

## 对话、动作与记忆

1. 在游戏中输入 `AI_Player，跟着我`，或直接私聊 AI 角色。
2. Mineflayer 把公开聊天、私聊、精确发言用户名、频道、主用户标识和结构化世界事件通知给 Demiurge；主用户名匹配不受大小写影响。
3. Demiurge 用当前角色 persona、Lorebook、场景化会话历史和对应 memory namespace 规划。未点名的公开消息由当前模型结合语境判断是否需要回应。
4. 模型可调用 `minecraft_skill_catalog`、`minecraft_lookup_knowledge`、`minecraft_execute_plan` 等 MCP 工具。
5. Skill 状态机在 Mineflayer 进程内高频执行，不需要模型逐帧介入。
6. Demiurge 的最终自然语言回复会被分段后自动发送到游戏。
7. 游戏对话进入正常会话和自动记忆抽取；代码会强制给自动长期记忆添加场景、频道、说话用户名和主用户标识。死亡、维度切换、行动成败和视觉异常直接写入当前角色的长期记忆。

桌面聊天与游戏聊天使用同一个当前角色。桌面端还可以上传 JPEG、PNG、GIF、WebP；图片会以 OpenAI content parts、Anthropic base64 source 或 Gemini inlineData 的原生格式发给当前模型。

## 验收

1. PCL 的 `FuQiang` 能加入腾讯云服务器。
2. Demiurge Minecraft 状态显示 `connected` 并列出 MCP 工具。
3. 服务端日志出现 `AI_Player joined the game`。
4. `AI_Player，你好` 得到符合当前 Demiurge 人设的游戏回复。
5. `AI_Player，跟着我` 会调用 Skill 并持续移动。
6. 另一名玩家公开聊天或私聊后，会话记录显示其真实用户名且不会归到主用户身份。
7. 在桌面端追问刚才的游戏经历，角色能够结合相同会话与长期记忆回答。
8. 桌面上传一张图片，支持视觉的当前模型能直接描述图片。

## 故障定位

- `node`/脚本不存在：重新选择 `node.exe` 与本项目根目录，然后保存。
- MCP 连接超时：先运行 `pnpm build`，并确认入口为 `dist/mcp/index.js`。
- `AI_Player` 无法加入：核对 `online-mode=false`、白名单、端口和安全组。
- 游戏里无响应：核对 AI 设置中的游戏用户名与实际登录名。公开聊天可直接叫该用户名；私聊会直接进入对话；未点名的公开消息可能被模型判断为与 AI 无关而保持沉默。
- 图片请求失败：当前 Demiurge 模型必须支持视觉；图片上限为单张 10 MB、总计 20 MB。
