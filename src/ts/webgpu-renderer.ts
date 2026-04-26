/// <reference types="@webgpu/types" />

import type { RenderImage } from './types'

// Maximum images per batch
const MAX_IMAGES_PER_BATCH = 256

// WebGPU max texture array layers
const MAX_TEXTURE_ARRAY_LAYERS = 256

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
  
  // Calculate texel coordinates
  let texCoordF = floor(input.fragCoord.xy - input.destXY);
  let texCoord = vec2i(texCoordF);
  
  // Bounds check
  let texSizeI = vec2i(input.texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    discard;
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

function toUint8View(data: ArrayBuffer | Uint8Array | Uint8ClampedArray): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

/**
 * High-performance WebGPU subtitle renderer for AkariSub.
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

  private hbGpuShaders: {
    wgsl: {
      vertex: string
      fragment: string
      drawFragment: string
      paintFragment: string
    }
  } | null = null
  private hbPipeline: GPURenderPipeline | null = null
  private hbBindGroupLayout: GPUBindGroupLayout | null = null
  private hbBindGroup: GPUBindGroup | null = null
  private hbVertexBuffer: GPUBuffer | null = null
  private hbAtlasBuffer: GPUBuffer | null = null
  private hbVertexCapacity = 0
  private hbAtlasCapacity = 0


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
    // Clamp layers to WebGPU max (256)
    const l = Math.min(this.nextPowerOf2(Math.max(layers, 16)), MAX_TEXTURE_ARRAY_LAYERS)

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

    // Clear all texture layers to transparent to prevent garbage border artifacts
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
    // Clamp count to max layers
    const clampedCount = Math.min(count, MAX_TEXTURE_ARRAY_LAYERS)

    if (
      maxWidth <= this.textureArrayWidth &&
      maxHeight <= this.textureArrayHeight &&
      clampedCount <= this.textureArraySize
    ) {
      return false
    }

    // Grow with some headroom to avoid frequent resizes, but cap at max layers
    const newWidth = this.nextPowerOf2(Math.max(this.textureArrayWidth, maxWidth))
    const newHeight = this.nextPowerOf2(Math.max(this.textureArrayHeight, maxHeight))
    const newLayers = Math.min(
      this.nextPowerOf2(Math.max(this.textureArraySize, clampedCount, clampedCount + 16)),
      MAX_TEXTURE_ARRAY_LAYERS
    )

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
   * Handles batching when image count exceeds MAX_TEXTURE_ARRAY_LAYERS
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

    // Ensure texture array is large enough (capped at MAX_TEXTURE_ARRAY_LAYERS)
    const batchSize = Math.min(validCount, MAX_TEXTURE_ARRAY_LAYERS)
    this.ensureTextureArray(maxW, maxH, batchSize)
    this.updateBindGroup()

    const device = this.device
    const queue = device.queue
    const textureArray = this.textureArray!
    const imageDataArray = this.imageDataArray
    const textureView = currentTexture.createView()

    // Process images in batches if needed
    let imageIndex = 0
    let isFirstBatch = true

    while (imageIndex < len) {
      let texIndex = 0

      // Upload batch of textures
      while (imageIndex < len && texIndex < MAX_TEXTURE_ARRAY_LAYERS) {
        const img = images[imageIndex++]
        const bitmap = img.image
        const w = bitmap.width,
          h = bitmap.height
        if (w <= 0 || h <= 0) continue

        // Copy to texture array layer
        queue.copyExternalImageToTexture(
          { source: bitmap, flipY: false },
          { texture: textureArray, origin: [0, 0, texIndex], premultipliedAlpha: false },
          { width: w, height: h }
        )

        // Fill pre-allocated array
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

      // Upload buffer and draw batch
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
    }

    this.cleanupPendingTextures()
  }

  /**
   * Render from raw ArrayBuffer data (non-async render mode)
   * Handles batching when image count exceeds MAX_TEXTURE_ARRAY_LAYERS
   */
  render(
    images: RenderImage[],
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

    // Ensure texture array is large enough (capped at MAX_TEXTURE_ARRAY_LAYERS)
    const batchSize = Math.min(validCount, MAX_TEXTURE_ARRAY_LAYERS)
    this.ensureTextureArray(maxW, maxH, batchSize)
    this.updateBindGroup()

    const device = this.device
    const queue = device.queue
    const textureArray = this.textureArray!
    const imageDataArray = this.imageDataArray
    const isBGRA = this.format === 'bgra8unorm'
    const textureView = currentTexture.createView()

    // Process images in batches if needed
    let imageIndex = 0
    let isFirstBatch = true

    while (imageIndex < len) {
      let texIndex = 0

      // Upload batch of textures
      while (imageIndex < len && texIndex < MAX_TEXTURE_ARRAY_LAYERS) {
        const img = images[imageIndex++]
        const w = img.w,
          h = img.h
        if (w <= 0 || h <= 0) continue

        // Upload texture data
        const imgData = img.image
        if (imgData instanceof ImageBitmap) {
          queue.copyExternalImageToTexture(
            { source: imgData, flipY: false },
            { texture: textureArray, origin: [0, 0, texIndex], premultipliedAlpha: false },
            { width: w, height: h }
          )
        } else if (imgData instanceof ArrayBuffer || imgData instanceof Uint8Array || imgData instanceof Uint8ClampedArray) {
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
        imageDataArray[offset + 7] = 0

        texIndex++
      }

      if (texIndex === 0) continue

      // Upload buffer and draw batch
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
    }

    this.cleanupPendingTextures()
  }

  private uploadTextureData(
    layerIndex: number,
    rgbaBuffer: ArrayBuffer | Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    swapRB: boolean
  ): void {
    const size = width * height * 4
    const src = toUint8View(rgbaBuffer)

    if (swapRB) {
      // Use reusable conversion buffer
      const uploadData = this.ensureConversionBuffer(size)

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
        src,
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
    this.uniformBuffer = null
    this.imageDataBuffer?.destroy()
    this.imageDataBuffer = null

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

  setHbGpuShaders(shaders: {
    wgsl: { vertex: string; fragment: string; drawFragment: string; paintFragment: string }
  }): void {
    this.hbGpuShaders = shaders
    this.hbPipeline = null
    this.hbBindGroup = null
  }

  private ensureHbPipeline(): void {
    if (!this.device || this.hbPipeline) return
    if (!this.hbGpuShaders) return

    const vertexCode = `${this.hbGpuShaders.wgsl.vertex}
struct Uniforms { resolution: vec2f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexIn {
  @location(0) position: vec2f,
  @location(1) renderCoord: vec2f,
  @location(2) glyphLoc: f32,
  @location(3) color: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) renderCoord: vec2f,
  @location(1) glyphLoc: f32,
  @location(2) color: vec4f,
}

@vertex
fn vsMain(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  var clip = (input.position / uniforms.resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  out.position = vec4f(clip, 0.0, 1.0);
  out.renderCoord = input.renderCoord;
  out.glyphLoc = input.glyphLoc;
  out.color = input.color;
  return out;
}`

    const fragmentCode = `${this.hbGpuShaders.wgsl.fragment}
${this.hbGpuShaders.wgsl.drawFragment}
@group(0) @binding(1) var<storage, read> hb_gpu_atlas: array<vec4<i32>>;

struct FragIn {
  @location(0) renderCoord: vec2f,
  @location(1) glyphLoc: f32,
  @location(2) color: vec4f,
}

@fragment
fn fsMain(input: FragIn) -> @location(0) vec4f {
  let cov = hb_gpu_draw(input.renderCoord, u32(max(input.glyphLoc, 0.0)), &hb_gpu_atlas);
  return vec4f(input.color.rgb * cov, input.color.a * cov);
}`

    const vertexModule = this.device.createShaderModule({ code: vertexCode })
    const fragmentModule = this.device.createShaderModule({ code: fragmentCode })

    this.hbBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }
      ]
    })

    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.hbBindGroupLayout] })

    this.hbPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: vertexModule,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 36,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
              { shaderLocation: 2, offset: 16, format: 'float32' },
              { shaderLocation: 3, offset: 20, format: 'float32x4' }
            ]
          }
        ]
      },
      fragment: {
        module: fragmentModule,
        entryPoint: 'fsMain',
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
  }

  renderHbGpuBlobs(glyphData: ArrayBuffer, atlasData: ArrayBuffer, width: number, height: number): void {
    if (!this.device || !this.context) return
    if (!glyphData.byteLength || !atlasData.byteLength) {
      this.clear()
      return
    }

    this.updateSize(width, height)
    this.ensureHbPipeline()
    if (!this.hbPipeline || !this.hbBindGroupLayout) return

    const meta = new Int32Array(glyphData)
    const glyphCount = (meta.length / 12) | 0
    if (glyphCount <= 0) {
      this.clear()
      return
    }

    const raw16 = new Int16Array(atlasData)
    const atlasI32 = new Int32Array(raw16.length)
    for (let i = 0; i < raw16.length; i++) atlasI32[i] = raw16[i]

    const vertexData = new Float32Array(glyphCount * 6 * 9)
    let vertexOffset = 0

    const bitsToFloat = (bits: number): number => {
      const v = new DataView(new ArrayBuffer(4))
      v.setInt32(0, bits, true)
      return v.getFloat32(0, true)
    }

    const decodeColor = (packed: number): [number, number, number, number] => {
      const r = ((packed >>> 24) & 0xff) / 255
      const g = ((packed >>> 16) & 0xff) / 255
      const b = ((packed >>> 8) & 0xff) / 255
      const a = (255 - (packed & 0xff)) / 255
      return [r, g, b, a]
    }

    const pushVertex = (
      px: number,
      py: number,
      tx: number,
      ty: number,
      glyphLoc: number,
      color: [number, number, number, number]
    ): void => {
      vertexData[vertexOffset++] = px
      vertexData[vertexOffset++] = py
      vertexData[vertexOffset++] = tx
      vertexData[vertexOffset++] = ty
      vertexData[vertexOffset++] = glyphLoc
      vertexData[vertexOffset++] = color[0]
      vertexData[vertexOffset++] = color[1]
      vertexData[vertexOffset++] = color[2]
      vertexData[vertexOffset++] = color[3]
    }

    // libass callback pen positions are in integer screen pixels, while
    // HarfBuzz hb-gpu extents are 26.6 fixed-point.
    const emToPx = 1 / 64

    for (let i = 0; i < glyphCount; i++) {
      const o = i * 12
      const atlasOffsetBytes = meta[o]
      const penX = bitsToFloat(meta[o + 2])
      const penY = bitsToFloat(meta[o + 3])
      const extMinX = meta[o + 4]
      const extMaxX = meta[o + 5]
      const extMinY = meta[o + 6]
      const extMaxY = meta[o + 7]
      const glyphLoc = atlasOffsetBytes / 8
      const color = decodeColor(meta[o + 9])

      const x0 = penX + extMinX * emToPx
      const y0 = penY - extMinY * emToPx
      const x1 = penX + extMaxX * emToPx
      const y1 = penY - extMaxY * emToPx

      pushVertex(x0, y0, extMinX, extMinY, glyphLoc, color)
      pushVertex(x1, y0, extMaxX, extMinY, glyphLoc, color)
      pushVertex(x0, y1, extMinX, extMaxY, glyphLoc, color)
      pushVertex(x1, y0, extMaxX, extMinY, glyphLoc, color)
      pushVertex(x1, y1, extMaxX, extMaxY, glyphLoc, color)
      pushVertex(x0, y1, extMinX, extMaxY, glyphLoc, color)
    }

    const vertexByteLen = vertexData.byteLength
    if (!this.hbVertexBuffer || this.hbVertexCapacity < vertexByteLen) {
      this.hbVertexBuffer?.destroy()
      this.hbVertexCapacity = Math.max(vertexByteLen, this.hbVertexCapacity * 2, 4096)
      this.hbVertexBuffer = this.device.createBuffer({
        size: this.hbVertexCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      })
    }

    const atlasByteLen = atlasI32.byteLength
    if (!this.hbAtlasBuffer || this.hbAtlasCapacity < atlasByteLen) {
      this.hbAtlasBuffer?.destroy()
      this.hbAtlasCapacity = Math.max(atlasByteLen, this.hbAtlasCapacity * 2, 4096)
      this.hbAtlasBuffer = this.device.createBuffer({
        size: this.hbAtlasCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      })
      this.hbBindGroup = null
    }

    this.device.queue.writeBuffer(this.hbVertexBuffer, 0, vertexData)
    this.device.queue.writeBuffer(this.hbAtlasBuffer, 0, atlasI32)

    if (!this.hbBindGroup) {
      this.hbBindGroup = this.device.createBindGroup({
        layout: this.hbBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
          { binding: 1, resource: { buffer: this.hbAtlasBuffer } }
        ]
      })
    }

    const currentTexture = this.context.getCurrentTexture()
    const commandEncoder = this.device.createCommandEncoder()
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: currentTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    })

    pass.setPipeline(this.hbPipeline)
    pass.setBindGroup(0, this.hbBindGroup)
    pass.setVertexBuffer(0, this.hbVertexBuffer)
    pass.draw(glyphCount * 6, 1, 0, 0)
    pass.end()

    this.device.queue.submit([commandEncoder.finish()])
  }
}
