import { config, validateRuntimeConfig } from './config.js'
import { MinecraftAiApp } from './app.js'
import { logger } from './logger.js'

validateRuntimeConfig(config)
const app = new MinecraftAiApp(config)

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')
  await app.stop()
  process.exitCode = 0
}

process.on('SIGINT', () => { void shutdown('SIGINT') })
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('uncaughtException', error => {
  logger.fatal({ error }, 'uncaught exception')
  void shutdown('uncaughtException')
})
process.on('unhandledRejection', error => {
  logger.error({ error }, 'unhandled rejection')
})

app.start()
