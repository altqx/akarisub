/// <reference types="@webgpu/types" />

import type { RenderImage } from './types'

const MAX_IMAGES_PER_BATCH = 256

const MAX_TEXTURE_ARRAY_LAYERS = 256

const VERTEX_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) instanceIndex: u32,
  @location(1) @interpolate(flat) destXY: vec2f,
  @location(2) @interpolate(flat) texSize: vec2f,
}

struct Uniforms {
  resolution: vec2f,
}

struct ImageData {
  destRect: vec4f,   // x, y, w, h
  texInfo: vec4f,    // texW, texH, texIndex, 0
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> imageData: array<ImageData>;

const QUAD_POSITIONS = array<vec2f, 6>(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 0.0),
  vec2f(1.0, 1.0),
  vec2f(0.0, 1.0)
);

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;
  
  let data = imageData[instanceIndex];
  let quadPos = QUAD_POSITIONS[vertexIndex];
  let wh = data.destRect.zw;
  
  let pixelPos = data.destRect.xy + quadPos * wh;
  
  var clipPos = (pixelPos / uniforms.resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  
  output.position = vec4f(clipPos, 0.0, 1.0);
  output.instanceIndex = instanceIndex;
  output.destXY = data.destRect.xy;
  output.texSize = data.texInfo.xy;
  
  return output;
}
`

const FRAGMENT_SHADER = /* wgsl */ `
@group(0) @binding(2) var texArray: texture_2d_array<f32>;

struct ImageData {
  destRect: vec4f,
  texInfo: vec4f,
}

@group(0) @binding(1) var<storage, read> imageData: array<ImageData>;

struct FragmentInput {
  @builtin(position) fragCoord: vec4f,
  @location(0) @interpolate(flat) instanceIndex: u32,
  @location(1) @interpolate(flat) destXY: vec2f,
  @location(2) @interpolate(flat) texSize: vec2f,
}

@fragment
fn fragmentMain(input: FragmentInput) -> @location(0) vec4f {
  let data = imageData[input.instanceIndex];
  let texIndex = u32(data.texInfo.z);
  
  let texCoordF = floor(input.fragCoord.xy - input.destXY);
  let texCoord = vec2i(texCoordF);
  
  let texSizeI = vec2i(input.texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    discard;
  }
  
  let color = textureLoad(texArray, texCoord, texIndex, 0);
  
  return vec4f(color.rgb * color.a, color.a);
}
`

export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

function toUint8View(data: ArrayBuffer | Uint8Array | Uint8ClampedArray): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export class WebGPURenderer {
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private stageContexts = new Map<HTMLCanvasElement, GPUCanvasContext>()
  private pipeline: GPURenderPipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null

  private uniformBuffer: GPUBuffer | null = null
  private imageDataBuffer: GPUBuffer | null = null

  private textureArray: GPUTexture | null = null
  private textureArrayView: GPUTextureView | null = null
  private textureArraySize = 0
  private textureArrayWidth = 0
  private textureArrayHeight = 0

  private pendingDestroyTextures: GPUTexture[] = []
  private externalUploadCanvas: OffscreenCanvas | HTMLCanvasElement | null = null
  private externalUploadContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
  private warnedExternalUploadFallback = false

  private readonly imageDataArray: Float32Array
  private readonly resolutionArray = new Float32Array(2)

  private bindGroup: GPUBindGroup | null = null
  private bindGroupDirty = true

  private lastCanvasWidth = 0
  private lastCanvasHeight = 0

  format: GPUTextureFormat = 'bgra8unorm'

  private _canvas: HTMLCanvasElement | null = null
  private _initPromise: Promise<void> | null = null
  private _initialized = false

  constructor() {
    this.imageDataArray = new Float32Array(MAX_IMAGES_PER_BATCH * 8)
  }

  async init(): Promise<void> {
    if (this._initPromise) return this._initPromise
    this._initPromise = this._initDevice()
    return this._initPromise
  }

  private async _initDevice(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported')
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    })

    if (!adapter) {
      throw new Error('No WebGPU adapter found')
    }

    this.device = await adapter.requestDevice()
    this.format = navigator.gpu.getPreferredCanvasFormat()

    const vertexModule = this.device.createShaderModule({ code: VERTEX_SHADER })
    const fragmentModule = this.device.createShaderModule({ code: FRAGMENT_SHADER })

    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })

    this.imageDataBuffer = this.device.createBuffer({
      size: MAX_IMAGES_PER_BATCH * 8 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    })

    this.createTextureArray(256, 256, 32)

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' }
        }
      ]
    })

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout]
    })

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: vertexModule, entryPoint: 'vertexMain' },
      fragment: {
        module: fragmentModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-list' }
    })

    this._initialized = true
  }

  // Round up to a multiple of 64: gives headroom against size jitter without
  // power-of-2 over-allocation (a 1920x1080 blend region would otherwise
  // round to 2048x2048 and waste ~2x memory).
  private roundDim(n: number): number {
    return (Math.max(n, 64) + 63) & ~63
  }

  private roundLayers(n: number): number {
    return Math.min((Math.max(n, 8) + 7) & ~7, MAX_TEXTURE_ARRAY_LAYERS)
  }

  private createTextureArray(width: number, height: number, layers: number): void {
    if (this.textureArray) {
      this.pendingDestroyTextures.push(this.textureArray)
    }

    const w = this.roundDim(width)
    const h = this.roundDim(height)
    const l = this.roundLayers(layers)

    this.textureArray = this.device!.createTexture({
      size: [w, h, l],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    })
    this.textureArrayView = this.textureArray.createView({ dimension: '2d-array' })
    this.textureArrayWidth = w
    this.textureArrayHeight = h
    this.textureArraySize = l
    this.bindGroupDirty = true

    const commandEncoder = this.device!.createCommandEncoder()
    for (let layer = 0; layer < l; layer++) {
      const layerView = this.textureArray.createView({
        dimension: '2d',
        baseArrayLayer: layer,
        arrayLayerCount: 1
      })
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: layerView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      })
      renderPass.end()
    }
    this.device!.queue.submit([commandEncoder.finish()])
  }

  private ensureTextureArray(maxWidth: number, maxHeight: number, count: number): boolean {
    const clampedCount = Math.min(count, MAX_TEXTURE_ARRAY_LAYERS)

    if (
      maxWidth <= this.textureArrayWidth &&
      maxHeight <= this.textureArrayHeight &&
      clampedCount <= this.textureArraySize
    ) {
      return false
    }

    const newWidth = Math.max(this.textureArrayWidth, maxWidth)
    const newHeight = Math.max(this.textureArrayHeight, maxHeight)
    const newLayers = Math.max(clampedCount, Math.min(this.textureArraySize, 16))

    this.createTextureArray(newWidth, newHeight, newLayers)
    return true
  }

  private updateBindGroup(): void {
    if (!this.bindGroupDirty || !this.device || !this.bindGroupLayout) return

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: this.imageDataBuffer! } },
        { binding: 2, resource: this.textureArrayView! }
      ]
    })
    this.bindGroupDirty = false
  }

  async setCanvas(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.init()

    if (!this.device) throw new Error('WebGPU device not initialized')
    if (width <= 0 || height <= 0) return

    this._canvas = canvas
    canvas.width = width
    canvas.height = height

    if (!this.context) {
      this.context = canvas.getContext('webgpu')
      if (!this.context) throw new Error('Could not get WebGPU context')

      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied'
      })
    }

    this.resolutionArray[0] = width
    this.resolutionArray[1] = height
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.resolutionArray)

    this.lastCanvasWidth = width
    this.lastCanvasHeight = height
  }

  /**
   * Render a prepared full-frame subtitle snapshot into its own WebGPU canvas.
   * Keeping prepared frames on the selected backend avoids switching to a 2D
   * compositor during playback (and lets Chromium keep one GPU overlay stack).
   */
  renderBitmapToCanvas(canvas: HTMLCanvasElement, bitmap: ImageBitmap, width: number, height: number): boolean {
    if (!this.device || !this.pipeline || width <= 0 || height <= 0) return false

    canvas.width = width
    canvas.height = height
    let context: GPUCanvasContext | null | undefined = this.stageContexts.get(canvas)
    if (!context) {
      context = canvas.getContext('webgpu')
      if (!context) return false
      context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied'
      })
      this.stageContexts.set(canvas, context)
    }

    return this.renderBitmapsToContext([{ image: bitmap, x: 0, y: 0 }], context, width, height)
  }

  releaseCanvas(canvas: HTMLCanvasElement): void {
    const context = this.stageContexts.get(canvas)
    if (!context) return
    try {
      context.unconfigure()
    } catch {
      // Device loss can invalidate a context before DOM-stage cleanup.
    }
    this.stageContexts.delete(canvas)
  }

  updateSize(width: number, height: number): void {
    if (!this.device || !this._canvas || width <= 0 || height <= 0) return
    if (width === this.lastCanvasWidth && height === this.lastCanvasHeight) return

    this._canvas.width = width
    this._canvas.height = height
    this.resolutionArray[0] = width
    this.resolutionArray[1] = height
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.resolutionArray)

    this.lastCanvasWidth = width
    this.lastCanvasHeight = height
  }

  renderBitmaps(
    images: { image: ImageBitmap; x: number; y: number }[],
    canvasWidth: number,
    canvasHeight: number
  ): boolean {
    if (!this.context) return false
    return this.renderBitmapsToContext(images, this.context, canvasWidth, canvasHeight)
  }

  submittedWorkDone(): Promise<void> {
    return this.device?.queue.onSubmittedWorkDone() ?? Promise.resolve()
  }

  private renderBitmapsToContext(
    images: { image: ImageBitmap; x: number; y: number }[],
    context: GPUCanvasContext,
    canvasWidth: number,
    canvasHeight: number
  ): boolean {
    if (!this.device || !this.pipeline || canvasWidth <= 0 || canvasHeight <= 0) return false

    this.resolutionArray[0] = canvasWidth
    this.resolutionArray[1] = canvasHeight
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.resolutionArray)

    const len = images.length
    if (len === 0) {
      return this.clearContext(context)
    }

    const currentTexture = context.getCurrentTexture()
    if (currentTexture.width === 0 || currentTexture.height === 0) return false

    let maxW = 0,
      maxH = 0,
      validCount = 0
    for (let i = 0; i < len; i++) {
      const { image } = images[i]
      const w = image.width,
        h = image.height
      if (w > 0 && h > 0) {
        if (w > maxW) maxW = w
        if (h > maxH) maxH = h
        validCount++
      }
    }

    if (validCount === 0) {
      return this.clearContext(context)
    }

    const batchSize = Math.min(validCount, MAX_TEXTURE_ARRAY_LAYERS)
    this.ensureTextureArray(maxW, maxH, batchSize)
    this.updateBindGroup()

    const device = this.device
    const queue = device.queue
    const textureArray = this.textureArray!
    const imageDataArray = this.imageDataArray
    const textureView = currentTexture.createView()

    let imageIndex = 0
    let isFirstBatch = true
    let renderedAnyBatch = false

    while (imageIndex < len) {
      let texIndex = 0

      while (imageIndex < len && texIndex < MAX_TEXTURE_ARRAY_LAYERS) {
        const img = images[imageIndex++]
        const bitmap = img.image
        const w = bitmap.width,
          h = bitmap.height
        if (w <= 0 || h <= 0) continue

        if (!this.uploadImageBitmap(texIndex, bitmap, w, h)) continue

        const offset = texIndex << 3
        imageDataArray[offset] = img.x
        imageDataArray[offset + 1] = img.y
        imageDataArray[offset + 2] = w
        imageDataArray[offset + 3] = h
        imageDataArray[offset + 4] = w
        imageDataArray[offset + 5] = h
        imageDataArray[offset + 6] = texIndex
        imageDataArray[offset + 7] = 0

        texIndex++
      }

      if (texIndex === 0) continue

      queue.writeBuffer(this.imageDataBuffer!, 0, imageDataArray.buffer, 0, texIndex << 5)

      const commandEncoder = device.createCommandEncoder()
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: isFirstBatch ? 'clear' : 'load',
            storeOp: 'store'
          }
        ]
      })

      renderPass.setPipeline(this.pipeline)
      renderPass.setBindGroup(0, this.bindGroup!)
      renderPass.draw(6, texIndex)
      renderPass.end()

      queue.submit([commandEncoder.finish()])
      isFirstBatch = false
      renderedAnyBatch = true
    }

    if (!renderedAnyBatch) this.clearContext(context)
    this.cleanupPendingTextures()
    return renderedAnyBatch
  }

  render(images: RenderImage[], _canvasWidth: number, _canvasHeight: number): boolean {
    if (!this.device || !this.context || !this.pipeline) return false

    this.resolutionArray[0] = _canvasWidth
    this.resolutionArray[1] = _canvasHeight
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.resolutionArray)

    const len = images.length
    if (len === 0) {
      return this.clear()
    }

    const currentTexture = this.context.getCurrentTexture()
    if (currentTexture.width === 0 || currentTexture.height === 0) return false

    let maxW = 0,
      maxH = 0,
      validCount = 0
    for (let i = 0; i < len; i++) {
      const { w, h } = images[i]
      if (w > 0 && h > 0) {
        if (w > maxW) maxW = w
        if (h > maxH) maxH = h
        validCount++
      }
    }

    if (validCount === 0) {
      return this.clear()
    }

    const batchSize = Math.min(validCount, MAX_TEXTURE_ARRAY_LAYERS)
    this.ensureTextureArray(maxW, maxH, batchSize)
    this.updateBindGroup()

    const device = this.device
    const queue = device.queue
    const textureArray = this.textureArray!
    const imageDataArray = this.imageDataArray
    const textureView = currentTexture.createView()

    let imageIndex = 0
    let isFirstBatch = true
    let renderedAnyBatch = false

    while (imageIndex < len) {
      let texIndex = 0

      while (imageIndex < len && texIndex < MAX_TEXTURE_ARRAY_LAYERS) {
        const img = images[imageIndex++]
        const w = img.w,
          h = img.h
        if (w <= 0 || h <= 0) continue

        const imgData = img.image
        if (imgData instanceof ImageBitmap) {
          if (!this.uploadImageBitmap(texIndex, imgData, w, h)) continue
        } else if (
          imgData instanceof ArrayBuffer ||
          imgData instanceof Uint8Array ||
          imgData instanceof Uint8ClampedArray
        ) {
          this.uploadTextureData(texIndex, imgData, w, h)
        } else {
          continue
        }

        const offset = texIndex << 3
        imageDataArray[offset] = img.x
        imageDataArray[offset + 1] = img.y
        imageDataArray[offset + 2] = w
        imageDataArray[offset + 3] = h
        imageDataArray[offset + 4] = w
        imageDataArray[offset + 5] = h
        imageDataArray[offset + 6] = texIndex
        imageDataArray[offset + 7] = 0

        texIndex++
      }

      if (texIndex === 0) continue

      queue.writeBuffer(this.imageDataBuffer!, 0, imageDataArray.buffer, 0, texIndex << 5)

      const commandEncoder = device.createCommandEncoder()
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: isFirstBatch ? 'clear' : 'load',
            storeOp: 'store'
          }
        ]
      })

      renderPass.setPipeline(this.pipeline)
      renderPass.setBindGroup(0, this.bindGroup!)
      renderPass.draw(6, texIndex)
      renderPass.end()

      queue.submit([commandEncoder.finish()])
      isFirstBatch = false
      renderedAnyBatch = true
    }

    if (!renderedAnyBatch) this.clear()
    this.cleanupPendingTextures()
    return renderedAnyBatch
  }

  private uploadImageBitmap(layerIndex: number, bitmap: ImageBitmap, width: number, height: number): boolean {
    try {
      this.device!.queue.copyExternalImageToTexture(
        { source: bitmap, flipY: false },
        { texture: this.textureArray!, origin: [0, 0, layerIndex], premultipliedAlpha: false },
        { width, height }
      )
      return true
    } catch (externalUploadError) {
      try {
        let canvas = this.externalUploadCanvas
        if (!canvas) {
          canvas =
            typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(width, height)
              : document.createElement('canvas')
          this.externalUploadCanvas = canvas
        }
        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height

        let context = this.externalUploadContext
        if (!context) {
          context = canvas.getContext('2d', { alpha: true, willReadFrequently: true }) as
            | OffscreenCanvasRenderingContext2D
            | CanvasRenderingContext2D
            | null
          this.externalUploadContext = context
        }
        if (!context) return false

        context.clearRect(0, 0, width, height)
        context.drawImage(bitmap, 0, 0)
        this.uploadTextureData(layerIndex, context.getImageData(0, 0, width, height).data, width, height)

        if (!this.warnedExternalUploadFallback) {
          this.warnedExternalUploadFallback = true
          console.warn('[AkariSub] WebGPU external-image upload failed; using RGBA fallback.', externalUploadError)
        }
        return true
      } catch (fallbackError) {
        console.warn('[AkariSub] Failed to upload subtitle bitmap to WebGPU.', fallbackError)
        return false
      }
    }
  }

  private uploadTextureData(
    layerIndex: number,
    rgbaBuffer: ArrayBuffer | Uint8Array | Uint8ClampedArray,
    width: number,
    height: number
  ): void {
    this.device!.queue.writeTexture(
      { texture: this.textureArray!, origin: [0, 0, layerIndex] },
      toUint8View(rgbaBuffer),
      { bytesPerRow: width * 4 },
      { width, height }
    )
  }

  private cleanupPendingTextures(): void {
    const pending = this.pendingDestroyTextures
    const len = pending.length
    if (len === 0) return

    for (let i = 0; i < len; i++) {
      pending[i].destroy()
    }
    pending.length = 0
  }

  clear(): boolean {
    if (!this.device || !this.context) return false

    return this.clearContext(this.context)
  }

  private clearContext(context: GPUCanvasContext): boolean {
    if (!this.device) return false

    try {
      const currentTexture = context.getCurrentTexture()
      if (currentTexture.width === 0 || currentTexture.height === 0) return false

      const commandEncoder = this.device.createCommandEncoder()
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: currentTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      })
      renderPass.end()
      this.device.queue.submit([commandEncoder.finish()])
      return true
    } catch {
      return false
    }
  }

  get initialized(): boolean {
    return this._initialized
  }

  destroy(): void {
    this.cleanupPendingTextures()

    for (const context of this.stageContexts.values()) {
      try {
        context.unconfigure()
      } catch {
        // Context can already be invalid after device loss.
      }
    }
    this.stageContexts.clear()

    this.textureArray?.destroy()
    this.textureArray = null
    this.textureArrayView = null

    this.uniformBuffer?.destroy()
    this.uniformBuffer = null
    this.imageDataBuffer?.destroy()
    this.imageDataBuffer = null

    this.bindGroup = null

    this.device?.destroy()
    this.device = null
    this.context = null
    this._canvas = null
    this.externalUploadCanvas = null
    this.externalUploadContext = null
    this.warnedExternalUploadFallback = false
    this._initialized = false
    this._initPromise = null
  }
}
