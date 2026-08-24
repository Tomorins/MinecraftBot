import { EventBus } from '../core/event-bus.js'
import { SkillRuntime } from '../skills/runtime.js'
import { WorldModel } from '../world/world-model.js'
import { distance } from '../core/utils.js'
import type { Vec3Like } from '../types.js'
import { logger } from '../logger.js'

const SAFE_FOODS = ['cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'bread', 'baked_potato', 'cooked_mutton', 'apple', 'carrot']

export class SafetySupervisor {
  private interval: NodeJS.Timeout | undefined
  private lastPosition: Vec3Like | undefined
  private lastMovedAt = Date.now()
  private emergencyRunning = false
  private reportedDurability = new Set<number>()
  private unsubscribeDeath: (() => void) | undefined
  private inventoryReported = false

  constructor(
    private readonly world: WorldModel,
    private readonly runtime: SkillRuntime,
    private readonly events: EventBus
  ) {}

  start(): void {
    this.interval = setInterval(() => { void this.check() }, 1000)
    this.unsubscribeDeath = this.events.on('death', async () => this.runtime.cancelAll('player_died'))
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = undefined
    this.unsubscribeDeath?.()
    this.unsubscribeDeath = undefined
  }

  private async check(): Promise<void> {
    let context
    try { context = this.world.context() } catch { return }
    const { snapshot } = context

    if (snapshot.self.health <= 6 && !this.emergencyRunning) {
      this.emergencyRunning = true
      try {
        const threats = context.scene.threats.filter(entity => entity.distance < 16)
        if (threats.length > 0) await this.runtime.run('escape_threat', { distance: 20 }, { priority: 'emergency', timeoutMs: 45_000 }).result
        const food = SAFE_FOODS.find(item => snapshot.inventory.some(entry => entry.name === item))
        if (food && snapshot.self.food < 20) await this.runtime.run('eat_food', { item: food }, { priority: 'emergency' }).result
      } catch (error) {
        logger.warn({ error }, 'emergency safety action failed')
      } finally {
        this.emergencyRunning = false
      }
    }

    const moving = this.runtime.active().some(skill => skill.resources.includes('movement'))
    if (this.lastPosition && distance(this.lastPosition, snapshot.self.position) > 0.3) this.lastMovedAt = Date.now()
    if (moving && Date.now() - this.lastMovedAt > 7000) {
      this.events.emit('stuck', { position: snapshot.self.position, skills: this.runtime.active().map(skill => skill.name) }, 'high')
      this.lastMovedAt = Date.now()
    }
    this.lastPosition = snapshot.self.position

    if (snapshot.inventory.length >= 35 && !this.inventoryReported) {
      this.inventoryReported = true
      this.events.emit('inventory_full', { slotsUsed: snapshot.inventory.length }, 'high')
    } else if (snapshot.inventory.length < 35) {
      this.inventoryReported = false
    }
    for (const item of snapshot.inventory) {
      if (item.durabilityRemaining !== undefined && item.durabilityRemaining < 0.1 && !this.reportedDurability.has(item.slot)) {
        this.reportedDurability.add(item.slot)
        this.events.emit('tool_low_durability', { item: item.name, slot: item.slot, remaining: item.durabilityRemaining }, 'high')
      }
    }
  }
}
