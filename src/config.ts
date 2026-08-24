import 'dotenv/config'
import { z } from 'zod'
import { sameMinecraftUsername } from './core/minecraftIdentity.js'

const booleanString = z.string().default('false').transform(value => value.toLowerCase() === 'true')
const optionalString = z.string().transform(value => value.trim() || undefined).optional()

const envSchema = z.object({
  MC_HOST: z.string().default('127.0.0.1'),
  MC_PORT: z.coerce.number().int().min(1).max(65535).default(25565),
  MC_USERNAME: z.string().min(1).default('AI_Player'),
  MC_AUTH: z.enum(['offline', 'microsoft']).default('offline'),
  MC_VERSION: optionalString,
  MC_OWNER: z.string().min(1).default('FuQiang'),
  MC_RECONNECT_DELAY_MS: z.coerce.number().int().min(1000).default(5000),
  LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().min(1).default('gpt-5-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  LLM_MODE: z.enum(['api', 'mock']).default('api'),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PLANNER_HEARTBEAT_MS: z.coerce.number().int().min(1000).default(20000),
  SKILL_DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120000),
  MAX_PLAN_STEPS: z.coerce.number().int().min(1).max(100).default(20),
  MAX_ACTION_DISTANCE: z.coerce.number().min(1).default(128),
  ALLOW_PVP: booleanString,
  ALLOW_DROP_ITEMS: z.string().default('true').transform(value => value.toLowerCase() === 'true'),
  AUTO_RESUME: z.string().default('true').transform(value => value.toLowerCase() === 'true'),
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(3008),
  VISION_ENABLED: booleanString,
  VISION_FRAME_URL: optionalString,
  VISION_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  VISION_RESIDUAL_THRESHOLD: z.coerce.number().int().min(1).max(255).default(32),
  VISION_MIN_REGION_PIXELS: z.coerce.number().int().min(1).default(64),
  VLM_ENABLED: booleanString,
  VLM_MODEL: optionalString
})

const env = envSchema.parse(process.env)

export interface AppConfig {
  minecraft: {
    host: string
    port: number
    username: string
    auth: 'offline' | 'microsoft'
    version?: string
    owner: string
    reconnectDelayMs: number
  }
  llm: {
    baseUrl: string
    apiKey: string
    model: string
    timeoutMs: number
    maxRetries: number
    mode: 'api' | 'mock'
  }
  runtime: {
    dataDir: string
    logLevel: string
    plannerHeartbeatMs: number
    skillDefaultTimeoutMs: number
    maxPlanSteps: number
    maxActionDistance: number
    allowPvp: boolean
    allowDropItems: boolean
    autoResume: boolean
    healthPort: number
  }
  vision: {
    enabled: boolean
    frameUrl?: string
    intervalMs: number
    residualThreshold: number
    minRegionPixels: number
    vlmEnabled: boolean
    vlmModel?: string
  }
}

export const config: AppConfig = {
  minecraft: {
    host: env.MC_HOST,
    port: env.MC_PORT,
    username: env.MC_USERNAME,
    auth: env.MC_AUTH,
    ...(env.MC_VERSION ? { version: env.MC_VERSION } : {}),
    owner: env.MC_OWNER,
    reconnectDelayMs: env.MC_RECONNECT_DELAY_MS
  },
  llm: {
    baseUrl: env.LLM_BASE_URL.replace(/\/$/, ''),
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxRetries: env.LLM_MAX_RETRIES,
    mode: env.LLM_MODE
  },
  runtime: {
    dataDir: env.DATA_DIR,
    logLevel: env.LOG_LEVEL,
    plannerHeartbeatMs: env.PLANNER_HEARTBEAT_MS,
    skillDefaultTimeoutMs: env.SKILL_DEFAULT_TIMEOUT_MS,
    maxPlanSteps: env.MAX_PLAN_STEPS,
    maxActionDistance: env.MAX_ACTION_DISTANCE,
    allowPvp: env.ALLOW_PVP,
    allowDropItems: env.ALLOW_DROP_ITEMS,
    autoResume: env.AUTO_RESUME,
    healthPort: env.HEALTH_PORT
  },
  vision: {
    enabled: env.VISION_ENABLED,
    ...(env.VISION_FRAME_URL ? { frameUrl: env.VISION_FRAME_URL } : {}),
    intervalMs: env.VISION_INTERVAL_MS,
    residualThreshold: env.VISION_RESIDUAL_THRESHOLD,
    minRegionPixels: env.VISION_MIN_REGION_PIXELS,
    vlmEnabled: env.VLM_ENABLED,
    ...(env.VLM_MODEL ? { vlmModel: env.VLM_MODEL } : {})
  }
}

export function validateRuntimeConfig(value: AppConfig): void {
  if (process.env.MCP_STDIO !== 'true' && value.llm.mode === 'api' && !value.llm.apiKey) {
    throw new Error('LLM_API_KEY is required when LLM_MODE=api. Use LLM_MODE=mock for local verification.')
  }
  if (
    value.minecraft.auth === 'offline'
    && sameMinecraftUsername(value.minecraft.username, value.minecraft.owner)
  ) {
    throw new Error('MC_USERNAME and MC_OWNER must be different so the human and AI can join together.')
  }
  if (process.env.MCP_STDIO !== 'true' && value.vision.vlmEnabled && !value.vision.vlmModel) {
    throw new Error('VLM_MODEL is required when VLM_ENABLED=true.')
  }
  if (value.vision.enabled && !value.vision.frameUrl) {
    throw new Error('VISION_FRAME_URL is required when VISION_ENABLED=true.')
  }
}
