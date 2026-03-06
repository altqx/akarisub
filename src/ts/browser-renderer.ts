import { AkariSubAsyncRenderer, type AsyncRendererCreateOptions } from './async-renderer'
import type { FontConfig, FrameMargins, FrameSize, RenderImageSlice } from './renderer'
import type { ASSEvent, ASSStyle } from './worker-types'
import { WebGL2Renderer, isWebGL2Supported } from './webgl2-renderer'
import { WebGPURenderer, isWebGPUSupported } from './webgpu-renderer'

type VideoFrameRequestCallback = (now: number, metadata: { mediaTime: number }) => void

type HTMLVideoElementWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

export interface BrowserRendererOptions {
  video?: HTMLVideoElement
  canvas?: HTMLCanvasElement
  trackContent?: string
  fonts?: FontConfig
  margins?: FrameMargins
  cacheLimits?: AsyncRendererCreateOptions['cacheLimits']
  workerOptions?: Omit<AsyncRendererCreateOptions, 'frame' | 'storage' | 'margins' | 'fonts' | 'cacheLimits'>
  autoRender?: boolean
  onDemandRender?: boolean
  targetFps?: number
  prescaleFactor?: number
  prescaleHeightLimit?: number
  maxRenderHeight?: number
  renderer?: BrowserRendererType | 'auto'
  offscreenRender?: boolean
  onCanvasFallback?: () => void
}

export type BrowserRendererType = 'canvas2d' | 'webgl2' | 'webgpu'

export interface BrowserRendererSupport {
  canvas2d: boolean
  offscreenCanvas2d: boolean
  webgl2: boolean
  webgpu: boolean
}

export interface BrowserRendererPerformanceStats {
  framesRendered: number
  framesDropped: number
  avgRenderTime: number
  maxRenderTime: number
  minRenderTime: number
  lastRenderTime: number
  renderFps: number
  usingWorker: boolean
  offscreenRender: boolean
  onDemandRender: boolean
  pendingRenders: number
  totalEvents: number
  cacheHits: number
  cacheMisses: number
}

type GpuRenderer = WebGL2Renderer | WebGPURenderer

type RendererSelection = {
  rendererType: BrowserRendererType
  usedCanvasFallback: boolean
}

type RenderImageInput = {
  x: number
  y: number
  w: number
  h: number
  image: Uint8Array | ArrayBuffer | ImageBitmap
}

export class AkariSubCanvasRenderer {
  private readonly renderer: AkariSubAsyncRenderer
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly video?: HTMLVideoElementWithRVFC
  private readonly resizeObserver?: ResizeObserver
  private readonly ownsCanvas: boolean
  private readonly rendererTypeValue: BrowserRendererType
  private readonly usesOffscreenCanvasValue: boolean
  private readonly gpuRenderer: GpuRenderer | null
  private readonly useVideoFrameCallback: boolean
  private readonly targetFrameIntervalMs: number
  private readonly prescaleFactor: number
  private readonly prescaleHeightLimit: number
  private readonly maxRenderHeight: number
  private fontConfig: FontConfig
  private pendingRenders = 0
  private framesRendered = 0
  private framesDropped = 0
  private totalRenderTime = 0
  private maxRenderTime = 0
  private minRenderTime = Number.POSITIVE_INFINITY
  private lastRenderTime = 0
  private cacheHits = 0
  private cacheMisses = 0
  private readonly statsStart = performance.now()
  private rafId: number | null = null
  private rvfcId: number | null = null
  private destroyed = false
  private rendering = false
  private autoRenderEnabled: boolean
  private nextAnimationFrameAt = 0

  private constructor(
    renderer: AkariSubAsyncRenderer,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D | null,
    video?: HTMLVideoElementWithRVFC,
    resizeObserver?: ResizeObserver,
    ownsCanvas = false,
    autoRender = true,
    rendererType: BrowserRendererType = 'canvas2d',
    usesOffscreenCanvas = false,
    gpuRenderer: GpuRenderer | null = null,
    fontConfig: FontConfig = {},
    onDemandRender = true,
    targetFps = 24,
    prescaleFactor = 1,
    prescaleHeightLimit = 1080,
    maxRenderHeight = 0
  ) {
    this.renderer = renderer
    this.canvas = canvas
    this.ctx = ctx
    this.video = video
    this.resizeObserver = resizeObserver
    this.ownsCanvas = ownsCanvas
    this.autoRenderEnabled = autoRender
    this.rendererTypeValue = rendererType
    this.usesOffscreenCanvasValue = usesOffscreenCanvas
    this.gpuRenderer = gpuRenderer
    this.fontConfig = { ...fontConfig }
    this.useVideoFrameCallback = onDemandRender && Boolean(video?.requestVideoFrameCallback)
    this.targetFrameIntervalMs = targetFps > 0 ? 1000 / targetFps : 0
    this.prescaleFactor = prescaleFactor
    this.prescaleHeightLimit = prescaleHeightLimit
    this.maxRenderHeight = maxRenderHeight
  }

  static async create(options: BrowserRendererOptions): Promise<AkariSubCanvasRenderer> {
    const ownsCanvas = !options.canvas
    const canvas = options.canvas ?? createOverlayCanvas(options.video)

    const frame = computeFrameSize(canvas, options.video)
    const renderer = await AkariSubAsyncRenderer.create({
      ...options.workerOptions,
      frame,
      storage: frame,
      margins: options.margins,
      fonts: options.fonts,
      cacheLimits: options.cacheLimits,
    })

    if (options.trackContent) {
      await renderer.loadTrackFromUtf8(options.trackContent)
    }

    const selection = selectRenderer(options.renderer)
    let ctx: CanvasRenderingContext2D | null = null
    let gpuRenderer: GpuRenderer | null = null
    let usesOffscreenCanvas = false

    if (selection.rendererType === 'canvas2d') {
      usesOffscreenCanvas = canUseOffscreenCanvas(options)

      if (usesOffscreenCanvas) {
        const offscreenCanvas = (
          canvas as HTMLCanvasElement & { transferControlToOffscreen(): OffscreenCanvas }
        ).transferControlToOffscreen()
        await renderer.attachOffscreenCanvas(offscreenCanvas, frame.width, frame.height)
      } else {
        ctx = canvas.getContext('2d', { alpha: true })
        if (!ctx) {
          throw new Error('2D canvas rendering is not supported')
        }
      }
    } else if (selection.rendererType === 'webgpu') {
      gpuRenderer = new WebGPURenderer()
      await gpuRenderer.setCanvas(canvas, frame.width, frame.height)
    } else {
      gpuRenderer = new WebGL2Renderer()
      await gpuRenderer.setCanvas(canvas, frame.width, frame.height)
    }

    if (selection.usedCanvasFallback) {
      options.onCanvasFallback?.()
    }

    const resizeObserver = options.video
      ? new ResizeObserver(() => {
          void instance?.syncCanvasToVideo()
        })
      : undefined

    let instance: AkariSubCanvasRenderer | null = null
    instance = new AkariSubCanvasRenderer(
      renderer,
      canvas,
      ctx,
      options.video as HTMLVideoElementWithRVFC | undefined,
      resizeObserver,
      ownsCanvas,
      options.autoRender ?? true,
      selection.rendererType,
      usesOffscreenCanvas,
      gpuRenderer,
      options.fonts,
      options.onDemandRender ?? true,
      options.targetFps ?? 24,
      options.prescaleFactor ?? 1,
      options.prescaleHeightLimit ?? 1080,
      options.maxRenderHeight ?? 0
    )

    if (resizeObserver && options.video) {
      resizeObserver.observe(options.video)
    }

    await instance.syncCanvasToVideo()

    if (instance.autoRenderEnabled) {
      instance.start()
    }

    return instance
  }

  get element(): HTMLCanvasElement {
    return this.canvas
  }

  get runtimeVersion(): string {
    return this.renderer.runtimeVersion
  }

  get rendererType(): BrowserRendererType {
    return this.rendererTypeValue
  }

  get usesOffscreenCanvas(): boolean {
    return this.usesOffscreenCanvasValue
  }

  get libassVersion(): number {
    return this.renderer.libassVersion
  }

  get hasTrack(): boolean {
    return this.renderer.hasTrack
  }

  get eventCount(): number {
    return this.renderer.eventCount
  }

  get styleCount(): number {
    return this.renderer.styleCount
  }

  get trackColorSpace(): number | null {
    return this.renderer.trackColorSpace
  }

  getStats(): BrowserRendererPerformanceStats {
    const elapsedMs = Math.max(performance.now() - this.statsStart, 1)
    return {
      framesRendered: this.framesRendered,
      framesDropped: this.framesDropped,
      avgRenderTime: this.framesRendered > 0 ? this.totalRenderTime / this.framesRendered : 0,
      maxRenderTime: this.maxRenderTime,
      minRenderTime: this.minRenderTime === Number.POSITIVE_INFINITY ? 0 : this.minRenderTime,
      lastRenderTime: this.lastRenderTime,
      renderFps: this.framesRendered / (elapsedMs / 1000),
      usingWorker: true,
      offscreenRender: this.usesOffscreenCanvasValue,
      onDemandRender: this.useVideoFrameCallback,
      pendingRenders: this.pendingRenders,
      totalEvents: this.eventCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    }
  }

  static getSupportedRenderers(): BrowserRendererSupport {
    return {
      canvas2d: isCanvas2dSupported(),
      offscreenCanvas2d: isOffscreenCanvas2dSupported(),
      webgl2: isWebGL2Supported(),
      webgpu: isWebGPUSupported(),
    }
  }

  async loadTrackFromUtf8(trackContent: string): Promise<void> {
    await this.renderer.loadTrackFromUtf8(trackContent)
    await this.renderCurrentFrame(true)
  }

  async setFonts(fonts: FontConfig): Promise<void> {
    this.fontConfig = { ...fonts }
    await this.renderer.setFonts(fonts)
  }

  async setDefaultFont(font: string | null): Promise<void> {
    this.fontConfig = {
      ...this.fontConfig,
      defaultFont: font,
    }
    await this.renderer.setDefaultFont(font)
  }

  async addFont(name: string, data: Uint8Array): Promise<void> {
    await this.renderer.addFont(name, data)
  }

  createEvent(event: Partial<ASSEvent>): Promise<number> {
    return this.renderer.createEvent(event)
  }

  async setEvent(index: number, event: Partial<ASSEvent>): Promise<void> {
    await this.renderer.setEvent(index, event)
    await this.renderCurrentFrame(true)
  }

  async removeEvent(index: number): Promise<void> {
    await this.renderer.removeEvent(index)
    await this.renderCurrentFrame(true)
  }

  getEvents(): Promise<ASSEvent[]> {
    return this.renderer.getEvents()
  }

  createStyle(style: Partial<ASSStyle>): Promise<number> {
    return this.renderer.createStyle(style)
  }

  async setStyle(index: number, style: Partial<ASSStyle>): Promise<void> {
    await this.renderer.setStyle(index, style)
    await this.renderCurrentFrame(true)
  }

  async removeStyle(index: number): Promise<void> {
    await this.renderer.removeStyle(index)
    await this.renderCurrentFrame(true)
  }

  getStyles(): Promise<ASSStyle[]> {
    return this.renderer.getStyles()
  }

  async styleOverride(index: number): Promise<void> {
    await this.renderer.styleOverride(index)
    await this.renderCurrentFrame(true)
  }

  async disableStyleOverride(): Promise<void> {
    await this.renderer.disableStyleOverride()
    await this.renderCurrentFrame(true)
  }

  async clearTrack(): Promise<void> {
    await this.renderer.clearTrack()
    if (this.gpuRenderer) {
      this.gpuRenderer.clear()
      return
    }

    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  start(): void {
    if (this.destroyed || this.rendering) return
    this.rendering = true
    this.scheduleNextFrame()
  }

  stop(): void {
    this.rendering = false
    this.cancelScheduledFrame()
  }

  async renderAt(timestampMs: number, force = false): Promise<void> {
    await this.renderFrameAt(timestampMs, force)
  }

  resetStats(): void {
    this.pendingRenders = 0
    this.framesRendered = 0
    this.framesDropped = 0
    this.totalRenderTime = 0
    this.maxRenderTime = 0
    this.minRenderTime = Number.POSITIVE_INFINITY
    this.lastRenderTime = 0
    this.cacheHits = 0
    this.cacheMisses = 0
    this.nextAnimationFrameAt = 0
  }

  async renderCurrentFrame(force = false): Promise<void> {
    const timestampMs = this.video ? Math.round(this.video.currentTime * 1000) : 0
    await this.renderFrameAt(timestampMs, force)
  }

  private async renderFrameAt(timestampMs: number, force = false): Promise<void> {
    if (this.destroyed) return

    if (this.pendingRenders > 0 && !force) {
      this.framesDropped++
      return
    }

    const startedAt = performance.now()
    this.pendingRenders++

    try {
      if (this.rendererTypeValue === 'canvas2d') {
        if (this.usesOffscreenCanvasValue) {
          const frame = await this.renderer.renderOffscreenFrame(timestampMs, force)
          this.recordFrameStats(frame.changed !== 0)
          return
        }

        const frame = await this.renderer.renderCompositedFrame(timestampMs, force)
        if (!frame) return
        this.recordFrameStats(frame.changed !== 0)
        if (frame.changed === 0 && !force) return

        const imageData = new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height)
        this.ctx?.putImageData(imageData, 0, 0)
        return
      }

      const frame = await this.renderer.renderImageSlices(timestampMs, force)
      if (!frame) return

      this.recordFrameStats(frame.changed !== 0)
      if (frame.changed === 0 && !force) return

      const images = normalizeRenderImages(frame.images)
      this.gpuRenderer?.render(images, this.canvas.width, this.canvas.height)
    } finally {
      this.pendingRenders--
      const elapsed = performance.now() - startedAt
      this.lastRenderTime = elapsed
      this.totalRenderTime += elapsed
      this.maxRenderTime = Math.max(this.maxRenderTime, elapsed)
      this.minRenderTime = Math.min(this.minRenderTime, elapsed)
      this.framesRendered++
    }
  }

  async syncCanvasToVideo(): Promise<void> {
    if (this.destroyed) return

    const frame = computeFrameSize(this.canvas, this.video)
    if (this.canvas.width !== frame.width) this.canvas.width = frame.width
    if (this.canvas.height !== frame.height) this.canvas.height = frame.height

    if (this.video) {
      syncCanvasStyleToVideo(this.canvas, this.video)
    }

    this.gpuRenderer?.updateSize(frame.width, frame.height)

    await this.renderer.configureCanvas(frame, frame)
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return

    this.destroyed = true
    this.stop()
    this.resizeObserver?.disconnect()
    this.gpuRenderer?.destroy()
    await this.renderer.dispose()

    if (this.ownsCanvas) {
      this.canvas.remove()
    }
  }

  private scheduleNextFrame(): void {
    if (!this.rendering || this.destroyed) return

    if (this.useVideoFrameCallback && this.video?.requestVideoFrameCallback) {
      this.rvfcId = this.video.requestVideoFrameCallback(async () => {
        this.rvfcId = null
        await this.renderCurrentFrame(false)
        this.scheduleNextFrame()
      })
      return
    }

    this.rafId = requestAnimationFrame(async (now) => {
      this.rafId = null

      if (this.targetFrameIntervalMs > 0 && now < this.nextAnimationFrameAt) {
        this.scheduleNextFrame()
        return
      }

      this.nextAnimationFrameAt = now + this.targetFrameIntervalMs
      await this.renderCurrentFrame(false)
      this.scheduleNextFrame()
    })
  }

  private cancelScheduledFrame(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.rvfcId !== null && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.rvfcId)
      this.rvfcId = null
    }
  }

  private recordFrameStats(changed: boolean): void {
    if (changed) {
      this.cacheMisses++
    } else {
      this.cacheHits++
    }
  }
}

function isCanvas2dSupported(): boolean {
  if (typeof document === 'undefined') return false

  try {
    return document.createElement('canvas').getContext('2d') !== null
  } catch {
    return false
  }
}

function isOffscreenCanvas2dSupported(): boolean {
  if (typeof OffscreenCanvas === 'undefined') return false

  try {
    return new OffscreenCanvas(1, 1).getContext('2d') !== null
  } catch {
    return false
  }
}

function canUseOffscreenCanvas(options: BrowserRendererOptions): boolean {
  if (options.offscreenRender === false) return false
  if (options.canvas) return false
  if (typeof HTMLCanvasElement === 'undefined') return false
  if (!('transferControlToOffscreen' in HTMLCanvasElement.prototype)) return false
  return isOffscreenCanvas2dSupported()
}

function selectRenderer(requested: BrowserRendererOptions['renderer'] = 'auto'): RendererSelection {
  const webgpu = isWebGPUSupported()
  const webgl2 = isWebGL2Supported()

  switch (requested) {
    case 'webgpu':
      if (webgpu) return { rendererType: 'webgpu', usedCanvasFallback: false }
      if (webgl2) return { rendererType: 'webgl2', usedCanvasFallback: false }
      return { rendererType: 'canvas2d', usedCanvasFallback: true }
    case 'webgl2':
      if (webgl2) return { rendererType: 'webgl2', usedCanvasFallback: false }
      return { rendererType: 'canvas2d', usedCanvasFallback: true }
    case 'canvas2d':
      return { rendererType: 'canvas2d', usedCanvasFallback: false }
    case 'auto':
    default:
      if (webgpu) return { rendererType: 'webgpu', usedCanvasFallback: false }
      if (webgl2) return { rendererType: 'webgl2', usedCanvasFallback: false }
      return { rendererType: 'canvas2d', usedCanvasFallback: false }
  }
}

function normalizeRenderImages(images: RenderImageSlice[]): RenderImageInput[] {
  return images.map((image) => ({
    x: image.x,
    y: image.y,
    w: image.width,
    h: image.height,
    image: normalizePixels(image),
  }))
}

function normalizePixels(image: RenderImageSlice): Uint8Array {
  const packedStride = image.width * 4
  if (image.stride === packedStride) {
    return image.pixels.byteOffset === 0 && image.pixels.byteLength === image.pixels.buffer.byteLength
      ? image.pixels
      : image.pixels.slice()
  }

  const packed = new Uint8Array(image.height * packedStride)
  for (let row = 0; row < image.height; row++) {
    const sourceOffset = row * image.stride
    const targetOffset = row * packedStride
    packed.set(image.pixels.subarray(sourceOffset, sourceOffset + packedStride), targetOffset)
  }
  return packed
}

function createOverlayCanvas(video?: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.style.pointerEvents = 'none'
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'

  if (video?.parentElement) {
    const parent = video.parentElement
    const computed = window.getComputedStyle(parent)
    if (computed.position === 'static') {
      parent.style.position = 'relative'
    }
    parent.appendChild(canvas)
  }

  return canvas
}

function computeFrameSize(canvas: HTMLCanvasElement, video?: HTMLVideoElement): FrameSize {
  const videoWidth = video?.videoWidth || Math.round(video?.clientWidth || canvas.clientWidth || canvas.width || 1)
  const videoHeight = video?.videoHeight || Math.round(video?.clientHeight || canvas.clientHeight || canvas.height || 1)

  return {
    width: Math.max(1, videoWidth),
    height: Math.max(1, videoHeight),
  }
}

function syncCanvasStyleToVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const rect = video.getBoundingClientRect()
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`
}