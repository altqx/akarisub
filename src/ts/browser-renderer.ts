import {
  AkariSubAsyncRenderer,
  type AsyncRendererCreateOptions,
} from './async-renderer'
import type { FontConfig, FrameMargins, FrameSize } from './renderer'

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
}

export class AkariSubCanvasRenderer {
  private readonly renderer: AkariSubAsyncRenderer
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly video?: HTMLVideoElementWithRVFC
  private readonly resizeObserver?: ResizeObserver
  private readonly ownsCanvas: boolean
  private rafId: number | null = null
  private rvfcId: number | null = null
  private destroyed = false
  private rendering = false
  private autoRenderEnabled: boolean

  private constructor(
    renderer: AkariSubAsyncRenderer,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    video?: HTMLVideoElementWithRVFC,
    resizeObserver?: ResizeObserver,
    ownsCanvas = false,
    autoRender = true
  ) {
    this.renderer = renderer
    this.canvas = canvas
    this.ctx = ctx
    this.video = video
    this.resizeObserver = resizeObserver
    this.ownsCanvas = ownsCanvas
    this.autoRenderEnabled = autoRender
  }

  static async create(options: BrowserRendererOptions): Promise<AkariSubCanvasRenderer> {
    const ownsCanvas = !options.canvas
    const canvas = options.canvas ?? createOverlayCanvas(options.video)
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) {
      throw new Error('2D canvas rendering is not supported')
    }

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
      options.autoRender ?? true
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

  async loadTrackFromUtf8(trackContent: string): Promise<void> {
    await this.renderer.loadTrackFromUtf8(trackContent)
    await this.renderCurrentFrame(true)
  }

  async setFonts(fonts: FontConfig): Promise<void> {
    await this.renderer.setFonts(fonts)
  }

  async addFont(name: string, data: Uint8Array): Promise<void> {
    await this.renderer.addFont(name, data)
  }

  async clearTrack(): Promise<void> {
    await this.renderer.clearTrack()
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
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

  async renderCurrentFrame(force = false): Promise<void> {
    if (this.destroyed) return

    const timestampMs = this.video ? Math.round(this.video.currentTime * 1000) : 0
    const frame = await this.renderer.renderCompositedFrame(timestampMs, force)
    if (!frame) return

    const imageData = new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height)
    this.ctx.putImageData(imageData, 0, 0)
  }

  async syncCanvasToVideo(): Promise<void> {
    if (this.destroyed) return

    const frame = computeFrameSize(this.canvas, this.video)
    if (this.canvas.width !== frame.width) this.canvas.width = frame.width
    if (this.canvas.height !== frame.height) this.canvas.height = frame.height

    if (this.video) {
      syncCanvasStyleToVideo(this.canvas, this.video)
    }

    await this.renderer.configureCanvas(frame, frame)
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return

    this.destroyed = true
    this.stop()
    this.resizeObserver?.disconnect()
    await this.renderer.dispose()

    if (this.ownsCanvas) {
      this.canvas.remove()
    }
  }

  private scheduleNextFrame(): void {
    if (!this.rendering || this.destroyed) return

    if (this.video?.requestVideoFrameCallback) {
      this.rvfcId = this.video.requestVideoFrameCallback(async () => {
        this.rvfcId = null
        await this.renderCurrentFrame(false)
        this.scheduleNextFrame()
      })
      return
    }

    this.rafId = requestAnimationFrame(async () => {
      this.rafId = null
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