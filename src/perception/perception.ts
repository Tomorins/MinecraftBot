import type { Bot } from 'mineflayer'
import type { BlockObservation, EntityObservation, InventoryItem, PerceptionSnapshot, Vec3Like } from '../types.js'
import { EventBus } from '../core/event-bus.js'
import { distance } from '../core/utils.js'

const HOSTILES = new Set([
  'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper', 'spider', 'cave_spider',
  'witch', 'slime', 'magma_cube', 'enderman', 'endermite', 'silverfish', 'blaze', 'ghast',
  'piglin_brute', 'hoglin', 'zoglin', 'phantom', 'pillager', 'vindicator', 'evoker', 'ravager',
  'guardian', 'elder_guardian', 'warden', 'breeze', 'shulker', 'witherskeleton', 'wither_skeleton'
])

const RESOURCE_BLOCKS = [
  'coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore', 'copper_ore',
  'deepslate_copper_ore', 'gold_ore', 'deepslate_gold_ore', 'redstone_ore',
  'deepslate_redstone_ore', 'lapis_ore', 'deepslate_lapis_ore', 'diamond_ore',
  'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore', 'ancient_debris',
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'mangrove_log', 'cherry_log', 'stone', 'cobblestone'
]
const HAZARD_BLOCKS = ['lava', 'fire', 'soul_fire', 'cactus', 'magma_block', 'powder_snow', 'sweet_berry_bush']
const STATION_BLOCKS = ['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'barrel', 'anvil', 'smithing_table', 'stonecutter', 'bed']

export class PerceptionSystem {
  private interval: NodeJS.Timeout | undefined
  private lastHealth = 20
  private latestValue?: PerceptionSnapshot

  constructor(
    private readonly bot: Bot,
    private readonly events: EventBus,
    private readonly intervalMs = 750
  ) {}

  start(onSnapshot: (snapshot: PerceptionSnapshot) => void): void {
    this.bindEvents()
    const sample = () => {
      if (!this.bot.entity) return
      const snapshot = this.capture()
      this.latestValue = snapshot
      onSnapshot(snapshot)
    }
    sample()
    this.interval = setInterval(sample, this.intervalMs)
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = undefined
  }

  latest(): PerceptionSnapshot {
    if (!this.latestValue) this.latestValue = this.capture()
    return this.latestValue
  }

  capture(): PerceptionSnapshot {
    const position = this.vec(this.bot.entity.position)
    const effectsObject = (this.bot.entity as unknown as { effects?: Record<string, { name?: string }> }).effects ?? {}
    return {
      timestamp: Date.now(),
      self: {
        username: this.bot.username,
        position,
        velocity: this.vec(this.bot.entity.velocity),
        yaw: this.bot.entity.yaw,
        pitch: this.bot.entity.pitch,
        health: this.bot.health,
        food: this.bot.food,
        oxygen: this.bot.oxygenLevel,
        dimension: String(this.bot.game.dimension),
        gameMode: String(this.bot.game.gameMode),
        onGround: this.bot.entity.onGround,
        isSleeping: this.bot.isSleeping,
        effects: Object.values(effectsObject).map(effect => effect.name ?? 'unknown')
      },
      inventory: this.inventory(),
      entities: this.entities(position),
      blocks: this.blocks(position),
      timeOfDay: this.bot.time.timeOfDay,
      isRaining: this.bot.isRaining,
      recentEvents: this.events.recent(25)
    }
  }

  private bindEvents(): void {
    this.lastHealth = this.bot.health
    this.bot.on('health', () => {
      const delta = this.bot.health - this.lastHealth
      this.events.emit('health_changed', { health: this.bot.health, food: this.bot.food, delta }, delta < 0 ? 'high' : 'normal')
      if (delta < 0) this.events.emit('damage', { amount: -delta, health: this.bot.health }, this.bot.health <= 6 ? 'critical' : 'high')
      this.lastHealth = this.bot.health
    })
    this.bot.on('death', () => { this.events.emit('death', { position: this.vec(this.bot.entity.position) }, 'critical') })
    this.bot.on('entitySpawn', entity => { this.events.emit('entity_appeared', this.entity(entity, this.vec(this.bot.entity.position)), this.isHostile(entity) ? 'high' : 'low') })
    this.bot.on('entityGone', entity => { this.events.emit('entity_gone', { id: entity.id, name: entity.name }, 'low') })
    this.bot.on('blockUpdate', (oldBlock, newBlock) => { this.events.emit('block_changed', {
      old: oldBlock?.name ?? 'air', new: newBlock.name, position: this.vec(newBlock.position)
    }, 'low') })
    this.bot.on('playerCollect', (collector, collected) => {
      if (collector.id === this.bot.entity.id) this.events.emit('item_collected', { entityId: collected.id }, 'normal')
    })
    this.bot.on('rain', () => { this.events.emit('weather_changed', { raining: this.bot.isRaining }, 'low') })
  }

  private inventory(): InventoryItem[] {
    return this.bot.inventory.items().map(item => {
      const maxDurability = (item as unknown as { maxDurability?: number }).maxDurability
      const used = (item as unknown as { durabilityUsed?: number }).durabilityUsed
      return {
        name: item.name,
        displayName: item.displayName,
        count: item.count,
        slot: item.slot,
        ...(typeof maxDurability === 'number' && typeof used === 'number'
          ? { durabilityRemaining: Math.max(0, (maxDurability - used) / maxDurability) }
          : {})
      }
    })
  }

  private entities(origin: Vec3Like): EntityObservation[] {
    return Object.values(this.bot.entities)
      .filter(entity => entity.id !== this.bot.entity.id && entity.position && distance(origin, entity.position) <= 48)
      .map(entity => this.entity(entity, origin))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 50)
  }

  private entity(entity: Bot['entity'], origin: Vec3Like): EntityObservation {
    const name = entity.username ?? entity.name ?? entity.displayName ?? 'unknown'
    return {
      id: entity.id,
      name,
      kind: entity.type ?? 'unknown',
      position: this.vec(entity.position),
      distance: distance(origin, entity.position),
      velocity: this.vec(entity.velocity),
      hostile: this.isHostile(entity),
      player: entity.type === 'player'
    }
  }

  private blocks(origin: Vec3Like): BlockObservation[] {
    const result: BlockObservation[] = []
    const categories: Array<[string[], BlockObservation['category']]> = [
      [RESOURCE_BLOCKS, 'resource'], [HAZARD_BLOCKS, 'hazard'], [STATION_BLOCKS, 'station']
    ]
    for (const [names, category] of categories) {
      const ids = names.map(name => this.bot.registry.blocksByName[name]?.id).filter((id): id is number => typeof id === 'number')
      if (ids.length === 0) continue
      const positions = this.bot.findBlocks({ matching: ids, maxDistance: category === 'resource' ? 24 : 16, count: 40 })
      for (const position of positions) {
        const block = this.bot.blockAt(position)
        if (!block) continue
        result.push({ name: block.name, position: this.vec(position), distance: distance(origin, position), category })
      }
    }
    return result.sort((a, b) => a.distance - b.distance).slice(0, 100)
  }

  private isHostile(entity: Bot['entity']): boolean {
    const name = (entity.name ?? '').toLowerCase()
    return HOSTILES.has(name) || entity.kind === 'Hostile mobs'
  }

  private vec(value: Vec3Like): Vec3Like {
    return { x: value.x, y: value.y, z: value.z }
  }
}
