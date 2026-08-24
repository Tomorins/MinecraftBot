import { randomUUID } from 'node:crypto'
import type { ActionExecutor, ResourceName, SkillPriority, SkillResult, Vec3Like, WorldContext } from '../types.js'
import { z } from 'zod'
import type { SkillDefinition, SkillHandle } from './types.js'
import { EventBus } from '../core/event-bus.js'
import { logger } from '../logger.js'

const PRIORITY: Record<SkillPriority, number> = {
  background: 0,
  normal: 1,
  user: 2,
  combat: 3,
  emergency: 4
}

export class SkillRuntime {
  private readonly definitions = new Map<string, SkillDefinition>()
  private readonly running = new Map<string, { handle: SkillHandle; controller: AbortController }>()
  private readonly locks = new Map<ResourceName, string>()

  constructor(
    private readonly executor: ActionExecutor,
    private readonly world: () => WorldContext,
    private readonly events: EventBus,
    private readonly defaultTimeoutMs: number,
    private readonly rememberLocation: (key: string, position?: Vec3Like) => void = () => {}
  ) {}

  register(definition: SkillDefinition): void {
    if (this.definitions.has(definition.name)) throw new Error(`Duplicate skill: ${definition.name}`)
    this.definitions.set(definition.name, definition)
  }

  registerAll(definitions: SkillDefinition[]): void {
    for (const definition of definitions) this.register(definition)
  }

  catalog(): Array<{ name: string; description: string; parameters: unknown }> {
    return [...this.definitions.values()].map(definition => ({
      name: definition.name,
      description: definition.description,
      parameters: z.toJSONSchema(definition.schema, { unrepresentable: 'any' })
    }))
  }

  run(name: string, rawParams: Record<string, unknown>, options: { priority?: SkillPriority; timeoutMs?: number } = {}): SkillHandle {
    const definition = this.definitions.get(name)
    if (!definition) throw new Error(`Unknown skill: ${name}`)
    const params = definition.schema.parse(rawParams)
    const priority = options.priority ?? definition.priority
    this.resolveConflicts(definition.resources, priority)

    const id = randomUUID()
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? definition.defaultTimeoutMs ?? this.defaultTimeoutMs
    const timer = setTimeout(() => controller.abort(new Error(`Skill timeout after ${timeoutMs}ms`)), timeoutMs)

    const handle: SkillHandle = {
      id,
      name,
      priority,
      resources: [...definition.resources],
      startedAt: Date.now(),
      result: Promise.resolve({ status: 'failed', reason: 'not_started', recoverable: true }),
      cancel: (reason = 'cancelled') => controller.abort(new Error(reason))
    }
    for (const resource of definition.resources) this.locks.set(resource, id)

    handle.result = (async (): Promise<SkillResult> => {
      logger.info({ skill: name, skillId: id, params }, 'skill started')
      try {
        const result = await definition.run({
          executor: this.executor,
          signal: controller.signal,
          world: this.world,
          rememberLocation: this.rememberLocation,
          progress: progress => this.events.emit('skill_progress', { skill: name, skillId: id, ...progress }, 'low')
        }, params)
        if (result.status === 'success') this.events.emit('skill_completed', { skill: name, skillId: id, result }, 'normal')
        else this.events.emit('skill_failed', { skill: name, skillId: id, result }, result.recoverable ? 'high' : 'critical')
        return result
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const status = controller.signal.aborted
          ? reason.toLowerCase().includes('timeout') ? 'timeout' : 'cancelled'
          : 'failed'
        const result: SkillResult = { status, reason, recoverable: status !== 'cancelled' }
        this.events.emit('skill_failed', { skill: name, skillId: id, result }, status === 'cancelled' ? 'normal' : 'high')
        return result
      } finally {
        clearTimeout(timer)
        this.running.delete(id)
        for (const resource of definition.resources) if (this.locks.get(resource) === id) this.locks.delete(resource)
        logger.info({ skill: name, skillId: id }, 'skill stopped')
      }
    })()

    this.running.set(id, { handle, controller })
    return handle
  }

  async cancelAll(reason = 'cancel_all'): Promise<void> {
    for (const entry of this.running.values()) entry.controller.abort(new Error(reason))
    await this.executor.stop()
    await Promise.allSettled([...this.running.values()].map(entry => entry.handle.result))
  }

  active(): SkillHandle[] {
    return [...this.running.values()].map(entry => entry.handle)
  }

  has(name: string): boolean {
    return this.definitions.has(name)
  }

  private resolveConflicts(resources: ResourceName[], priority: SkillPriority): void {
    const conflicts = new Set<string>()
    for (const resource of resources) {
      const holder = this.locks.get(resource)
      if (holder) conflicts.add(holder)
    }
    for (const id of conflicts) {
      const active = this.running.get(id)
      if (!active) continue
      if (PRIORITY[priority] <= PRIORITY[active.handle.priority]) {
        throw new Error(`Resources locked by ${active.handle.name}`)
      }
      active.controller.abort(new Error(`preempted_by_${priority}_skill`))
    }
  }
}
