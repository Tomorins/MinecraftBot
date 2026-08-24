import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus.js'
import { VisionController, type FrameSource } from '../src/vision/controller.js'
import type { CameraFrame, MaskRegion, ResidualRegion } from '../src/vision/residual.js'
import { ResidualDetector } from '../src/vision/residual.js'

function frame(timestamp: number): CameraFrame {
  const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  return {
    width: 4,
    height: 4,
    color: new Uint8Array(4 * 4 * 4),
    depth: new Float32Array(4 * 4).fill(1),
    viewProjection: identity,
    inverseViewProjection: identity,
    timestamp
  }
}

describe('VisionController MCP fallback', () => {
  afterEach(() => vi.useRealTimers())

  it('emits an external VLM request instead of calling a Mineflayer LLM', async () => {
    vi.useFakeTimers()
    let captures = 0
    const source: FrameSource = {
      capture: async () => frame(++captures),
      knownChangeMasks: async (): Promise<MaskRegion[]> => [],
      encodeRegion: async () => ({ base64: 'YWJj', mimeType: 'image/png' })
    }
    const detector = {
      detect: (): ResidualRegion[] => [{ x: 0, y: 0, width: 2, height: 2, pixels: 4, meanDifference: 80, maxDifference: 120 }]
    } as unknown as ResidualDetector
    const events = new EventBus()
    const controller = new VisionController(source, detector, events, undefined, 100, true)

    controller.start()
    await vi.advanceTimersByTimeAsync(250)
    controller.stop()

    const request = events.recent(20).find(event => event.type === 'vision_vlm_request')
    expect(request?.data).toMatchObject({ imageBase64: 'YWJj', mimeType: 'image/png' })
  })
})
