# 残差视觉接入

视觉是可选插件，不参与主体 Mineflayer 联机流程。

## FrameSource 输入

可以实现 `src/vision/controller.ts` 中的 `FrameSource`，也可以直接使用内置 `HttpFrameSource`：

```ts
interface FrameSource {
  capture(): Promise<CameraFrame>
  knownChangeMasks(): Promise<MaskRegion[]>
  encodeRegion(frame, region): Promise<{ base64: string; mimeType: string }>
}
```

`CameraFrame` 要求：

- RGBA `Uint8Array`。
- 与图像同尺寸的 `Float32Array` 深度，范围为 `[0,1]` NDC depth。
- row-major 4×4 view-projection 矩阵。
- 对应的 inverse view-projection 矩阵。
- RGB、深度和相机矩阵必须来自同一渲染时刻。

数据可以由支持离屏渲染的客户端或 Fabric 客户端 Mod 通过本地 IPC 提供。Mineflayer 不原生提供这些缓冲。

## HTTP 帧协议

配置：

```env
VISION_ENABLED=true
VISION_FRAME_URL=http://127.0.0.1:3900/frame
VISION_INTERVAL_MS=1000
VLM_ENABLED=true
VLM_MODEL=视觉模型名
```

帧端点返回：

```json
{
  "width": 1280,
  "height": 720,
  "colorBase64": "原始RGBA字节",
  "depthBase64": "little-endian float32 NDC深度",
  "viewProjection": ["16个row-major数字"],
  "inverseViewProjection": ["16个row-major数字"],
  "imageBase64": "用于VLM的PNG或JPEG",
  "mimeType": "image/png",
  "masks": [{"x": 10, "y": 10, "width": 100, "height": 80}],
  "timestamp": 1730000000000
}
```

## 处理链路

```text
上一帧RGB+深度
      ↓ 反投影到世界坐标
当前相机矩阵重投影
      ↓
预测当前帧 + 有效像素掩膜
      ↓
与实际帧比较
      ↓
过滤已知挖掘/放置/UI区域
      ↓
连通区域聚类
      ↓
vision_anomaly事件
      ↓ 大异常才触发
VLM局部分析
```

透明材质、粒子、光照、动画纹理和遮挡解除会产生自然残差。因此 FrameSource 应尽量提供动态材质掩膜，控制器也只把残差视为候选事件，并与协议事件交叉验证。
