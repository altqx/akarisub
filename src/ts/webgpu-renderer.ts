/// <reference types="@webgpu/types" />

type RenderImageInput = {
  x: number
  y: number
  w: number
  h: number
  image: Uint8Array | ArrayBuffer | ImageBitmap
}

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
  destRect: vec4f,
  texInfo: vec4f,
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
  let pixelPos = data.destRect.xy + quadPos * data.destRect.zw;
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

export class WebGPURenderer {
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private pipeline: GPURenderPipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null
  private bindGroup: GPUBindGroup | null = null
  private bindGroupDirty = true
  private uniformBuffer: GPUBuffer | null = null
  private imageDataBuffer: GPUBuffer | null = null
  private textureArray: GPUTexture | null = null
  private textureArrayView: GPUTextureView | null = null
  private textureArrayWidth = 0
  private textureArrayHeight = 0
  private textureArrayLayers = 0
  private pendingDestroyTextures: GPUTexture[] = []
  private readonly imageDataArray = new Float32Array(MAX_IMAGES_PER_BATCH * 8)
  private readonly resolutionArray = new Float32Array(2)
  private conversionBuffer: Uint8Array | null = null
  private conversionBufferSize = 0
  private canvas: HTMLCanvasElement | null = null
  private lastCanvasWidth = 0
  private lastCanvasHeight = 0
  private format: GPUTextureFormat = 'bgra8unorm'
  private initPromise: Promise<void> | null = null

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise

    this.initPromise = this.initDevice()
    return this.initPromise
  }

  async setCanvas(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.init()
    if (!this.device || width <= 0 || height <= 0) return

    this.canvas = canvas
    canvas.width = width
    canvas.height = height

    if (!this.context) {
      this.context = canvas.getContext('webgpu')
      if (!this.context) {
        throw new Error('Could not create WebGPU context')
      }

      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      })
    }

    this.resolutionArray[0] = width
    this.resolutionArray[1] = height
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.resolutionArray)
    this.lastCanvasWidth = width
    this.lastCanvasHeight = height
  }

  updateSize(width: number, height: number): void {
    if (!this.device || !this.canvas || width <= 0 || height <= 0) return
    if (width === this.lastCanvasWidth && height === this.lastCanvasHeight) return

    this.canvas.width = width
    this.canvas.height = height
    this.resolutionArray[0] = width
    this.resolutionArray[1] = height
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.resolutionArray)
    this.lastCanvasWidth = width
    this.lastCanvasHeight = height
  }

  render(images: RenderImageInput[], _canvasWidth: number, _canvasHeight: number): void {
    if (!this.device || !this.context || !this.pipeline) return

    const len = images.length
    if (len === 0) {
      this.clear()
      return
    }

    const currentTexture = this.context.getCurrentTexture()
    if (currentTexture.width === 0 || currentTexture.height === 0) {
      return
    }

    let maxWidth = 0
    let maxHeight = 0
    let validCount = 0
    for (let index = 0; index < len; index++) {
      const { w, h } = images[index]
      if (w <= 0 || h <= 0) continue
      if (w > maxWidth) maxWidth = w
      if (h > maxHeight) maxHeight = h
      validCount++
    }

    if (validCount === 0) {
      this.clear()
      return
    }

    this.ensureTextureArray(maxWidth, maxHeight, Math.min(validCount, MAX_TEXTURE_ARRAY_LAYERS))
    this.updateBindGroup()

    const textureView = currentTexture.createView()
    let imageIndex = 0
    let firstBatch = true

    while (imageIndex < len) {
      let texIndex = 0
      while (imageIndex < len && texIndex < MAX_TEXTURE_ARRAY_LAYERS) {
        const image = images[imageIndex++]
        const { w, h } = image
        if (w <= 0 || h <= 0) continue

        if (image.image instanceof ImageBitmap) {
          this.device.queue.copyExternalImageToTexture(
            { source: image.image, flipY: false },
            { texture: this.textureArray!, origin: [0, 0, texIndex], premultipliedAlpha: false },
            { width: w, height: h }
          )
        } else {
          this.uploadTextureData(texIndex, image.image, w, h)
        }

        const offset = texIndex << 3
        this.imageDataArray[offset] = image.x
        this.imageDataArray[offset + 1] = image.y
        this.imageDataArray[offset + 2] = w
        this.imageDataArray[offset + 3] = h
        this.imageDataArray[offset + 4] = w
        this.imageDataArray[offset + 5] = h
        this.imageDataArray[offset + 6] = texIndex
        this.imageDataArray[offset + 7] = 0
        texIndex++
      }

      if (texIndex === 0) continue

      this.device.queue.writeBuffer(this.imageDataBuffer!, 0, this.imageDataArray.buffer, 0, texIndex << 5)

      const commandEncoder = this.device.createCommandEncoder()
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: firstBatch ? 'clear' : 'load',
            storeOp: 'store',
          },
        ],
      })

      renderPass.setPipeline(this.pipeline)
      renderPass.setBindGroup(0, this.bindGroup!)
      renderPass.draw(6, texIndex)
      renderPass.end()

      this.device.queue.submit([commandEncoder.finish()])
      firstBatch = false
    }

    this.cleanupPendingTextures()
  }

  clear(): void {
    if (!this.device || !this.context) return

    const currentTexture = this.context.getCurrentTexture()
    const commandEncoder = this.device.createCommandEncoder()
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: currentTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    renderPass.end()
    this.device.queue.submit([commandEncoder.finish()])
  }

  destroy(): void {
    this.uniformBuffer?.destroy()
    this.imageDataBuffer?.destroy()
    this.textureArray?.destroy()
    for (const texture of this.pendingDestroyTextures) {
      texture.destroy()
    }

    this.pendingDestroyTextures = []
    this.device = null
    this.context = null
    this.pipeline = null
    this.bindGroupLayout = null
    this.bindGroup = null
    this.uniformBuffer = null
    this.imageDataBuffer = null
    this.textureArray = null
    this.textureArrayView = null
    this.canvas = null
    this.initPromise = null
    this.conversionBuffer = null
    this.conversionBufferSize = 0
  }

  private async initDevice(): Promise<void> {
    if (!isWebGPUSupported()) {
      throw new Error('WebGPU not supported')
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) {
      throw new Error('No WebGPU adapter found')
    }

    this.device = await adapter.requestDevice()
    this.format = navigator.gpu.getPreferredCanvasFormat()

    const vertexModule = this.device.createShaderModule({ code: VERTEX_SHADER })
    const fragmentModule = this.device.createShaderModule({ code: FRAGMENT_SHADER })

    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.imageDataBuffer = this.device.createBuffer({
      size: MAX_IMAGES_PER_BATCH * 8 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    this.createTextureArray(256, 256, 32)

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
      ],
    })

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
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
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  private nextPowerOf2(value: number): number {
    let next = Math.max(1, value)
    next--
    next |= next >> 1
    next |= next >> 2
    next |= next >> 4
    next |= next >> 8
    next |= next >> 16
    return next + 1
  }

  private createTextureArray(width: number, height: number, layers: number): void {
    if (this.textureArray) {
      this.pendingDestroyTextures.push(this.textureArray)
    }

    const nextWidth = this.nextPowerOf2(Math.max(width, 64))
    const nextHeight = this.nextPowerOf2(Math.max(height, 64))
    const nextLayers = Math.min(this.nextPowerOf2(Math.max(layers, 16)), MAX_TEXTURE_ARRAY_LAYERS)

    this.textureArray = this.device!.createTexture({
      size: [nextWidth, nextHeight, nextLayers],
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.textureArrayView = this.textureArray.createView({ dimension: '2d-array' })
    this.textureArrayWidth = nextWidth
    this.textureArrayHeight = nextHeight
    this.textureArrayLayers = nextLayers
    this.bindGroupDirty = true
  }

  private ensureTextureArray(maxWidth: number, maxHeight: number, count: number): void {
    if (
      maxWidth <= this.textureArrayWidth &&
      maxHeight <= this.textureArrayHeight &&
      count <= this.textureArrayLayers
    ) {
      return
    }

    const width = this.nextPowerOf2(Math.max(this.textureArrayWidth, maxWidth))
    const height = this.nextPowerOf2(Math.max(this.textureArrayHeight, maxHeight))
    const layers = Math.min(
      this.nextPowerOf2(Math.max(this.textureArrayLayers, count, count + 16)),
      MAX_TEXTURE_ARRAY_LAYERS
    )
    this.createTextureArray(width, height, layers)
  }

  private updateBindGroup(): void {
    if (!this.bindGroupDirty || !this.device || !this.bindGroupLayout || !this.textureArrayView) return

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: this.imageDataBuffer! } },
        { binding: 2, resource: this.textureArrayView },
      ],
    })
    this.bindGroupDirty = false
  }

  private uploadTextureData(layer: number, pixels: Uint8Array | ArrayBuffer, width: number, height: number): void {
    const bytesPerRow = width * 4
    let source = pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels)

    if (this.format === 'bgra8unorm') {
      const converted = this.ensureConversionBuffer(source.byteLength)
      for (let offset = 0; offset < source.byteLength; offset += 4) {
        converted[offset] = source[offset + 2]
        converted[offset + 1] = source[offset + 1]
        converted[offset + 2] = source[offset]
        converted[offset + 3] = source[offset + 3]
      }
      source = new Uint8Array(converted.buffer, 0, source.byteLength)
    }

    const upload = new Uint8Array(new ArrayBuffer(source.byteLength))
    upload.set(source)

    this.device!.queue.writeTexture(
      { texture: this.textureArray!, origin: [0, 0, layer] },
      upload,
      { bytesPerRow },
      { width, height, depthOrArrayLayers: 1 }
    )
  }

  private ensureConversionBuffer(size: number): Uint8Array {
    if (this.conversionBufferSize < size) {
      this.conversionBufferSize = Math.max(size, Math.floor(this.conversionBufferSize * 1.5), 65536)
      this.conversionBuffer = new Uint8Array(this.conversionBufferSize)
    }

    return this.conversionBuffer!
  }

  private cleanupPendingTextures(): void {
    if (this.pendingDestroyTextures.length === 0) return
    for (const texture of this.pendingDestroyTextures) {
      texture.destroy()
    }
    this.pendingDestroyTextures = []
  }
}