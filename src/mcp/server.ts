import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { MinecraftAiApp, MinecraftAiStatus } from '../app.js'
import type { Plan, SkillResult, TaskRecord, WorldEvent } from '../types.js'

export interface MinecraftController {
  status(): MinecraftAiStatus
  skillCatalog(): Array<{ name: string; description: string; parameters: unknown }>
  executePlan(plan: Plan): Promise<TaskRecord>
  runSkill(name: string, params: Record<string, unknown>): Promise<SkillResult>
  lookupKnowledge(name: string, count?: number): unknown
  searchGuides(query: string, limit?: number): unknown
  cancelGoal(reason?: string): Promise<void>
  say(message: string): Promise<void>
  recentEvents(limit?: number): WorldEvent[]
  onEvent?(listener: (event: WorldEvent) => void | Promise<void>): () => void
}

export class MinecraftMcpBridge {
  private activeTask: Promise<TaskRecord> | undefined

  constructor(private readonly controller: MinecraftController) {}

  status(): MinecraftAiStatus {
    return this.controller.status()
  }

  catalog(): Array<{ name: string; description: string; parameters: unknown }> {
    return this.controller.skillCatalog()
  }

  startPlan(plan: Plan): MinecraftAiStatus {
    const active = this.controller.executePlan(plan)
    this.activeTask = active
    void active.then(
      () => { if (this.activeTask === active) this.activeTask = undefined },
      () => { if (this.activeTask === active) this.activeTask = undefined }
    )
    return this.controller.status()
  }

  async runSkill(name: string, params: Record<string, unknown>): Promise<SkillResult> {
    return this.controller.runSkill(name, params)
  }

  async waitForGoal(timeoutSeconds: number): Promise<MinecraftAiStatus> {
    const active = this.activeTask
    if (!active || timeoutSeconds <= 0) return this.controller.status()
    await Promise.race([
      active,
      new Promise<void>(resolve => setTimeout(resolve, Math.min(timeoutSeconds, 120) * 1000))
    ])
    return this.controller.status()
  }

  async stopGoal(reason?: string): Promise<MinecraftAiStatus> {
    await this.controller.cancelGoal(reason)
    return this.controller.status()
  }

  async say(message: string): Promise<MinecraftAiStatus> {
    await this.controller.say(message)
    return this.controller.status()
  }

  events(limit: number): WorldEvent[] {
    return this.controller.recentEvents(limit)
  }

  lookupKnowledge(name: string, count: number): unknown {
    return this.controller.lookupKnowledge(name, count)
  }

  searchGuides(query: string, limit: number): unknown {
    return this.controller.searchGuides(query, limit)
  }
}

function toolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }]
  }
}

export function createMinecraftMcpServer(controller: MinecraftAiApp | MinecraftController): McpServer {
  const bridge = new MinecraftMcpBridge(controller)
  const server = new McpServer(
    { name: 'minecraft-ai-player', version: '1.0.0' },
    {
      instructions:
        'You are the only planning LLM. First call minecraft_skill_catalog, then call minecraft_execute_plan with validated skill steps. The Minecraft process never calls another LLM in MCP mode. minecraft_execute_plan is asynchronous; poll with minecraft_status or minecraft_wait_goal. Never claim an in-game action succeeded unless status or events confirm it.',
      capabilities: { logging: {} }
    }
  )

  const forwardedEventTypes = new Set([
    'chat',
    'whisper',
    'damage',
    'death',
    'dimension_changed',
    'item_collected',
    'skill_completed',
    'skill_failed',
    'vision_anomaly',
    'vision_vlm_request'
  ])
  controller.onEvent?.(event => {
    if (!forwardedEventTypes.has(event.type)) return
    void server.sendLoggingMessage({
      level: event.priority === 'critical' ? 'critical' : event.priority === 'high' ? 'warning' : 'info',
      logger: 'minecraft.event',
      data: {
        source: 'minecraft-ai-player',
        event
      }
    }).catch(() => {})
  })

  server.registerTool(
    'minecraft_status',
    {
      title: 'Minecraft AI status',
      description: 'Read connection, player state, inventory, nearby entities, current task and running skills.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async () => toolResult(bridge.status())
  )

  server.registerTool(
    'minecraft_skill_catalog',
    {
      title: 'Minecraft skill catalog',
      description: 'List the available long-running Mineflayer skills and their JSON parameter schemas. Read this before preparing a plan.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async () => {
      try {
        return toolResult(bridge.catalog())
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'minecraft_lookup_knowledge',
    {
      title: 'Minecraft exact knowledge',
      description: 'Look up version-correct item, block or entity properties plus recipes, smelting inputs and a recursive crafting plan based on the live inventory.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(150),
        count: z.number().int().min(1).max(64).default(1)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ name, count }) => {
      try {
        return toolResult(bridge.lookupKnowledge(name, count))
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'minecraft_search_guides',
    {
      title: 'Search Minecraft guide knowledge',
      description: 'Retrieve relevant survival, mining, combat, building and user-indexed guide knowledge before planning.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(1_000),
        limit: z.number().int().min(1).max(10).default(5)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ query, limit }) => toolResult(bridge.searchGuides(query, limit))
  )

  const planStepSchema = z.object({
    id: z.string().trim().min(1).max(100),
    skill: z.string().trim().min(1).max(100),
    params: z.record(z.string(), z.unknown()).default({}),
    depends_on: z.array(z.string()).default([]),
    on_failure: z.enum(['retry', 'replan', 'abort']).default('abort')
  })

  server.registerTool(
    'minecraft_execute_plan',
    {
      title: 'Execute a Minecraft plan',
      description: 'Validate and start a dependency-ordered plan made from the current Minecraft skill catalog. Returns immediately while Mineflayer continues execution.',
      inputSchema: z.object({
        goal: z.string().trim().min(1).max(2_000),
        steps: z.array(planStepSchema).min(1).max(100),
        assumptions: z.array(z.string()).default([])
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
    },
    async ({ goal, steps, assumptions }) => {
      try {
        return toolResult(bridge.startPlan({
          goal,
          reply: '',
          assumptions,
          steps: steps.map(step => ({
            id: step.id,
            skill: step.skill,
            params: step.params,
            dependsOn: step.depends_on,
            onFailure: step.on_failure
          }))
        }))
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'minecraft_run_skill',
    {
      title: 'Run one Minecraft skill',
      description: 'Run one catalog skill directly for a simple immediate action. Use minecraft_execute_plan for multi-step goals.',
      inputSchema: z.object({
        skill: z.string().trim().min(1).max(100),
        params: z.record(z.string(), z.unknown()).default({})
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
    },
    async ({ skill, params }) => {
      try {
        return toolResult(await bridge.runSkill(skill, params))
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'minecraft_wait_goal',
    {
      title: 'Wait for Minecraft goal progress',
      description: 'Wait briefly for the active goal to finish, then return the latest status. Use short waits so desktop chat stays responsive.',
      inputSchema: z.object({ timeout_seconds: z.number().int().min(0).max(120).default(10) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ timeout_seconds }) => toolResult(await bridge.waitForGoal(timeout_seconds))
  )

  server.registerTool(
    'minecraft_stop_goal',
    {
      title: 'Stop the Minecraft goal',
      description: 'Cancel the active planner task and all running Mineflayer skills.',
      inputSchema: z.object({ reason: z.string().trim().max(500).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async ({ reason }) => {
      try {
        return toolResult(await bridge.stopGoal(reason))
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'minecraft_say',
    {
      title: 'Send Minecraft chat',
      description: 'Send a short chat message through the AI-controlled Minecraft character.',
      inputSchema: z.object({ message: z.string().trim().min(1).max(256) }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async ({ message }) => {
      try {
        return toolResult(await bridge.say(message))
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'minecraft_recent_events',
    {
      title: 'Minecraft recent events',
      description: 'Read recent structured world events such as damage, entities, chat, skill progress and vision anomalies.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(30) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ limit }) => toolResult(bridge.events(limit))
  )

  server.registerResource(
    'minecraft-status',
    'minecraft://status',
    { title: 'Minecraft AI live status', description: 'Current structured Minecraft AI state.', mimeType: 'application/json' },
    async uri => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(bridge.status(), null, 2) }]
    })
  )

  return server
}
