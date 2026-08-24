import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Bot } from 'mineflayer'
import type { AppConfig } from './config.js'
import { BotConnection } from './bot/connection.js'
import { EventBus } from './core/event-bus.js'
import { MemoryStore } from './memory/sqlite-memory.js'
import { Metrics } from './observability/metrics.js'
import { PerceptionSystem } from './perception/perception.js'
import { WorldModel } from './world/world-model.js'
import { MineflayerExecutor } from './executor/mineflayer-executor.js'
import { SkillRuntime } from './skills/runtime.js'
import { createBuiltinSkills } from './skills/builtin.js'
import { MinecraftKnowledge } from './knowledge/minecraft-knowledge.js'
import { GuideRag } from './knowledge/rag.js'
import type { LLMProvider } from './llm/provider.js'
import { OpenAICompatibleProvider } from './llm/openai-compatible.js'
import { MockLLMProvider } from './llm/mock.js'
import { Planner } from './planner/planner.js'
import { ChatController } from './chat/chat-controller.js'
import { SafetySupervisor } from './safety/supervisor.js'
import { logger } from './logger.js'
import { VisionController } from './vision/controller.js'
import { ResidualDetector } from './vision/residual.js'
import { HttpFrameSource } from './vision/http-frame-source.js'
import type { Plan, SkillResult, TaskRecord, WorldContext, WorldEvent } from './types.js'

interface Session {
  perception: PerceptionSystem
  world: WorldModel
  planner: Planner
  runtime: SkillRuntime
  knowledge: MinecraftKnowledge
  chat: ChatController
  safety: SafetySupervisor
  heartbeat: NodeJS.Timeout
  unsubscribeReplan: () => void
  vision: VisionController | undefined
}

export interface MinecraftAiStatus {
  running: boolean
  connected: boolean
  username: string
  owner: string
  server: { host: string; port: number }
  task?: TaskRecord
  world?: WorldContext
  activeSkills: Array<{ id: string; name: string; priority: string; resources: string[]; startedAt: number }>
}

export class MinecraftAiApp {
  private readonly events = new EventBus()
  private readonly memory: MemoryStore
  private readonly metrics: Metrics
  private readonly rag: GuideRag
  private readonly llm: LLMProvider
  private readonly connection: BotConnection
  private session: Session | undefined
  private stopped = false

  constructor(private readonly config: AppConfig) {
    mkdirSync(config.runtime.dataDir, { recursive: true })
    this.memory = new MemoryStore(join(config.runtime.dataDir, 'memory.db'))
    this.events.on('*', event => this.memory.appendEvent(event))
    this.metrics = new Metrics(this.events)
    this.rag = new GuideRag(this.memory)
    this.rag.seedDefaults()
    const mcpMode = process.env.MCP_STDIO === 'true'
    this.llm = mcpMode || config.llm.mode === 'mock'
      ? new MockLLMProvider()
      : new OpenAICompatibleProvider(config.llm, config.vision.vlmModel)
    this.connection = new BotConnection(config.minecraft, {
      onSpawn: bot => this.startSession(bot),
      onEnd: reason => this.stopSession(reason)
    })
  }

  start(): void {
    if (!this.stopped && this.connection.isRunning()) return
    this.stopped = false
    if (this.config.runtime.healthPort > 0) this.metrics.listen(this.config.runtime.healthPort)
    this.connection.start()
  }

  status(): MinecraftAiStatus {
    const session = this.session
    const task = session?.planner.status()
    return {
      running: !this.stopped,
      connected: Boolean(session),
      username: this.config.minecraft.username,
      owner: this.config.minecraft.owner,
      server: { host: this.config.minecraft.host, port: this.config.minecraft.port },
      ...(task ? { task } : {}),
      ...(session ? { world: session.world.context() } : {}),
      activeSkills: session
        ? session.runtime.active().map(skill => ({
            id: skill.id,
            name: skill.name,
            priority: skill.priority,
            resources: [...skill.resources],
            startedAt: skill.startedAt
          }))
        : []
    }
  }

  async submitGoal(goal: string): Promise<TaskRecord> {
    const normalized = goal.trim()
    if (!normalized) throw new Error('Goal cannot be empty.')
    if (!this.session) throw new Error('Minecraft bot is not connected yet.')
    return this.session.planner.submit(normalized)
  }

  skillCatalog(): Array<{ name: string; description: string; parameters: unknown }> {
    if (!this.session) throw new Error('Minecraft bot is not connected yet.')
    return this.session.runtime.catalog()
  }

  async executePlan(plan: Plan): Promise<TaskRecord> {
    if (!this.session) throw new Error('Minecraft bot is not connected yet.')
    return this.session.planner.executePrepared(plan)
  }

  async runSkill(name: string, params: Record<string, unknown>): Promise<SkillResult> {
    if (!this.session) throw new Error('Minecraft bot is not connected yet.')
    return this.session.runtime.run(name, params, { priority: 'user' }).result
  }

  lookupKnowledge(name: string, count = 1): unknown {
    if (!this.session) throw new Error('Minecraft bot is not connected yet.')
    const inventory = Object.fromEntries(
      this.session.world.context().snapshot.inventory.map(item => [item.name, item.count])
    )
    return {
      description: this.session.knowledge.describe(name),
      recipes: this.session.knowledge.getRecipesFor(name),
      craftingPlan: this.session.knowledge.calculateCraftingPlan(name, count, inventory),
      smeltingInputs: this.session.knowledge.getSmeltingInputsFor(name),
      inventoryCount: inventory[name] ?? 0
    }
  }

  searchGuides(query: string, limit = 5): unknown {
    return this.rag.search(query, Math.min(Math.max(Math.trunc(limit), 1), 10))
  }

  async cancelGoal(reason = 'stopped_from_desktop'): Promise<void> {
    if (!this.session) return
    await this.session.planner.stop(reason)
  }

  async say(message: string): Promise<void> {
    const normalized = message.trim()
    if (!normalized) throw new Error('Message cannot be empty.')
    if (!this.session) throw new Error('Minecraft bot is not connected yet.')
    const result = await this.session.runtime.run(
      'say',
      { message: normalized },
      { priority: 'user', timeoutMs: 15_000 }
    ).result
    if (result.status !== 'success') throw new Error(result.reason ?? 'Unable to send Minecraft chat message.')
  }

  recentEvents(limit = 30): WorldEvent[] {
    return this.events.recent(Math.min(Math.max(Math.trunc(limit), 1), 200))
  }

  onEvent(listener: (event: WorldEvent) => void | Promise<void>): () => void {
    return this.events.on('*', listener)
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await this.connection.stop()
    await this.stopSession('application_shutdown')
    await this.metrics.close()
    this.memory.close()
    logger.info('application stopped')
  }

  private async startSession(bot: Bot): Promise<void> {
    if (this.session) await this.stopSession('new_session')
    this.metrics.setConnected(true)
    this.events.emit('spawn', { username: bot.username, version: bot.version }, 'normal')

    const world = new WorldModel(this.memory)
    const perception = new PerceptionSystem(bot, this.events)
    perception.start(snapshot => world.update(snapshot))

    const executor = new MineflayerExecutor(
      bot,
      this.config.runtime.maxActionDistance,
      this.config.runtime.allowPvp,
      this.config.runtime.allowDropItems
    )
    const runtime = new SkillRuntime(
      executor,
      () => world.context(),
      this.events,
      this.config.runtime.skillDefaultTimeoutMs,
      (key, position) => world.rememberLocation(key, position)
    )
    runtime.registerAll(createBuiltinSkills())
    const knowledge = new MinecraftKnowledge(bot.version)
    const planner = new Planner(this.llm, runtime, world, this.memory, knowledge, this.rag, this.config.minecraft.owner, this.config.runtime.maxPlanSteps)
    const chat = new ChatController(
      bot,
      planner,
      runtime,
      this.events,
      this.config.minecraft.owner,
      process.env.MCP_STDIO !== 'true'
    )
    const safety = new SafetySupervisor(world, runtime, this.events)
    const heartbeat = setInterval(() => {
      const task = planner.status()
      if (task?.status === 'running') this.events.emit('planner_heartbeat', { taskId: task.id, step: task.currentStep }, 'low')
    }, this.config.runtime.plannerHeartbeatMs)
    const unsubscribeReplan = this.events.on('*', event => {
      if (event.type === 'stuck' || event.type === 'inventory_full' || event.type === 'tool_low_durability') {
        void planner.replanForEvent(event.type, event.data)
      }
    })

    let vision: VisionController | undefined
    if (this.config.vision.enabled && this.config.vision.frameUrl) {
      const mcpMode = process.env.MCP_STDIO === 'true'
      vision = new VisionController(
        new HttpFrameSource(this.config.vision.frameUrl),
        new ResidualDetector(this.config.vision.residualThreshold, this.config.vision.minRegionPixels),
        this.events,
        this.config.vision.vlmEnabled && !mcpMode ? this.llm : undefined,
        this.config.vision.intervalMs,
        this.config.vision.vlmEnabled && mcpMode
      )
      vision.start()
    }

    this.session = { perception, world, planner, runtime, knowledge, chat, safety, heartbeat, unsubscribeReplan, vision }
    chat.start()
    safety.start()
    bot.chat(`我叫 ${bot.username}，直接叫我的游戏名就可以和我说话。`)

    if (this.config.runtime.autoResume && this.memory.latestActiveTask()) {
      setTimeout(() => { void planner.resume() }, 2000)
    }
  }

  private async stopSession(reason: string): Promise<void> {
    const session = this.session
    if (!session) return
    this.session = undefined
    clearInterval(session.heartbeat)
    session.unsubscribeReplan()
    session.chat.stop()
    session.safety.stop()
    session.perception.stop()
    session.vision?.stop()
    await session.planner.stop(reason)
    this.metrics.setConnected(false)
  }
}
