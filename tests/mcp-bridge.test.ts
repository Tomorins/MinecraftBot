import { describe, expect, it, vi } from 'vitest'
import type { Transport } from '@modelcontextprotocol/server'
import type { MinecraftAiStatus } from '../src/app.js'
import { createMinecraftMcpServer, MinecraftMcpBridge, type MinecraftController } from '../src/mcp/server.js'
import type { Plan, SkillResult, TaskRecord, WorldEvent } from '../src/types.js'

function status(task?: TaskRecord): MinecraftAiStatus {
  return {
    running: true,
    connected: true,
    username: 'AI_Player',
    owner: 'FuQiang',
    server: { host: '127.0.0.1', port: 25565 },
    ...(task ? { task } : {}),
    activeSkills: []
  }
}

function fakeController(): MinecraftController {
  const executePlan = vi.fn(async (plan: Plan): Promise<TaskRecord> => ({
    id: 'task-1',
    goal: plan.goal,
    status: 'completed',
    plan,
    createdAt: 1,
    updatedAt: 2
  }))
  return {
    status: () => status(),
    skillCatalog: () => [{ name: 'move_to', description: 'Move to a position.', parameters: { type: 'object' } }],
    executePlan,
    runSkill: async (): Promise<SkillResult> => ({ status: 'success', recoverable: false }),
    lookupKnowledge: name => ({ name }),
    searchGuides: query => [{ query }],
    cancelGoal: async () => {},
    say: async () => {},
    recentEvents: (): WorldEvent[] => []
  }
}

describe('MinecraftMcpBridge', () => {
  it('executes the plan supplied by Demiurge without requesting another LLM plan', async () => {
    const controller = fakeController()
    const bridge = new MinecraftMcpBridge(controller)
    const plan: Plan = {
      goal: '走到主人身边',
      reply: '',
      assumptions: [],
      steps: [{ id: 'move', skill: 'move_to', params: { x: 1, y: 64, z: 2 }, dependsOn: [], onFailure: 'abort' }]
    }

    expect(bridge.startPlan(plan).connected).toBe(true)
    await bridge.waitForGoal(1)

    expect(controller.executePlan).toHaveBeenCalledOnce()
    expect(controller.executePlan).toHaveBeenCalledWith(plan)
  })

  it('exposes the runtime catalog and direct skill execution', async () => {
    const bridge = new MinecraftMcpBridge(fakeController())
    expect(bridge.catalog().map(skill => skill.name)).toEqual(['move_to'])
    await expect(bridge.runSkill('move_to', { x: 1, y: 64, z: 2 })).resolves.toMatchObject({ status: 'success' })
  })

  it('publishes planning, knowledge, status and chat tools over the MCP protocol', async () => {
    const controller = fakeController()
    let emitEvent: ((event: WorldEvent) => void | Promise<void>) | undefined
    controller.onEvent = listener => {
      emitEvent = listener
      return () => { emitEvent = undefined }
    }
    const server = createMinecraftMcpServer(controller)
    const sent: unknown[] = []
    const transport: Transport = {
      start: async () => {},
      close: async () => {},
      send: async (message: unknown) => { sent.push(message) }
    }
    await server.connect(transport)
    transport.onmessage?.({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' }
      }
    } as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} } as never)
    transport.onmessage?.({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } as never)
    await new Promise(resolve => setTimeout(resolve, 0))

    const response = sent.find((message): message is { id: number; result: { tools: Array<{ name: string }> } } => {
      return typeof message === 'object' && message !== null && 'id' in message && (message as { id?: number }).id === 2
    })
    const names = response?.result.tools.map(tool => tool.name) ?? []
    expect(names).toContain('minecraft_execute_plan')
    expect(names).toContain('minecraft_skill_catalog')
    expect(names).toContain('minecraft_lookup_knowledge')
    expect(names).toContain('minecraft_search_guides')
    expect(names).toContain('minecraft_say')
    expect(names).not.toContain('minecraft_start_goal')

    await emitEvent?.({
      id: 'event-1',
      type: 'chat',
      timestamp: 10,
      priority: 'normal',
      data: {
        username: 'Alex',
        message: 'AI_Player，能帮我看看吗',
        utterance: '能帮我看看吗',
        channel: 'public',
        aiUsername: 'AI_Player',
        isPrimaryUser: false,
        addressedToAi: true,
        addressReason: 'username'
      }
    })
    await emitEvent?.({
      id: 'event-2',
      type: 'chat',
      timestamp: 11,
      priority: 'low',
      data: {
        username: 'Steve',
        message: '大家先回基地',
        utterance: '大家先回基地',
        channel: 'public',
        aiUsername: 'AI_Player',
        isPrimaryUser: false,
        addressedToAi: false,
        addressReason: 'implicit'
      }
    })
    await emitEvent?.({
      id: 'event-3',
      type: 'whisper',
      timestamp: 12,
      priority: 'normal',
      data: {
        username: 'FuQiang',
        message: '你在哪',
        utterance: '你在哪',
        channel: 'whisper',
        aiUsername: 'AI_Player',
        isPrimaryUser: true,
        addressedToAi: true,
        addressReason: 'whisper'
      }
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    const notifications = sent.filter((message): message is { method: string; params: { data: { event?: WorldEvent } } } => {
      return typeof message === 'object' && message !== null && 'method' in message && (message as { method?: string }).method === 'notifications/message'
    })
    expect(notifications[0]?.params.data.event?.data).toMatchObject({
      username: 'Alex',
      utterance: '能帮我看看吗',
      isPrimaryUser: false,
      addressedToAi: true
    })
    expect(notifications[1]?.params.data.event?.data).toMatchObject({
      username: 'Steve',
      addressedToAi: false,
      channel: 'public'
    })
    expect(notifications[2]?.params.data.event?.data).toMatchObject({
      username: 'FuQiang',
      isPrimaryUser: true,
      channel: 'whisper'
    })
    await server.close()
  })
})
