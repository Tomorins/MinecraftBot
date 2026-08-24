import { describe, expect, it } from 'vitest'
import { config, validateRuntimeConfig, type AppConfig } from '../src/config.js'

function copy(): AppConfig {
  return structuredClone(config)
}

describe('runtime configuration', () => {
  it('requires an API key in API mode', () => {
    const value = copy()
    value.llm.mode = 'api'
    value.llm.apiKey = ''
    expect(() => validateRuntimeConfig(value)).toThrow('LLM_API_KEY')
  })

  it('prevents the offline bot from using the owner name', () => {
    const value = copy()
    value.llm.mode = 'mock'
    value.minecraft.auth = 'offline'
    value.minecraft.username = value.minecraft.owner.toUpperCase()
    expect(() => validateRuntimeConfig(value)).toThrow('must be different')
  })

  it('requires a renderer endpoint when residual vision is enabled', () => {
    const value = copy()
    value.llm.mode = 'mock'
    value.vision.enabled = true
    delete value.vision.frameUrl
    expect(() => validateRuntimeConfig(value)).toThrow('VISION_FRAME_URL')
  })

  it('does not require any Mineflayer-side model credential in MCP mode', () => {
    const previous = process.env.MCP_STDIO
    process.env.MCP_STDIO = 'true'
    try {
      const value = copy()
      value.llm.mode = 'api'
      value.llm.apiKey = ''
      value.vision.vlmEnabled = true
      delete value.vision.vlmModel
      expect(() => validateRuntimeConfig(value)).not.toThrow()
    } finally {
      if (previous === undefined) delete process.env.MCP_STDIO
      else process.env.MCP_STDIO = previous
    }
  })
})
