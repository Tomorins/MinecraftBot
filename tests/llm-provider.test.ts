import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js'
import { worldContext } from './helpers.js'

const servers: Array<ReturnType<typeof createServer>> = []
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))))

describe('OpenAI-compatible provider', () => {
  it('falls back when an endpoint rejects response_format', async () => {
    let requests = 0
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', chunk => { body += String(chunk) })
      request.on('end', () => {
        requests += 1
        const parsed = JSON.parse(body) as { response_format?: unknown }
        if (parsed.response_format) {
          response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"unsupported response_format"}')
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ goal: 'test', reply: 'ok', steps: [], assumptions: [] }) } }] }))
      })
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server has no TCP address')
    const provider = new OpenAICompatibleProvider({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'test-key', model: 'test-model', timeoutMs: 2000, maxRetries: 0, mode: 'api'
    })
    const plan = await provider.plan({ command: 'hello', owner: 'FuQiang', context: worldContext(), skills: [] })
    expect(plan.reply).toBe('ok')
    expect(requests).toBe(2)
  })
})
