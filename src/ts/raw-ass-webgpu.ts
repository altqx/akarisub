/// <reference types="@webgpu/types" />

import { textureArrayLayerCap } from './gpu-budget'
import { webgpuCanvasConfiguration, type CanvasColorSpace } from './color-space'
import {
  GPUUploadSource,
  RAW_ASS_ATLAS_INSTANCE_BYTES,
  RAW_ASS_ATLAS_INSTANCE_INTS,
  assertAtlasInHeap,
  atlasInstancePixels,
  atlasLayerLimit,
  atlasPackLimits,
  growAtlasTexture,
  growInstanceCapacity,
  rawAssByteUnitTable,
  writeLayerInstance,
  type RawASSAtlasFrame,
  type RawASSAtlasStats
} from './raw-ass-atlas'

// Ints per image row written by akarisub_render_raw_collect /
// akarisub_render_atlas_collect: x, y, w, h, bitmap ptr, color, stride, pad.
const RAW_RRC_IMG_STRIDE = 8
// Uniforms: resolution (vec2f) + pad, then the 256-entry byte table as
// array<vec4f, 64>.
const UNIFORM_BYTES = 16 + 256 * 4
const RECOVERY_DELAYS_MS = [0, 250, 1000]
// A device lost this soon after creation counts as an early loss; after
// MAX_EARLY_LOSSES of them in a row recovery stops instead of recreating
// devices in a loop (e.g. a browser that cannot present WebGPU canvases).
const EARLY_LOSS_MS = 2000
const MAX_EARLY_LOSSES = 3
// How long the presentation probe waits for a device loss after its frame.
const PRESENT_PROBE_MS = 100

// Same position, bounds and blend math as the worker's WebGL2 atlas shaders.
// Framebuffer coordinates already have a top-left origin in WebGPU, which is
// what the GLSL computes from gl_FragCoord with its y flip. Colour channels
// come from the byte table so they are the exact float32 values the WebGL2
// paths use.
const RAW_ASS_WEBGPU_SHADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  _pad: vec2f,
  byteUnit: array<vec4f, 64>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var atlas: texture_2d_array<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) destXY: vec2f,
  @location(1) @interpolate(flat) atlasInfo: vec3i,
  @location(2) @interpolate(flat) texSize: vec2i,
  @location(3) @interpolate(flat) color: vec4f,
}

const QUAD_POSITIONS = array<vec2f, 6>(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 0.0),
  vec2f(1.0, 1.0),
  vec2f(0.0, 1.0)
);

fn byteUnit(b: u32) -> f32 {
  return uniforms.byteUnit[b >> 2u][b & 3u];
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) dest: vec4i,
  @location(1) atlasIn: vec3i,
  @location(2) color: u32
) -> VertexOutput {
  var output: VertexOutput;
  let destRect = vec4f(dest);
  let pixelPos = destRect.xy + QUAD_POSITIONS[vertexIndex] * destRect.zw;
  var clip = (pixelPos / uniforms.resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  output.position = vec4f(clip, 0.0, 1.0);
  output.destXY = destRect.xy;
  output.atlasInfo = atlasIn;
  output.texSize = dest.zw;
  output.color = vec4f(
    byteUnit((color >> 24u) & 255u),
    byteUnit((color >> 16u) & 255u),
    byteUnit((color >> 8u) & 255u),
    byteUnit(255u - (color & 255u))
  );
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let texCoord = vec2i(floor(input.position.xy - input.destXY));
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= input.texSize.x || texCoord.y >= input.texSize.y) {
    discard;
  }
  let coverage = textureLoad(atlas, texCoord + input.atlasInfo.xy, input.atlasInfo.z, 0).r;
  let alpha = coverage * input.color.a;
  return vec4f(input.color.rgb * alpha, alpha);
}
`

/** True when this worker exposes WebGPU. */
export const isWorkerWebGPUSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: GPU }).gpu

/** Adapter and device, or null when the browser has no usable adapter. */
const acquireDevice = async (): Promise<{ adapter: GPUAdapter; device: GPUDevice } | null> => {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
  if (!gpu) return null
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return null
  return { adapter, device: await adapter.requestDevice() }
}

/**
 * Draws one frame into a scratch OffscreenCanvas with `device` and reports
 * whether the device survived. Chromium without GPU compositing (e.g.
 * forced SwiftShader GL) loses a device within milliseconds of presenting a
 * WebGPU canvas; probing a scratch canvas first keeps the real canvas free
 * for the WebGL2 fallback.
 */
const devicePresentsCanvas = async (device: GPUDevice, format: GPUTextureFormat): Promise<boolean> => {
  if (typeof OffscreenCanvas === 'undefined') return true
  let lost = false
  const lostSignal = device.lost.then(() => {
    lost = true
  })
  const context = new OffscreenCanvas(1, 1).getContext('webgpu') as GPUCanvasContext | null
  if (!context) return false
  try {
    context.configure({ device, format, alphaMode: 'premultiplied' })
    const encoder = device.createCommandEncoder()
    encoder
      .beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      })
      .end()
    device.queue.submit([encoder.finish()])
    await Promise.race([
      lostSignal,
      device.queue.onSubmittedWorkDone().then(() => new Promise((resolve) => setTimeout(resolve, PRESENT_PROBE_MS)))
    ])
  } catch {
    return false
  } finally {
    try {
      context.unconfigure()
    } catch {
      /* A lost device can reject cleanup. */
    }
  }
  return !lost
}

/**
 * Worker-side raw ASS_Image compositor on an OffscreenCanvas WebGPU context.
 * It draws a libass frame atlas with one instanced draw (pages in one R8
 * array texture, ASS_AtlasInstance records as a 32-byte instance vertex
 * buffer) and, when a frame does not pack, the same pipeline with one array
 * layer per image. Output and blend state match the WebGL2 raw renderer.
 */
export class RawASSImageWebGPURenderer {
  readonly kind = 'webgpu' as const
  private _canvas: OffscreenCanvas | null = null
  private _context: GPUCanvasContext | null = null
  private _device: GPUDevice | null = null
  // Held for the device's lifetime: Chromium loses a device ("A valid
  // external Instance reference no longer exists") once its adapter and
  // instance are garbage collected.
  private _adapter: GPUAdapter | null = null
  private _format: GPUTextureFormat = 'bgra8unorm'
  private _pipeline: GPURenderPipeline | null = null
  private _bindGroupLayout: GPUBindGroupLayout | null = null
  private _bindGroup: GPUBindGroup | null = null
  private _uniformBuffer: GPUBuffer | null = null
  private _instanceBuffer: GPUBuffer | null = null
  private _instanceCapacity = 0
  private _texture: GPUTexture | null = null
  private _texWidth = 0
  private _texHeight = 0
  private _texLayers = 0
  private _maxTextureSize = 0
  private _maxArrayLayers = 0
  private _resolution = new Float32Array(2)
  private _resolutionWritten = false
  private _width = 0
  private _height = 0
  private _colorSpace: CanvasColorSpace = 'srgb'
  private _hdr = false
  private _readback = false
  private _lost = false
  private _destroyed = false
  private _generation = 0
  private _deviceCreatedAt = 0
  private _earlyLosses = 0
  private _failed = false
  // The GPU copy no longer matches the last pack libass reported (texture
  // reallocated, device replaced, per-image frame drawn in between, or a
  // pack result that was not drawn).
  private _pixelsDirty = true
  private _instancesDirty = true
  private _layerInstances = new Int32Array(0)
  /** Shared-memory handling for queue writes from the -mt build's heap. */
  readonly uploads = new GPUUploadSource()
  readonly atlasStats: RawASSAtlasStats = {
    pixelUploads: 0,
    instanceUploads: 0,
    textureAllocations: 0,
    contextLosses: 0,
    contextRestores: 0
  }
  /** Called after the device was lost; the GPU atlas copy is gone. */
  onContextLost: (() => void) | null = null
  /** Called once a replacement device is ready. */
  onContextRestored: (() => void) | null = null
  /**
   * Called once when recovery gives up. The canvas keeps its WebGPU context,
   * so only a new canvas can be drawn to after this.
   */
  onFailed: (() => void) | null = null

  /**
   * Acquires a device first and only then binds the canvas, so a browser
   * without (worker) WebGPU leaves the canvas free for WebGL2 or 2D.
   * Resolves false when WebGPU is unavailable.
   */
  async init(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    colorSpace: CanvasColorSpace,
    hdr: boolean
  ): Promise<boolean> {
    if (!isWorkerWebGPUSupported()) return false
    const generation = this._generation
    const acquired = await acquireDevice()
    if (!acquired) return false
    const { device } = acquired
    if (this._destroyed || generation !== this._generation) {
      device.destroy()
      return false
    }
    if (!(await devicePresentsCanvas(device, navigator.gpu.getPreferredCanvasFormat()))) {
      console.warn('[AkariSub] Worker WebGPU cannot present a canvas here; not using it')
      device.destroy()
      return false
    }
    if (this._destroyed || generation !== this._generation) {
      device.destroy()
      return false
    }
    this._adapter = acquired.adapter
    try {
      await this._setupDevice(device)
    } catch (error) {
      this._device = null
      device.destroy()
      throw error
    }
    if (this._destroyed) return false
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) {
      this._device = null
      device.destroy()
      return false
    }
    this._canvas = canvas
    this._context = context
    this._colorSpace = colorSpace
    this._hdr = hdr
    this._configure()
    this.updateSize(width, height)
    return true
  }

  /** Pipeline, uniforms and bookkeeping for a (new) device. */
  private async _setupDevice(device: GPUDevice): Promise<void> {
    this._device = device
    this._pipeline = null
    this._bindGroup = null
    this._texture = null
    this._texWidth = 0
    this._texHeight = 0
    this._texLayers = 0
    this._instanceBuffer = null
    this._instanceCapacity = 0
    this._resolutionWritten = false
    this._markAtlasDirty()
    this._deviceCreatedAt = performance.now()
    this._maxTextureSize = device.limits.maxTextureDimension2D
    this._maxArrayLayers = device.limits.maxTextureArrayLayers
    const format = navigator.gpu.getPreferredCanvasFormat()
    this._format = format

    this._uniformBuffer = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    device.queue.writeBuffer(this._uniformBuffer, 16, rawAssByteUnitTable())

    this._bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' }
        }
      ]
    })
    const module = device.createShaderModule({ code: RAW_ASS_WEBGPU_SHADER })
    // The async variant rejects on shader or pipeline errors instead of
    // reporting them later as uncaptured device errors.
    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._bindGroupLayout] }),
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: RAW_ASS_ATLAS_INSTANCE_BYTES,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'sint32x4' },
              { shaderLocation: 1, offset: 16, format: 'sint32x3' },
              { shaderLocation: 2, offset: 28, format: 'uint32' }
            ]
          }
        ]
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-list' }
    })
    if (this._device !== device) return
    this._pipeline = pipeline

    void device.lost.then((info) => {
      if (this._device !== device || this._destroyed) return
      this._handleDeviceLoss(info)
    })
  }

  /** Same canvas configuration as the main-thread WebGPU renderer. */
  private _configure(): void {
    if (!this._context || !this._device) return
    const extras = webgpuCanvasConfiguration({ colorSpace: this._colorSpace, hdr: this._hdr })
    const config: GPUCanvasConfiguration = {
      device: this._device,
      format: this._format,
      alphaMode: 'premultiplied',
      toneMapping: extras.toneMapping,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | (this._readback ? GPUTextureUsage.COPY_SRC : 0)
    }
    if (extras.colorSpace) {
      const colorConfig: { colorSpace?: string } = config
      colorConfig.colorSpace = extras.colorSpace
    }
    this._context.configure(config)
  }

  private _handleDeviceLoss(info: GPUDeviceLostInfo): void {
    console.warn('[AkariSub] Raw ASS WebGPU device lost:', info.reason, info.message)
    this._lost = true
    this._device = null
    this._pipeline = null
    this._bindGroup = null
    this._texture = null
    this._instanceBuffer = null
    this._uniformBuffer = null
    this.atlasStats.contextLosses++
    this._markAtlasDirty()
    this.onContextLost?.()
    this._earlyLosses = performance.now() - this._deviceCreatedAt < EARLY_LOSS_MS ? this._earlyLosses + 1 : 0
    if (this._earlyLosses >= MAX_EARLY_LOSSES) {
      this._fail(`devices keep getting lost (${this._earlyLosses} in a row)`)
      return
    }
    void this._recover()
  }

  /** True once device recovery gave up; the canvas stays bound to WebGPU. */
  get failed(): boolean {
    return this._failed
  }

  /** Replaces a lost device; stale attempts are dropped by generation. */
  private async _recover(): Promise<void> {
    const generation = ++this._generation
    let lastError: unknown = new Error('No WebGPU adapter')
    for (const delay of RECOVERY_DELAYS_MS) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      if (this._destroyed || generation !== this._generation) return
      let device: GPUDevice | null = null
      try {
        const acquired = await acquireDevice()
        device = acquired?.device ?? null
        if (this._destroyed || generation !== this._generation) {
          device?.destroy()
          return
        }
        if (!acquired || !device) continue
        this._adapter = acquired.adapter
        await this._setupDevice(device)
        if (this._destroyed || generation !== this._generation || this._device !== device) {
          if (this._device === device) this._device = null
          device.destroy()
          return
        }
        this._configure()
        this._lost = false
        this.atlasStats.contextRestores++
        this.onContextRestored?.()
        return
      } catch (error) {
        lastError = error
        if (device && this._device === device) this._device = null
        device?.destroy()
      }
    }
    this._fail('device recovery failed', lastError)
  }

  private _fail(reason: string, error?: unknown): void {
    if (this._failed || this._destroyed) return
    this._failed = true
    console.error(`[AkariSub] Raw ASS WebGPU ${reason}; giving up`, ...(error === undefined ? [] : [error]))
    this.onFailed?.()
  }

  private _markAtlasDirty(): void {
    this._pixelsDirty = true
    this._instancesDirty = true
  }

  get contextLost(): boolean {
    return this._lost || !this._device
  }

  get atlasAvailable(): boolean {
    return !!this._pipeline && !this.contextLost
  }

  atlasLimits(maxSizeOverride: number = 0): { maxSize: number; maxPages: number } {
    return atlasPackLimits(this._maxTextureSize, this._maxArrayLayers, maxSizeOverride)
  }

  noteUndrawnAtlas(frame: RawASSAtlasFrame): void {
    if (frame.pixelsChanged) this._pixelsDirty = true
    if (frame.instancesChanged) this._instancesDirty = true
  }

  invalidateAtlas(): void {
    this._markAtlasDirty()
  }

  updateSize(width: number, height: number): void {
    if (!this._canvas || width <= 0 || height <= 0) return
    if (this._width === width && this._height === height) return
    this._canvas.width = width
    this._canvas.height = height
    this._width = width
    this._height = height
  }

  setCanvasColorSpace(colorSpace: CanvasColorSpace, hdr: boolean = this._hdr): void {
    if (colorSpace === this._colorSpace && hdr === this._hdr) return
    this._colorSpace = colorSpace
    this._hdr = hdr
    this._configure()
  }

  /** Grow-only R8 array texture holding at least width x height x layers. */
  private _ensureTexture(width: number, height: number, layers: number): void {
    const device = this._device!
    const current = this._texture ? { width: this._texWidth, height: this._texHeight, layers: this._texLayers } : null
    const next = growAtlasTexture(
      current,
      { width, height, layers },
      atlasLayerLimit(this._maxArrayLayers),
      this._maxTextureSize
    )
    if (!next) return
    this._texture?.destroy()
    // dimension '2d' with depthOrArrayLayers > 1 is an array texture; the
    // binding views it as 2d-array even with a single layer.
    this._texture = device.createTexture({
      size: { width: next.width, height: next.height, depthOrArrayLayers: next.layers },
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    })
    this._texWidth = next.width
    this._texHeight = next.height
    this._texLayers = next.layers
    this._bindGroup = device.createBindGroup({
      layout: this._bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer! } },
        { binding: 1, resource: this._texture.createView({ dimension: '2d-array' }) }
      ]
    })
    this._pixelsDirty = true
    this.atlasStats.textureAllocations++
  }

  private _ensureInstanceBuffer(bytes: number): void {
    const capacity = growInstanceCapacity(this._instanceBuffer ? this._instanceCapacity : 0, bytes)
    if (this._instanceBuffer && capacity === this._instanceCapacity) return
    this._instanceBuffer?.destroy()
    this._instanceBuffer = this._device!.createBuffer({
      size: capacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    })
    this._instanceCapacity = capacity
    this._instancesDirty = true
  }

  private _writeResolution(width: number, height: number): void {
    if (this._resolutionWritten && this._resolution[0] === width && this._resolution[1] === height) return
    this._resolution[0] = width
    this._resolution[1] = height
    this._device!.queue.writeBuffer(this._uniformBuffer!, 0, this._resolution)
    this._resolutionWritten = true
  }

  /** One render pass on the current canvas texture: clear or load, then an optional draw. */
  private _submitPass(clear: boolean, count: number): void {
    const device = this._device!
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this._context!.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: clear ? 'clear' : 'load',
          storeOp: 'store'
        }
      ]
    })
    if (count > 0) {
      pass.setPipeline(this._pipeline!)
      pass.setBindGroup(0, this._bindGroup!)
      pass.setVertexBuffer(0, this._instanceBuffer!)
      pass.draw(6, count)
    }
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  private _requireReady(): GPUDevice {
    if (this._destroyed || !this._context || !this._pipeline || !this._device || this._lost) {
      throw new Error('Raw ASS WebGPU device is not available')
    }
    return this._device
  }

  /**
   * Draws a packed frame with one instanced draw. Pages and instances are
   * written only when libass reports them changed or the GPU copy is stale.
   * `heap` must be a view taken after the WASM call that packed the frame.
   * Returns the number of mask pixels drawn.
   */
  renderAtlas(frame: RawASSAtlasFrame, heap: Uint8Array, width: number, height: number): number {
    const device = this._requireReady()
    assertAtlasInHeap(frame, heap.length)
    this.updateSize(width, height)
    const count = frame.instanceCount
    if (count > 0) {
      this._ensureTexture(frame.pageWidth, frame.pageHeight, frame.pages)
      if (frame.pixelsChanged || this._pixelsDirty) {
        // Pages are one tightly packed width x height x n_pages R8 volume.
        const texture = this._texture!
        this.uploads.upload(
          heap.buffer,
          frame.bufferPtr,
          frame.pageWidth * frame.pageHeight * frame.pages,
          (data, offset) =>
            device.queue.writeTexture(
              { texture },
              data,
              { offset, bytesPerRow: frame.pageWidth, rowsPerImage: frame.pageHeight },
              { width: frame.pageWidth, height: frame.pageHeight, depthOrArrayLayers: frame.pages }
            )
        )
        this._pixelsDirty = false
        this.atlasStats.pixelUploads++
      }
      const bytes = count * RAW_ASS_ATLAS_INSTANCE_BYTES
      this._ensureInstanceBuffer(bytes)
      if (frame.instancesChanged || this._instancesDirty) {
        const buffer = this._instanceBuffer!
        this.uploads.upload(heap.buffer, frame.instancesPtr, bytes, (data, offset) =>
          device.queue.writeBuffer(buffer, 0, data, offset, bytes)
        )
        this._instancesDirty = false
        this.atlasStats.instanceUploads++
      }
      this._writeResolution(width, height)
    }
    this._submitPass(true, count)
    if (count === 0) return 0
    return atlasInstancePixels(
      new Int32Array(heap.buffer, frame.instancesPtr, count * RAW_ASS_ATLAS_INSTANCE_INTS),
      count
    )
  }

  /**
   * Per-image path for frames that did not pack: each mask goes into its own
   * array layer of the same texture and is drawn by the atlas pipeline from
   * origin 0,0, in batches of as many layers as the texture holds.
   */
  renderRawAssMetadata(meta: Int32Array, imageCount: number, heap: Uint8Array, width: number, height: number): number {
    const device = this._requireReady()
    this.updateSize(width, height)
    // The texture layers and instance buffer are reused below.
    this._markAtlasDirty()

    let maxW = 0
    let maxH = 0
    let validImages = 0
    for (let i = 0; i < imageCount; i++) {
      const off = i * RAW_RRC_IMG_STRIDE
      const w = meta[off + 2]
      const h = meta[off + 3]
      if (w <= 0 || h <= 0 || meta[off + 4] <= 0) continue
      if (255 - ((meta[off + 5] >>> 0) & 0xff) <= 0) continue
      if (w > maxW) maxW = w
      if (h > maxH) maxH = h
      validImages++
    }
    if (validImages === 0) {
      this._submitPass(true, 0)
      return 0
    }

    const layerCap = textureArrayLayerCap(maxW, maxH, 1, atlasLayerLimit(this._maxArrayLayers))
    if (layerCap === 0) throw new Error('Raw ASS masks exceed the GPU texture budget')
    this._ensureTexture(maxW, maxH, Math.min(validImages, layerCap))
    const batchCap = Math.min(this._texLayers, validImages)
    this._ensureInstanceBuffer(batchCap * RAW_ASS_ATLAS_INSTANCE_BYTES)
    if (this._layerInstances.length < batchCap * RAW_ASS_ATLAS_INSTANCE_INTS) {
      this._layerInstances = new Int32Array(batchCap * RAW_ASS_ATLAS_INSTANCE_INTS)
    }
    this._writeResolution(width, height)

    const texture = this._texture!
    const buffer = this._instanceBuffer!
    let imageIndex = 0
    let pixels = 0
    let first = true
    while (imageIndex < imageCount) {
      let count = 0
      while (imageIndex < imageCount && count < batchCap) {
        const off = imageIndex++ * RAW_RRC_IMG_STRIDE
        const w = meta[off + 2]
        const h = meta[off + 3]
        const ptr = meta[off + 4]
        if (w <= 0 || h <= 0 || ptr <= 0) continue
        const color = meta[off + 5] >>> 0
        if (255 - (color & 0xff) <= 0) continue
        const stride = meta[off + 6] > 0 ? meta[off + 6] : w
        const layer = count
        this.uploads.upload(heap.buffer, ptr, stride * (h - 1) + w, (data, offset) =>
          device.queue.writeTexture(
            { texture, origin: { x: 0, y: 0, z: layer } },
            data,
            { offset, bytesPerRow: stride, rowsPerImage: h },
            { width: w, height: h, depthOrArrayLayers: 1 }
          )
        )
        writeLayerInstance(this._layerInstances, count, meta[off], meta[off + 1], w, h, layer, color)
        pixels += w * h
        count++
      }
      if (count === 0) continue
      // Queue writes land before the next submit, so each batch reuses the
      // layers and the instance buffer after the previous batch was drawn.
      device.queue.writeBuffer(buffer, 0, this._layerInstances.buffer, 0, count * RAW_ASS_ATLAS_INSTANCE_BYTES)
      this._submitPass(first, count)
      first = false
    }
    if (first) this._submitPass(true, 0)
    return pixels
  }

  /**
   * Adds COPY_SRC to the canvas configuration so {@linkcode readPixels} can
   * copy the canvas texture (tests). Reconfiguring drops the current frame.
   */
  enableReadback(): void {
    if (this._readback) return
    this._readback = true
    this._configure()
  }

  /**
   * Reads the current canvas texture back as RGBA rows, bottom row first
   * (the WebGL2 readPixels layout). Call it in the task that rendered the
   * frame, after {@linkcode enableReadback}.
   */
  async readPixels(): Promise<Uint8Array | null> {
    const device = this._device
    const context = this._context
    if (!device || !context || this._lost || !this._readback) return null
    const texture = context.getCurrentTexture()
    const width = texture.width
    const height = texture.height
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256
    const buffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    })
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow, rowsPerImage: height }, { width, height })
    device.queue.submit([encoder.finish()])
    try {
      await buffer.mapAsync(GPUMapMode.READ)
      const src = new Uint8Array(buffer.getMappedRange())
      const out = new Uint8Array(width * height * 4)
      const bgra = this._format === 'bgra8unorm'
      for (let y = 0; y < height; y++) {
        let s = y * bytesPerRow
        let d = (height - 1 - y) * width * 4
        for (let x = 0; x < width; x++, s += 4, d += 4) {
          out[d] = src[bgra ? s + 2 : s]
          out[d + 1] = src[s + 1]
          out[d + 2] = src[bgra ? s : s + 2]
          out[d + 3] = src[s + 3]
        }
      }
      buffer.unmap()
      return out
    } finally {
      buffer.destroy()
    }
  }

  /** Destroys the device to simulate a GPU loss (tests); recovery is automatic. */
  loseDevice(): boolean {
    if (!this._device) return false
    this._device.destroy()
    return true
  }

  destroy(): void {
    this._destroyed = true
    this._generation++
    const device = this._device
    this._device = null
    try {
      this._context?.unconfigure()
    } catch {
      /* A lost device can reject cleanup. */
    }
    this._texture?.destroy()
    this._instanceBuffer?.destroy()
    this._uniformBuffer?.destroy()
    device?.destroy()
    this._adapter = null
    this._texture = null
    this._instanceBuffer = null
    this._uniformBuffer = null
    this._pipeline = null
    this._bindGroup = null
    this._context = null
    this._canvas = null
    this.onContextLost = null
    this.onContextRestored = null
    this.onFailed = null
  }
}
