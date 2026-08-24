import mineflayer, { type Bot } from 'mineflayer'
import { createRequire } from 'node:module'
import type * as PathfinderModule from 'mineflayer-pathfinder'
import type { AppConfig } from '../config.js'
import { logger } from '../logger.js'

const require = createRequire(import.meta.url)
const { pathfinder } = require('mineflayer-pathfinder') as typeof PathfinderModule

export interface ConnectionCallbacks {
  onSpawn(bot: Bot): Promise<void>
  onEnd(reason: string): Promise<void>
}

export class BotConnection {
  private bot: Bot | undefined
  private reconnectTimer: NodeJS.Timeout | undefined
  private stopping = false
  private sessionStarted = false

  constructor(private readonly config: AppConfig['minecraft'], private readonly callbacks: ConnectionCallbacks) {}

  isRunning(): boolean {
    return !this.stopping && Boolean(this.bot || this.reconnectTimer)
  }

  start(): void {
    this.stopping = false
    this.connect()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    if (this.bot) {
      this.bot.quit('AI service shutting down')
      this.bot = undefined
    }
    if (this.sessionStarted) await this.callbacks.onEnd('service_shutdown')
    this.sessionStarted = false
  }

  private connect(): void {
    if (this.stopping) return
    logger.info({ host: this.config.host, port: this.config.port, username: this.config.username, auth: this.config.auth }, 'connecting to Minecraft')
    const bot = mineflayer.createBot({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      auth: this.config.auth,
      ...(this.config.version ? { version: this.config.version } : {}),
      hideErrors: true
    })
    this.bot = bot
    bot.loadPlugin(pathfinder)

    bot.once('spawn', () => {
      this.sessionStarted = true
      logger.info({ username: bot.username, version: bot.version }, 'Minecraft bot spawned')
      void this.callbacks.onSpawn(bot).catch(error => {
        logger.error({ error }, 'failed to initialize bot session')
        bot.quit('Session initialization failed')
      })
    })
    bot.on('kicked', (reason, loggedIn) => logger.warn({ reason, loggedIn }, 'Minecraft bot kicked'))
    bot.on('error', error => logger.error({ error }, 'Minecraft connection error'))
    bot.once('end', reason => { void this.handleEnd(reason) })
  }

  private async handleEnd(reason: string): Promise<void> {
    logger.warn({ reason }, 'Minecraft connection ended')
    this.bot = undefined
    if (this.sessionStarted) await this.callbacks.onEnd(reason)
    this.sessionStarted = false
    if (!this.stopping) {
      this.reconnectTimer = setTimeout(() => this.connect(), this.config.reconnectDelayMs)
    }
  }
}
