/// <reference types="@webgpu/types" />

import type { RenderImage } from './types'

// Maximum images per batch
const MAX_IMAGES_PER_BATCH = 512

// WGSL Vertex Shader
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

// Quad vertices (two triangles)
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
  
  // Calculate pixel position
  let pixelPos = data.destRect.xy + quadPos * wh;
  
  // Convert to clip space (-1 to 1)
  var clipPos = (pixelPos / uniforms.resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  
  output.position = vec4f(clipPos, 0.0, 1.0);
  output.instanceIndex = instanceIndex;
  output.destXY = data.destRect.xy;
  output.texSize = data.texInfo.xy;
  
  return output;
}
`

// WGSL Fragment Shader
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
  
  // Calculate integer texel coordinates
  let texCoord = vec2i(floor(input.fragCoord.xy - input.destXY));
  
  // Bounds check
  let texSizeI = vec2i(input.texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    return vec4f(0.0);
  }
  
  // Load from texture array
  let color = textureLoad(texArray, texCoord, texIndex, 0);
  
  // Premultiplied alpha output
  return vec4f(color.rgb * color.a, color.a);
}
`

/**
 * Check if WebGPU is supported in the current browser.
 */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/**
 * High-performance WebGPU subtitle renderer for JASSUB.
 */
export class WebGPURenderer {
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private pipeline: GPURenderPipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null

  private uniformBuffer: GPUBuffer | null = null
  private imageDataBuffer: GPUBuffer | null = null

  // Texture array for batched rendering
  private textureArray: GPUTexture | null = null
  private textureArrayView: GPUTextureView | null = null
  private textureArraySize = 0
  private textureArrayWidth = 0
  private textureArrayHeight = 0

  private pendingDestroyTextures: GPUTexture[] = []

  // Pre-allocated typed arrays (reused every frame - ZERO allocations in hot path)
  private readonly imageDataArray: Float32Array
  private readonly resolutionArray = new Float32Array(2)

  // Reusable conversion buffer for RGBA->BGRA (grows as needed, never shrinks)
  private conversionBuffer: Uint8Array | null = null
  private conversionBufferSize = 0

  // Bind group (recreated only when texture array changes)
  private bindGroup: GPUBindGroup | null = null
  private bindGroupDirty = true

  // Track canvas size to avoid redundant updates
  private lastCanvasWidth = 0
  private lastCanvasHeight = 0

  format: GPUTextureFormat = 'bgra8unorm'

  private _canvas: HTMLCanvasElement | null = null
  private _initPromise: Promise<void> | null = null
  private _initialized = false

  constructor() {
    // Pre-allocate buffer for max images (8 floats per image: destRect + texInfo)
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

    // Large storage buffer for all image data
    this.imageDataBuffer = this.device.createBuffer({
      size: MAX_IMAGES_PER_BATCH * 8 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    })

    // Create initial texture array with reasonable defaults
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

  // Round up to next power of 2 for GPU-friendly sizes
  private nextPowerOf2(n: number): number {
    n--
    n |= n >> 1
    n |= n >> 2
    n |= n >> 4
    n |= n >> 8
    n |= n >> 16
    return n + 1
  }

  private createTextureArray(width: number, height: number, layers: number): void {
    if (this.textureArray) {
      this.pendingDestroyTextures.push(this.textureArray)
    }

    // Use power-of-2 dimensions for better GPU performance
    const w = this.nextPowerOf2(Math.max(width, 64))
    const h = this.nextPowerOf2(Math.max(height, 64))
    const l = this.nextPowerOf2(Math.max(layers, 16))

    this.textureArray = this.device!.createTexture({
      size: [w, h, l],
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    })
    this.textureArrayView = this.textureArray.createView({ dimension: '2d-array' })
    this.textureArrayWidth = w
    this.textureArrayHeight = h
    this.textureArraySize = l
    this.bindGroupDirty = true
  }

  private ensureTextureArray(maxWidth: number, maxHeight: number, count: number): boolean {
    if (maxWidth <= this.textureArrayWidth && maxHeight <= this.textureArrayHeight && count <= this.textureArraySize) {
      return false
    }

    // Grow with some headroom to avoid frequent resizes
    const newWidth = this.nextPowerOf2(Math.max(this.textureArrayWidth, maxWidth))
    const newHeight = this.nextPowerOf2(Math.max(this.textureArrayHeight, maxHeight))
    const newLayers = this.nextPowerOf2(Math.max(this.textureArraySize, count, count + 16))

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

  private ensureConversionBuffer(size: number): Uint8Array {
    if (this.conversionBufferSize < size) {
      // Grow with 50% headroom to reduce reallocations
      this.conversionBufferSize = Math.max(size, (this.conversionBufferSize * 1.5) | 0, 65536)
      this.conversionBuffer = new Uint8Array(this.conversionBufferSize)
    }
    return this.conversionBuffer!
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

  /**
   * Render ImageBitmaps (async render mode)
   */
  renderBitmaps(
    images: { image: ImageBitmap; x: number; y: number }[],
    _canvasWidth: number,
    _canvasHeight: number
  ): void {
    if (!this.device || !this.context || !this.pipeline) return

    const len = images.length
    if (len === 0) {
      this.clear()
      return
    }

    const currentTexture = this.context.getCurrentTexture()
    if (currentTexture.width === 0 || currentTexture.height === 0) return

    // Single pass: find max dimensions and count valid images
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
      this.clear()
      return
    }

    // Ensure texture array is large enough
    this.ensureTextureArray(maxW, maxH, validCount)
    this.updateBindGroup()

    const device = this.device
    const queue = device.queue
    const textureArray = this.textureArray!
    const imageDataArray = this.imageDataArray

    // Upload all textures and fill image data in single loop
    let texIndex = 0
    for (let i = 0; i < len; i++) {
      const img = images[i]
      const bitmap = img.image
      const w = bitmap.width,
        h = bitmap.height
      if (w <= 0 || h <= 0) continue

      // Copy to texture array layer
      queue.copyExternalImageToTexture(
        { source: bitmap, flipY: false },
        { texture: textureArray, origin: [0, 0, texIndex], premultipliedAlpha: true },
        { width: w, height: h }
      )

      // Fill pre-allocated array directly (no allocation!)
      const offset = texIndex << 3 // * 8
      imageDataArray[offset] = img.x
      imageDataArray[offset + 1] = img.y
      imageDataArray[offset + 2] = w
      imageDataArray[offset + 3] = h
      imageDataArray[offset + 4] = w
      imageDataArray[offset + 5] = h
      imageDataArray[offset + 6] = texIndex
      // imageDataArray[offset + 7] = 0 // Already 0 from init

      texIndex++
    }

    // Single buffer upload for all image data
    queue.writeBuffer(this.imageDataBuffer!, 0, imageDataArray.buffer, 0, texIndex << 5) // * 32

    const commandEncoder = device.createCommandEncoder()
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

    renderPass.setPipeline(this.pipeline)
    renderPass.setBindGroup(0, this.bindGroup!)
    renderPass.draw(6, texIndex) // Single instanced draw!
    renderPass.end()

    queue.submit([commandEncoder.finish()])
    this.cleanupPendingTextures()
  }

  /**
   * Render from raw ArrayBuffer data (non-async render mode)
   */
  render(
    images: RenderImage[],
    _canvasWidth: number,
    _canvasHeight: number,
    _getImageData?: (image: RenderImage) => Uint8ClampedArray | null
  ): void {
    if (!this.device || !this.context || !this.pipeline) return

    const len = images.length
    if (len === 0) {
      this.clear()
      return
    }

    const currentTexture = this.context.getCurrentTexture()
    if (currentTexture.width === 0 || currentTexture.height === 0) return

    // Single pass: find max dimensions and count valid images
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
      this.clear()
      return
    }

    this.ensureTextureArray(maxW, maxH, validCount)
    this.updateBindGroup()

    const device = this.device
    const queue = device.queue
    const textureArray = this.textureArray!
    const imageDataArray = this.imageDataArray
    const isBGRA = this.format === 'bgra8unorm'

    let texIndex = 0
    for (let i = 0; i < len; i++) {
      const img = images[i]
      const w = img.w,
        h = img.h
      if (w <= 0 || h <= 0) continue

      // Upload texture data
      const imgData = img.image
      if (imgData instanceof ImageBitmap) {
        queue.copyExternalImageToTexture(
          { source: imgData, flipY: false },
          { texture: textureArray, origin: [0, 0, texIndex], premultipliedAlpha: true },
          { width: w, height: h }
        )
      } else if (imgData instanceof ArrayBuffer) {
        this.uploadTextureData(texIndex, imgData, w, h, isBGRA)
      }

      // Fill pre-allocated array
      const offset = texIndex << 3
      imageDataArray[offset] = img.x
      imageDataArray[offset + 1] = img.y
      imageDataArray[offset + 2] = w
      imageDataArray[offset + 3] = h
      imageDataArray[offset + 4] = w
      imageDataArray[offset + 5] = h
      imageDataArray[offset + 6] = texIndex

      texIndex++
    }

    queue.writeBuffer(this.imageDataBuffer!, 0, imageDataArray.buffer, 0, texIndex << 5)

    const commandEncoder = device.createCommandEncoder()
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

    renderPass.setPipeline(this.pipeline)
    renderPass.setBindGroup(0, this.bindGroup!)
    renderPass.draw(6, texIndex)
    renderPass.end()

    queue.submit([commandEncoder.finish()])
    this.cleanupPendingTextures()
  }

  private uploadTextureData(
    layerIndex: number,
    rgbaBuffer: ArrayBuffer,
    width: number,
    height: number,
    swapRB: boolean
  ): void {
    const size = width * height * 4

    if (swapRB) {
      // Use reusable conversion buffer
      const uploadData = this.ensureConversionBuffer(size)
      const src = new Uint8Array(rgbaBuffer)

      // Unrolled loop for better performance
      for (let j = 0; j < size; j += 4) {
        uploadData[j] = src[j + 2] // B <- R
        uploadData[j + 1] = src[j + 1] // G
        uploadData[j + 2] = src[j] // R <- B
        uploadData[j + 3] = src[j + 3] // A
      }

      this.device!.queue.writeTexture(
        { texture: this.textureArray!, origin: [0, 0, layerIndex] },
        uploadData.buffer,
        { bytesPerRow: width * 4 },
        { width, height }
      )
    } else {
      this.device!.queue.writeTexture(
        { texture: this.textureArray!, origin: [0, 0, layerIndex] },
        rgbaBuffer,
        { bytesPerRow: width * 4 },
        { width, height }
      )
    }
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

  clear(): void {
    if (!this.device || !this.context) return

    try {
      const currentTexture = this.context.getCurrentTexture()
      if (currentTexture.width === 0 || currentTexture.height === 0) return

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
    } catch {
      // Ignore errors
    }
  }

  get initialized(): boolean {
    return this._initialized
  }

  destroy(): void {
    this.cleanupPendingTextures()

    this.textureArray?.destroy()
    this.textureArray = null
    this.textureArrayView = null

    this.uniformBuffer?.destroy()
    this.imageDataBuffer?.destroy()

    this.bindGroup = null
    this.conversionBuffer = null
    this.conversionBufferSize = 0

    this.device?.destroy()
    this.device = null
    this.context = null
    this._canvas = null
    this._initialized = false
    this._initPromise = null
  }
}
