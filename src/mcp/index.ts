import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { MinecraftAiApp } from '../app.js'
import { config, validateRuntimeConfig } from '../config.js'
import { logger } from '../logger.js'
import { createMinecraftMcpServer } from './server.js'

validateRuntimeConfig(config)
const app = new MinecraftAiApp(config)
app.start()

const handle = serveStdio(() => createMinecraftMcpServer(app), {
  onerror: error => logger.error({ error }, 'MCP transport error')
})

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down Minecraft MCP bridge')
  await app.stop()
  await handle.close()
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
