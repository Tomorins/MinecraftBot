import { randomUUID } from 'node:crypto'
import type { Plan, PlanStep, SkillResult, TaskRecord, WorldContext } from '../types.js'
import type { LLMProvider } from '../llm/provider.js'
import { SkillRuntime } from '../skills/runtime.js'
import { WorldModel } from '../world/world-model.js'
import { MemoryStore } from '../memory/sqlite-memory.js'
import { MinecraftKnowledge } from '../knowledge/minecraft-knowledge.js'
import { GuideRag } from '../knowledge/rag.js'
import { logger } from '../logger.js'

export class Planner {
  private activeController: AbortController | undefined
  private activePromise: Promise<TaskRecord> | undefined
  private eventReplanning = false

  constructor(
    private readonly llm: LLMProvider,
    private readonly runtime: SkillRuntime,
    private readonly world: WorldModel,
    private readonly memory: MemoryStore,
    private readonly knowledge: MinecraftKnowledge,
    private readonly rag: GuideRag,
    private readonly owner: string,
    private readonly maxPlanSteps: number
  ) {}

  async submit(command: string): Promise<TaskRecord> {
    await this.stop('replaced_by_new_command')
    const controller = new AbortController()
    this.activeController = controller
    const task: TaskRecord = {
      id: randomUUID(), goal: command, status: 'pending', createdAt: Date.now(), updatedAt: Date.now()
    }
    this.world.setCurrentTask(task)
    this.activePromise = this.runTask(task, command, controller.signal)
    return this.activePromise
  }

  async executePrepared(input: Plan): Promise<TaskRecord> {
    await this.stop('replaced_by_demiurge_plan')
    const controller = new AbortController()
    this.activeController = controller
    const plan = this.validatePlan(input)
    const task: TaskRecord = {
      id: randomUUID(),
      goal: plan.goal,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      plan
    }
    this.world.setCurrentTask(task)
    this.activePromise = this.runPreparedTask(task, plan, controller.signal)
    return this.activePromise
  }

  async stop(reason = 'stopped_by_user'): Promise<void> {
    this.activeController?.abort(new Error(reason))
    await this.runtime.cancelAll(reason)
    if (this.activePromise) await Promise.allSettled([this.activePromise])
    this.activeController = undefined
    this.activePromise = undefined
    const task = this.world.currentTask()
    if (task?.status === 'running' || task?.status === 'pending') {
      task.status = 'cancelled'
      task.updatedAt = Date.now()
      task.result = { reason }
      this.world.setCurrentTask(task)
    }
  }

  status(): TaskRecord | undefined {
    return this.world.currentTask()
  }

  async resume(): Promise<TaskRecord | undefined> {
    const task = this.world.restoreActiveTask()
    if (!task) return undefined
    return this.submit(`继续未完成任务：${task.goal}`)
  }

  async replanForEvent(type: string, data: unknown): Promise<TaskRecord | undefined> {
    const task = this.world.currentTask()
    if (this.eventReplanning || !task || task.status !== 'running') return undefined
    this.eventReplanning = true
    try {
      const replanned = await this.submit(`继续完成目标“${task.goal}”。刚发生异常事件 ${type}：${JSON.stringify(data)}。请调整剩余计划。`)
      if (replanned.status === 'completed') await this.runtimeChat(`已处理 ${type}，任务继续完成。`)
      return replanned
    } finally {
      this.eventReplanning = false
    }
  }

  private async runTask(task: TaskRecord, command: string, signal: AbortSignal): Promise<TaskRecord> {
    try {
      const context = this.world.context()
      const inventory = Object.fromEntries(context.snapshot.inventory.map(item => [item.name, item.count]))
      const likelyItem = this.extractLikelyItem(command)
      const exactKnowledge = likelyItem
        ? { description: this.knowledge.describe(likelyItem), craftingPlan: this.knowledge.calculateCraftingPlan(likelyItem, 1, inventory) }
        : undefined
      const guides = this.rag.search(command, 4)
      let plan = await this.llm.plan({ command, owner: this.owner, context, skills: this.runtime.catalog(), exactKnowledge, guideKnowledge: guides }, signal)
      plan = this.validatePlan(plan)
      task.goal = plan.goal
      task.plan = plan
      task.status = 'running'
      task.updatedAt = Date.now()
      this.world.setCurrentTask(task)

      if (plan.reply) await this.runtimeChat(plan.reply)
      let result = await this.executePlan(task, plan, signal)
      if (result.status !== 'success' && result.recoverable && !signal.aborted) {
        const failedStep = plan.steps.find(step => step.id === task.currentStep)
        if (failedStep?.onFailure === 'replan') {
          const recovery = this.validatePlan(await this.llm.recover({
            originalGoal: task.goal,
            failedSkill: failedStep.skill,
            failedParams: failedStep.params,
            result,
            context: this.world.context(),
            skills: this.runtime.catalog(),
            exactKnowledge: this.knowledgeForFailedStep(failedStep)
          }, signal))
          if (recovery.reply) await this.runtimeChat(recovery.reply)
          task.plan = recovery
          result = await this.executePlan(task, recovery, signal)
        }
      }

      task.status = result.status === 'success' ? 'completed' : signal.aborted ? 'cancelled' : 'failed'
      task.result = result
      task.updatedAt = Date.now()
      this.world.setCurrentTask(task)
      this.memory.upsertMemory({
        kind: 'event', key: `task:${task.id}`, value: { goal: task.goal, status: task.status, result }, confidence: 1
      })
      return task
    } catch (error) {
      task.status = signal.aborted ? 'cancelled' : 'failed'
      task.result = { reason: error instanceof Error ? error.message : String(error) }
      task.updatedAt = Date.now()
      this.world.setCurrentTask(task)
      logger.error({ error, taskId: task.id }, 'planner task failed')
      return task
    } finally {
      if (this.activeController?.signal === signal) {
        this.activeController = undefined
        this.activePromise = undefined
      }
    }
  }

  private async runPreparedTask(task: TaskRecord, plan: Plan, signal: AbortSignal): Promise<TaskRecord> {
    try {
      const result = await this.executePlan(task, plan, signal)
      task.status = result.status === 'success' ? 'completed' : signal.aborted ? 'cancelled' : 'failed'
      task.result = result
      task.updatedAt = Date.now()
      this.world.setCurrentTask(task)
      this.memory.upsertMemory({
        kind: 'event',
        key: `task:${task.id}`,
        value: { goal: task.goal, status: task.status, result },
        confidence: 1
      })
      return task
    } catch (error) {
      task.status = signal.aborted ? 'cancelled' : 'failed'
      task.result = { reason: error instanceof Error ? error.message : String(error) }
      task.updatedAt = Date.now()
      this.world.setCurrentTask(task)
      return task
    } finally {
      if (this.activeController?.signal === signal) {
        this.activeController = undefined
        this.activePromise = undefined
      }
    }
  }

  private async executePlan(task: TaskRecord, plan: Plan, signal: AbortSignal): Promise<SkillResult> {
    const completed = new Set<string>()
    const pending = new Map(plan.steps.map(step => [step.id, step]))
    let lastResult: SkillResult = { status: 'success', recoverable: false }
    while (pending.size > 0) {
      if (signal.aborted) throw signal.reason
      const ready = [...pending.values()].find(step => step.dependsOn.every(id => completed.has(id)))
      if (!ready) return { status: 'failed', reason: 'plan_dependency_cycle_or_missing_dependency', recoverable: false }
      task.currentStep = ready.id
      task.updatedAt = Date.now()
      this.world.setCurrentTask(task)
      lastResult = await this.executeStep(ready, signal)
      if (lastResult.status !== 'success' && ready.onFailure === 'retry' && lastResult.recoverable) {
        lastResult = await this.executeStep(ready, signal)
      }
      if (lastResult.status !== 'success') return lastResult
      completed.add(ready.id)
      pending.delete(ready.id)
    }
    return lastResult
  }

  private async executeStep(step: PlanStep, signal: AbortSignal): Promise<SkillResult> {
    const handle = this.runtime.run(step.skill, step.params)
    const abort = () => handle.cancel('planner_cancelled')
    signal.addEventListener('abort', abort, { once: true })
    try {
      return await handle.result
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private validatePlan(plan: Plan): Plan {
    if (plan.steps.length > this.maxPlanSteps) throw new Error(`Plan exceeds MAX_PLAN_STEPS (${this.maxPlanSteps})`)
    const ids = new Set<string>()
    for (const step of plan.steps) {
      if (ids.has(step.id)) throw new Error(`Duplicate plan step id: ${step.id}`)
      if (!this.runtime.has(step.skill)) throw new Error(`Planner selected unknown skill: ${step.skill}`)
      this.validateMinecraftNames(step)
      ids.add(step.id)
    }
    for (const step of plan.steps) {
      for (const dependency of step.dependsOn) if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} in ${step.id}`)
    }
    return plan
  }

  private async runtimeChat(message: string): Promise<void> {
    const handle = this.runtime.run('say', { message }, { priority: 'user', timeoutMs: 15_000 })
    await handle.result
  }

  private extractLikelyItem(command: string): string | undefined {
    const aliases: Record<string, string> = {
      '石镐': 'stone_pickaxe', '木镐': 'wooden_pickaxe', '铁镐': 'iron_pickaxe', '钻石镐': 'diamond_pickaxe',
      '工作台': 'crafting_table', '熔炉': 'furnace', '铁锭': 'iron_ingot', '金锭': 'gold_ingot',
      '圆石': 'cobblestone', '木棍': 'stick', '火把': 'torch', '煤炭': 'coal', '钻石': 'diamond',
      '橡木原木': 'oak_log', '橡木板': 'oak_planks', '生铁': 'raw_iron', '面包': 'bread'
    }
    const alias = Object.entries(aliases).find(([label]) => command.includes(label))
    if (alias) return alias[1]
    const names = this.knowledge.data.itemsArray.map(item => item.name).sort((a, b) => b.length - a.length)
    return names.find(name => command.toLowerCase().includes(name.replaceAll('_', ' ')))
  }

  private knowledgeForFailedStep(step: PlanStep): unknown {
    const item = typeof step.params.item === 'string' ? step.params.item : undefined
    if (!item) return undefined
    const inventory = Object.fromEntries(this.world.context().snapshot.inventory.map(value => [value.name, value.count]))
    return {
      description: this.knowledge.describe(item),
      craftingPlan: this.knowledge.calculateCraftingPlan(item, typeof step.params.count === 'number' ? step.params.count : 1, inventory),
      smeltingInputs: this.knowledge.getSmeltingInputsFor(item)
    }
  }

  private validateMinecraftNames(step: PlanStep): void {
    if (['craft_item', 'equip_item', 'drop_item', 'deliver_item', 'place_block', 'place_nearby'].includes(step.skill)) {
      const item = step.params.item
      if (typeof item === 'string' && !this.knowledge.getItem(item)) throw new Error(`Unknown Minecraft item in ${step.id}: ${item}`)
    }
    if (step.skill === 'collect_blocks' && Array.isArray(step.params.blocks)) {
      for (const block of step.params.blocks) {
        if (typeof block !== 'string' || !this.knowledge.getBlock(block)) throw new Error(`Unknown Minecraft block in ${step.id}: ${String(block)}`)
      }
    }
  }
}
