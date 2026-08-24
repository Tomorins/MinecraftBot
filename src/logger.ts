import pino, { type LoggerOptions } from 'pino'
import { config } from './config.js'

const options: LoggerOptions = {
  level: config.runtime.logLevel,
  redact: {
    paths: ['apiKey', '*.apiKey', 'authorization', '*.authorization'],
    censor: '[REDACTED]'
  },
  ...(process.env.NODE_ENV === 'production' || process.env.MCP_STDIO === 'true'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } })
}

// MCP reserves stdout for newline-delimited JSON-RPC. All bridge logs must go
// to stderr or Demiurge will treat them as malformed protocol messages.
export const logger = process.env.MCP_STDIO === 'true'
  ? pino(options, pino.destination({ dest: 2, sync: false }))
  : pino(options)
