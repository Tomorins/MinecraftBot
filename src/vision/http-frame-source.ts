import type { CameraFrame, MaskRegion, ResidualRegion } from './residual.js'
import type { FrameSource } from './controller.js'

interface FramePayload {
  width: number
  height: number
  colorBase64: string
  depthBase64: string
  viewProjection: number[]
  inverseViewProjection: number[]
  imageBase64: string
  mimeType: string
  masks?: MaskRegion[]
  timestamp?: number
}

const MAX_ENCODED_IMAGE_CHARS = 14_000_000

/** Pulls synchronized RGB, depth and camera data from a renderer or client-Mod bridge. */
export class HttpFrameSource implements FrameSource {
  private masks: MaskRegion[] = []
  private encoded: { base64: string; mimeType: string } | undefined

  constructor(private readonly url: string, private readonly timeoutMs = 5000) {}

  async capture(): Promise<CameraFrame> {
    const response = await fetch(this.url, { signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw new Error(`Frame source HTTP ${response.status}`)
    const payload = await response.json() as FramePayload
    this.validate(payload)
    const colorBuffer = Buffer.from(payload.colorBase64, 'base64')
    const depthBuffer = Buffer.from(payload.depthBase64, 'base64')
    const pixelCount = payload.width * payload.height
    if (colorBuffer.byteLength !== pixelCount * 4) throw new Error('Frame color byte length does not match dimensions')
    if (depthBuffer.byteLength !== pixelCount * 4) throw new Error('Frame depth byte length does not match dimensions')
    const view = new DataView(depthBuffer.buffer, depthBuffer.byteOffset, depthBuffer.byteLength)
    const depth = new Float32Array(pixelCount)
    for (let index = 0; index < pixelCount; index += 1) depth[index] = view.getFloat32(index * 4, true)
    this.masks = payload.masks ?? []
    this.encoded = { base64: payload.imageBase64, mimeType: payload.mimeType }
    return {
      width: payload.width,
      height: payload.height,
      color: new Uint8Array(colorBuffer),
      depth,
      viewProjection: new Float64Array(payload.viewProjection),
      inverseViewProjection: new Float64Array(payload.inverseViewProjection),
      timestamp: payload.timestamp ?? Date.now()
    }
  }

  knownChangeMasks(): Promise<MaskRegion[]> {
    return Promise.resolve([...this.masks])
  }

  encodeRegion(_frame: CameraFrame, _region: ResidualRegion): Promise<{ base64: string; mimeType: string }> {
    if (!this.encoded) return Promise.reject(new Error('No encoded frame is available'))
    return Promise.resolve(this.encoded)
  }

  private validate(payload: FramePayload): void {
    if (!Number.isInteger(payload.width) || payload.width <= 0 || !Number.isInteger(payload.height) || payload.height <= 0) throw new Error('Invalid frame dimensions')
    if (payload.viewProjection.length !== 16 || payload.inverseViewProjection.length !== 16) throw new Error('Camera matrices must contain 16 numbers')
    if (!payload.colorBase64 || !payload.depthBase64 || !payload.imageBase64 || !payload.mimeType) throw new Error('Incomplete frame payload')
    if (payload.imageBase64.length > MAX_ENCODED_IMAGE_CHARS) throw new Error('Encoded frame exceeds the 10 MB image limit')
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(payload.mimeType.toLowerCase())) throw new Error('Unsupported encoded frame MIME type')
  }
}
