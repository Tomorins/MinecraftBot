import type { LLMProvider } from '../llm/provider.js'
import { EventBus } from '../core/event-bus.js'
import { GeometricFramePredictor, ResidualDetector, type CameraFrame, type MaskRegion, type ResidualRegion } from './residual.js'
import { logger } from '../logger.js'

export interface FrameSource {
  capture(): Promise<CameraFrame>
  knownChangeMasks(): Promise<MaskRegion[]>
  encodeRegion(frame: CameraFrame, region: ResidualRegion): Promise<{ base64: string; mimeType: string }>
}

export class VisionController {
  private previous: CameraFrame | undefined
  private interval: NodeJS.Timeout | undefined
  private processing = false
  private readonly predictor = new GeometricFramePredictor()

  constructor(
    private readonly source: FrameSource,
    private readonly detector: ResidualDetector,
    private readonly events: EventBus,
    private readonly llm?: LLMProvider,
    private readonly intervalMs = 1000,
    private readonly requestExternalVlm = false
  ) {}

  start(): void {
    this.interval = setInterval(() => { void this.tick() }, this.intervalMs)
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = undefined
  }

  private async tick(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      const current = await this.source.capture()
      if (!this.previous || this.previous.width !== current.width || this.previous.height !== current.height) {
        this.previous = current
        return
      }
      const predicted = this.predictor.predict(this.previous, current.viewProjection)
      const masks = await this.source.knownChangeMasks()
      const regions = this.detector.detect(current, predicted, masks)
      if (regions.length > 0) {
        const event = this.events.emit('vision_anomaly', { regions, timestamp: current.timestamp }, 'high')
        const largest = regions[0]
        if (largest && largest.pixels > current.width * current.height * 0.002) {
          const encoded = await this.source.encodeRegion(current, largest)
          const prompt = '这个区域与相机运动预测不一致。识别意外对象、危险或环境变化。'
          if (this.llm?.analyzeImage) {
            const analysis = await this.llm.analyzeImage(prompt, encoded.base64, encoded.mimeType)
            this.events.emit('vision_anomaly', { parentEventId: event.id, region: largest, analysis }, 'high')
          } else if (this.requestExternalVlm) {
            this.events.emit('vision_vlm_request', {
              parentEventId: event.id,
              region: largest,
              prompt,
              imageBase64: encoded.base64,
              mimeType: encoded.mimeType
            }, 'high')
          }
        }
      }
      this.previous = current
    } catch (error) {
      logger.warn({ error }, 'vision tick failed')
    } finally {
      this.processing = false
    }
  }
}
