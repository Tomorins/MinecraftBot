export interface Vec3Like {
  x: number
  y: number
  z: number
}

export interface SelfState {
  username: string
  position: Vec3Like
  velocity: Vec3Like
  yaw: number
  pitch: number
  health: number
  food: number
  oxygen: number
  dimension: string
  gameMode: string
  onGround: boolean
  isSleeping: boolean
  effects: string[]
}

export interface InventoryItem {
  name: string
  displayName: string
  count: number
  slot: number
  durabilityRemaining?: number
}

export interface EntityObservation {
  id: number
  name: string
  kind: string
  position: Vec3Like
  distance: number
  velocity: Vec3Like
  hostile: boolean
  player: boolean
}

export interface BlockObservation {
  name: string
  position: Vec3Like
  distance: number
  category: 'resource' | 'hazard' | 'station' | 'structure' | 'other'
}

export type WorldEventType =
  | 'spawn'
  | 'health_changed'
  | 'damage'
  | 'death'
  | 'entity_appeared'
  | 'entity_gone'
  | 'block_changed'
  | 'item_collected'
  | 'chat'
  | 'whisper'
  | 'weather_changed'
  | 'dimension_changed'
  | 'stuck'
  | 'inventory_full'
  | 'tool_low_durability'
  | 'skill_progress'
  | 'skill_completed'
  | 'skill_failed'
  | 'planner_heartbeat'
  | 'vision_anomaly'
  | 'vision_vlm_request'

export interface WorldEvent<T = unknown> {
  id: string
  type: WorldEventType
  timestamp: number
  priority: 'low' | 'normal' | 'high' | 'critical'
  data: T
}

export interface PerceptionSnapshot {
  timestamp: number
  self: SelfState
  inventory: InventoryItem[]
  entities: EntityObservation[]
  blocks: BlockObservation[]
  timeOfDay: number
  isRaining: boolean
  recentEvents: WorldEvent[]
}

export interface SceneSummary {
  locationType: string
  threats: EntityObservation[]
  resources: Array<{ name: string; visibleCount: number; nearestDistance: number }>
  hazards: BlockObservation[]
  stations: BlockObservation[]
}

export interface TaskRecord {
  id: string
  goal: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentStep?: string
  createdAt: number
  updatedAt: number
  plan?: Plan
  result?: unknown
}

export interface WorldContext {
  snapshot: PerceptionSnapshot
  scene: SceneSummary
  currentTask?: TaskRecord
  memories: MemoryRecord[]
}

export interface MemoryRecord {
  id: string
  kind: 'location' | 'container' | 'event' | 'conversation' | 'summary' | 'structure'
  key: string
  value: unknown
  position?: Vec3Like
  dimension?: string
  createdAt: number
  updatedAt: number
  confidence: number
}

export interface PlanStep {
  id: string
  skill: string
  params: Record<string, unknown>
  dependsOn: string[]
  onFailure: 'retry' | 'replan' | 'abort'
}

export interface Plan {
  goal: string
  reply: string
  steps: PlanStep[]
  assumptions: string[]
}

export type SkillStatus = 'success' | 'failed' | 'cancelled' | 'timeout'

export interface SkillResult<T = unknown> {
  status: SkillStatus
  reason?: string
  data?: T
  progress?: Record<string, unknown>
  recoverable: boolean
}

export interface SkillProgress {
  skill: string
  phase: string
  percent?: number
  detail?: string
  data?: Record<string, unknown>
}

export type ResourceName =
  | 'movement'
  | 'camera'
  | 'main_hand'
  | 'off_hand'
  | 'inventory'
  | 'container_ui'
  | 'chat'

export type SkillPriority = 'background' | 'normal' | 'user' | 'combat' | 'emergency'

export interface ExecutionResult<T = unknown> {
  ok: boolean
  reason?: string
  data?: T
  durationMs: number
}

export interface ActionOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ActionExecutor {
  moveTo(position: Vec3Like, range: number, options?: ActionOptions): Promise<ExecutionResult>
  followPlayer(username: string, distance: number, options?: ActionOptions): Promise<ExecutionResult>
  stop(): Promise<void>
  lookAt(position: Vec3Like, options?: ActionOptions): Promise<ExecutionResult>
  digBlock(position: Vec3Like, options?: ActionOptions): Promise<ExecutionResult>
  digNearest(blockNames: string[], maxDistance: number, options?: ActionOptions): Promise<ExecutionResult<{ position: Vec3Like; name: string }>>
  placeBlock(itemName: string, position: Vec3Like, options?: ActionOptions): Promise<ExecutionResult>
  attackEntity(entityId: number, options?: ActionOptions): Promise<ExecutionResult>
  craftItem(itemName: string, count: number, options?: ActionOptions): Promise<ExecutionResult>
  smeltItem(itemName: string, count: number, options?: ActionOptions): Promise<ExecutionResult>
  equipItem(itemName: string, destination?: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet', options?: ActionOptions): Promise<ExecutionResult>
  consumeItem(itemName: string, options?: ActionOptions): Promise<ExecutionResult>
  dropItem(itemName: string, count: number, options?: ActionOptions): Promise<ExecutionResult>
  activateBlock(position: Vec3Like, options?: ActionOptions): Promise<ExecutionResult>
  storeItems(position: Vec3Like, items: Record<string, number>, options?: ActionOptions): Promise<ExecutionResult>
  retrieveItems(position: Vec3Like, items: Record<string, number>, options?: ActionOptions): Promise<ExecutionResult>
  chat(message: string): Promise<void>
  inventoryCount(itemName: string): number
  nearbyEntities(): EntityObservation[]
  currentPosition(): Vec3Like
  findBlocks(blockNames: string[], maxDistance: number, count: number): BlockObservation[]
}
