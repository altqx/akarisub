import type {
  AkariSubOptions,
  ASSEvent,
  ASSStyle,
  CueEvent,
  PerformanceStats,
  PerformanceWarning,
  PreloadedTrack,
  PreloadTrackSource,
  RenderEvent,
  RenderImage,
  RendererChangeEvent,
  RendererType,
  RenderTimes,
  VideoFrameCallbackMetadata,
  SubtitleColorSpace,
  WebYCbCrColorSpace,
  FrameTimeline,
  PresentVideoFrameOptions,
  VideoFrameLike
} from './types'
import type { EncryptedSubtitleContent } from './types'
import { classifyPerformanceWarnings, parsePreloadTrackSource } from './cue-events'
import { computeCanvasSize, getVideoPosition, fixAlpha, getAlphaBug, getBitmapBug } from './utils'
import {
  canvas2dContextSettings,
  createSubtitleImageData,
  defaultVideoColorProfile,
  getColorMatrix3,
  getColorSpaceFilterUrl,
  profileFromVideoFrameColorSpace,
  videoColorProfilesEqual,
  type CanvasColorSpace,
  type VideoColorProfile
} from './color-space'
import { selectWasmBinary } from './wasm-capabilities'
import { WebGPURenderer, isWebGPUSupported } from './webgpu-renderer'
import { WebGL2Renderer, isWebGL2Supported } from './webgl2-renderer'
import {
  compensatedMediaTime,
  compositorScheduleLeadMs,
  estimateRefreshIntervalMs,
  isStalePresentation,
  normalizeFrameTimeline,
  predictFrameDisplayTimeMs,
  presentedFrameIndex,
  presentationLeadSeconds,
  resolvePresentationMediaTime,
  selectRenderMediaTime,
  subtitleTimeForFrame,
  updateTimingCompensation
} from './timing'
import { isVideoFrameLike, videoFrameCallbackMetadata } from './video-frame'
import { getDefaultFontUrl, getMtWasmGlueUrl, getMtWasmUrl, getWasmGlueUrl, getWasmUrl } from './wasm'
import { webYCbCrMap } from './utils'

interface VideoFrameClock {
  currentTime: number
  paused: boolean
  rate: number
  width: number
  height: number
}

type AnyGPURenderer = WebGPURenderer | WebGL2Renderer

interface DemandMetadata {
  mediaTime: number
  width: number
  height: number
  expectedDisplayTime?: number
  force?: boolean
  presentationId?: number
  preparedPresentationAttempted?: boolean
}

interface DemandTiming {
  dispatchedAt: number
  renderEpoch: number
}

interface PreparedFrame {
  width: number
  height: number
  bitmap?: ImageBitmap
  stage?: HTMLCanvasElement
  index?: number
  time?: number
  targetDisplayTime?: number
  ready?: boolean
  scheduled?: boolean
  committed?: boolean
  replaceAll?: boolean
  animations?: Animation[]
}

interface PrepareRequest {
  index: number
  renderEpoch: number
  presentation?: DemandMetadata
}

const DEFAULT_RENDER_AHEAD = 0

const isLikelyWebKit = (): boolean => {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent || ''
  const vendor = navigator.vendor || ''
  const isIOSWebKit = /\b(iPhone|iPad|iPod)\b/i.test(userAgent)

  if (!/AppleWebKit/i.test(userAgent)) return false
  if (isIOSWebKit) return true

  if (/\b(Chrome|Chromium|Edg|OPR|SamsungBrowser|Firefox)\b/i.test(userAgent)) {
    return false
  }

  return vendor.includes('Apple')
}

/**
 * AkariSub - JavaScript ASS/SSA Subtitle Renderer
 *
 * Renders ASS/SSA subtitles on an HTML5 video element using libass compiled to WebAssembly.
 *
 * @example
 * ```typescript
 * const renderer = new AkariSub({
 *   video: document.querySelector('video'),
 *   subUrl: '/subtitles/example.ass'
 * });
 *
 * // Later, cleanup
 * renderer.destroy();
 * ```
 */
export default class AkariSub extends EventTarget {
  private static readonly MAX_PENDING_DEMANDS = 3
  private static readonly MAX_FONT_BYTES = 32 * 1024 * 1024

  private static _hasAlphaBug: boolean | null = null
  private static _hasBitmapBug: boolean | null = null

  private _loaded: Promise<void>
  private _init!: () => void
  private _destroyedSignal: Promise<void>
  private _resolveDestroyed!: () => void
  private _pendingWorkerRejectors = new Set<(error: Error) => void>()
  private _onDemandRender: boolean
  private _offscreenRender: boolean
  private _video?: HTMLVideoElement
  private _videoFrameClock: VideoFrameClock | null = null
  private _videoWidth: number = 0
  private _videoHeight: number = 0
  private _videoColorSpace: WebYCbCrColorSpace | null = null
  private _videoColorProfile: VideoColorProfile = defaultVideoColorProfile()
  private _lastSubtitleColorSpace: SubtitleColorSpace = null
  private _canvasColorSpaceOverride: CanvasColorSpace | 'auto'
  private _hdrOverride: boolean | 'auto'
  private _wasmSimd = false
  private _wasmThreads = false
  private _canvas!: HTMLCanvasElement
  private _canvasParent?: HTMLDivElement
  private _bufferCanvas: HTMLCanvasElement
  private _bufferCtx: CanvasRenderingContext2D
  private _canvasctrl!: HTMLCanvasElement | OffscreenCanvas
  private _ctx: CanvasRenderingContext2D | false | null = null
  private _lastRenderTime: number = 0
  private _playstate: boolean = true
  private _destroyed: boolean = false
  private _workerReady: boolean = false
  private _frameBufferReadyEvent: 'ready' | 'trackReady' | null = null
  private _ro?: ResizeObserver
  private _worker: Worker
  private _pendingDemandTimes: DemandMetadata[] = []
  private _demandTimings = new Map<number, DemandTiming>()
  private _adaptiveTiming: boolean
  private _frameTimeline: (Float64Array & { mediaTimeOrigin?: number; subtitleTimeOffset?: number }) | null
  private _preparedFrames = new Map<number, PreparedFrame>()
  private _stagedCanvases = new Set<HTMLCanvasElement>()
  private _stageFrameIndices = new Map<HTMLCanvasElement, number>()
  private _stageDisplayTimes = new Map<HTMLCanvasElement, number>()
  private _committedStage: HTMLCanvasElement | null = null
  private _scheduledPreparedFrame: PreparedFrame | null = null
  private _predictedDisplayTimes = new Map<number, number>()
  private _displayClockOffsets: number[] = []
  private _displayGridAnchorMs?: number
  private _lastClockMediaTime?: number
  private _lastClockPlaybackRate?: number
  private _lastPresentedFrameIndex?: number
  private _refreshSamples: number[] = []
  private _refreshRafHandle: number | null = null
  private _lastRefreshRafTime?: number
  private _prepareQueue: number[] = []
  private _prepareRequests = new Map<number, PrepareRequest>()
  private _nextPrepareId: number = 1
  private _prepareForce: boolean = true
  private _timingCompensationSeconds: number = 0
  private _rvfcHandle: number | null = null
  private _rvfcGeneration: number = 0
  private _renderEpoch: number = 0
  private _nextDemandId: number = 1
  private _nextPresentationId: number = 1
  private _latestPresentationId: number = 0
  private _nextFontRequestId: number = 1
  private readonly _isLikelyWebKit: boolean

  private _boundResize: () => void
  private _boundTimeUpdate: (e: Event) => void
  private _boundSetRate: () => void
  private _boundUpdateColorSpace: () => void
  private _boundHandleRVFC: (now: number, metadata: VideoFrameCallbackMetadata) => void

  private _gpuRenderer: AnyGPURenderer | null = null
  private _rendererType: RendererType = 'canvas2d'
  private _onCanvasFallback?: () => void
  private _onCueEnter?: (cue: CueEvent) => void
  private _onCueExit?: (cue: CueEvent) => void
  private _onRender?: (event: RenderEvent) => void
  private _onRendererChange?: (event: RendererChangeEvent) => void
  private _onPerformanceWarning?: (warning: PerformanceWarning) => void
  private _preloadedTrackId: number | null = null
  private _nextTrackRequestId = 1

  private _lastRenderWidth: number = 0
  private _lastRenderHeight: number = 0
  private _gpuBitmapImages: Array<{ image: ImageBitmap; x: number; y: number }> = []

  /** Seconds added to video time when sampling the track. */
  public timeOffset: number
  /** When true, the worker prints libass and renderer logs. */
  public debug: boolean
  /** Extra scale applied to the subtitle canvas before height limits. */
  public prescaleFactor: number
  /** Maximum canvas height that still receives `prescaleFactor`. */
  public prescaleHeightLimit: number
  /** Hard cap on render height; `0` means unlimited. */
  public maxRenderHeight: number
  /** True while the worker is rendering a demand frame. */
  public busy: boolean = false
  /** Extra seconds of subtitle lookahead on top of adaptive timing. */
  public renderAhead: number
  /** Exact timeline frames to prepare ahead of the playhead. */
  public framePrefetch: number

  /**
   * Create a renderer and start loading the WASM worker.
   *
   * @param options Video or canvas target plus optional fonts and track.
   */
  constructor(options: AkariSubOptions) {
    super()

    this._destroyedSignal = new Promise((resolve) => {
      this._resolveDestroyed = resolve
    })

    if (!globalThis.Worker) {
      throw this.destroy(new Error('Worker not supported'))
    }
    if (!options) {
      throw this.destroy(new Error('No options provided'))
    }

    for (const [index, font] of (options.fonts ?? []).entries()) {
      if (typeof font !== 'string' && font.byteLength > AkariSub.MAX_FONT_BYTES) {
        throw new Error(`Font ${index + 1} exceeds the 32 MiB per-font limit`)
      }
    }
    for (const [name, font] of Object.entries(options.availableFonts ?? {})) {
      if (typeof font !== 'string' && font.byteLength > AkariSub.MAX_FONT_BYTES) {
        throw new Error(`Font ${name} exceeds the 32 MiB per-font limit`)
      }
    }

    this._loaded = new Promise((resolve) => {
      this._init = resolve
    })

    this._isLikelyWebKit = isLikelyWebKit()
    this._canvasColorSpaceOverride = options.canvasColorSpace ?? 'auto'
    this._hdrOverride = options.hdr ?? 'auto'

    const test = AkariSub._test()

    const hasRVFC = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype
    const wantsOnDemand = options.onDemandRender ?? true
    this._onDemandRender = wantsOnDemand && (hasRVFC || (options.video == null && options.onDemandRender === true))
    this._adaptiveTiming = options.adaptiveTiming ?? true
    this._frameTimeline = options.frameTimeline ? normalizeFrameTimeline(options.frameTimeline) : null

    this._onCanvasFallback = options.onCanvasFallback
    this._onCueEnter = options.onCueEnter
    this._onCueExit = options.onCueExit
    this._onRender = options.onRender
    this._onRendererChange = options.onRendererChange
    this._onPerformanceWarning = options.onPerformanceWarning

    const isCustomCanvas = !!options.canvas
    const rawAssImageGpu = options.rawAssImageGpu ?? false
    const wantsOffscreenRender = options.offscreenRender ?? !isCustomCanvas
    const canTransferOffscreen = 'transferControlToOffscreen' in HTMLCanvasElement.prototype
    const canUseGPURenderer = !this._isLikelyWebKit && !isCustomCanvas && (isWebGPUSupported() || isWebGL2Supported())
    const shouldUseAsyncRender =
      typeof createImageBitmap !== 'undefined' && (options.asyncRender ?? (!this._isLikelyWebKit && !canUseGPURenderer))

    // Keep caller-owned canvases on the main thread by default. Worker-side raw
    // ASS composition remains opt-in because it regresses several ordinary and
    // animation-heavy custom-canvas workloads despite helping dense overlays.
    this._offscreenRender = canTransferOffscreen && !canUseGPURenderer && wantsOffscreenRender

    this.timeOffset = options.timeOffset || 0
    this._video = options.video
    this._canvas = options.canvas!

    if (this._video && !this._canvas) {
      this._canvasParent = document.createElement('div')
      this._canvasParent.className = 'AkariSub'
      this._canvasParent.style.position = 'relative'
      this._canvasParent.style.zIndex = '1'
      this._canvasParent.style.isolation = 'isolate'
      this._canvasParent.style.pointerEvents = 'none'
      this._canvas = this._createCanvas()
      this._video.insertAdjacentElement('afterend', this._canvasParent)
    } else if (!this._canvas) {
      throw this.destroy(new Error("Don't know where to render: you should give video or canvas in options."))
    }

    this._startRefreshSampling()

    this._bufferCanvas = document.createElement('canvas')
    const bufferCtx = this._bufferCanvas.getContext('2d', this._canvas2dSettings(false))
    if (!bufferCtx) throw this.destroy(new Error('Canvas rendering not supported'))
    this._bufferCtx = bufferCtx

    if (canUseGPURenderer) {
      this._initGPURenderer()
    } else if (!this._offscreenRender) {
      this._ctx = this._canvas.getContext('2d', this._canvas2dSettings())
    }

    this._canvasctrl = this._offscreenRender
      ? (
          this._canvas as HTMLCanvasElement & { transferControlToOffscreen(): OffscreenCanvas }
        ).transferControlToOffscreen()
      : this._canvas

    this._lastRenderTime = 0
    this.debug = !!options.debug
    this.prescaleFactor = options.prescaleFactor || 1.0
    this.prescaleHeightLimit = options.prescaleHeightLimit || 1080
    this.maxRenderHeight = options.maxRenderHeight || 0
    this.renderAhead = options.renderAhead ?? DEFAULT_RENDER_AHEAD
    this.framePrefetch = Math.max(0, Math.min(24, Math.floor(options.framePrefetch ?? 2)))

    this._boundResize = this.resize.bind(this)
    this._boundTimeUpdate = this._timeupdate.bind(this)
    this._boundSetRate = () => this._syncVideoClock(new Event('ratechange'))
    this._boundUpdateColorSpace = this._updateColorSpace.bind(this)
    this._boundHandleRVFC = this._handleRVFC.bind(this)

    if (this._video) {
      this.setVideo(this._video)
    }

    if (this._onDemandRender) {
      this.busy = false
      this._pendingDemandTimes.length = 0
    }

    this._worker = options.workerUrl
      ? new Worker(options.workerUrl, { type: 'module' })
      : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    this._worker.onmessage = (e) => this._onmessage(e)
    this._worker.onerror = (e) => this._error(e)

    test.then(() => {
      const wasmBinary = selectWasmBinary({
        wasmUrl: options.wasmUrl ?? getWasmUrl(),
        glueUrl: options.glueUrl ?? getWasmGlueUrl(),
        modernWasmUrl: options.modernWasmUrl,
        modernGlueUrl: options.modernGlueUrl,
        mtWasmUrl: options.mtWasmUrl ?? getMtWasmUrl(),
        mtGlueUrl: options.mtGlueUrl ?? getMtWasmGlueUrl()
      })
      this._wasmSimd = wasmBinary.simd
      this._wasmThreads = wasmBinary.threads

      const initialTime = (this._video?.currentTime ?? 0) + this.timeOffset
      const initialPlaybackRate = this._videoPlaybackRateForWorker()
      const initMessage = {
        target: 'init',
        wasmUrl: wasmBinary.wasmUrl,
        glueUrl: wasmBinary.glueUrl,
        canvasColorSpace: this._videoColorProfile.canvasColorSpace,
        hdr: this._shouldUseHdr(),
        wasmSimd: wasmBinary.simd,
        wasmThreads: wasmBinary.threads,
        asyncRender: shouldUseAsyncRender,
        fullTrackWarmup: options.fullTrackWarmup ?? false,
        blockingFullTrackWarmup: options.blockingFullTrackWarmup ?? false,
        fullTrackWarmupStep: options.fullTrackWarmupStep ?? 1,
        adaptiveBlendLayouts: options.adaptiveBlendLayouts ?? false,
        rawAssImageGpu,
        onDemandRender: this._onDemandRender,
        initialTime,
        initialIsPaused: this._isVideoPausedForWorker(),
        initialPlaybackRate,
        initialTimeSnapshotAtMs: Date.now(),
        width: this._canvasctrl.width || 0,
        height: this._canvasctrl.height || 0,
        blendMode: options.blendMode ?? 'wasm',
        subUrl: options.subUrl,
        subContent: options.subContent || null,
        encryptedSubContent: options.encryptedSubContent || null,
        fonts: options.fonts || [],
        availableFonts: options.availableFonts || { 'liberation sans': getDefaultFontUrl() },
        fallbackFonts: options.fallbackFonts || ['liberation sans'],
        debug: this.debug,
        targetFps: options.targetFps || 24,
        renderAhead: this.renderAhead,
        adaptiveTiming: this._adaptiveTiming,
        frameTimelineMode: this._frameTimeline != null && this.framePrefetch > 0,
        dropAllAnimations: options.dropAllAnimations,
        dropAllBlur: options.dropAllBlur,
        clampPos: options.clampPos,
        libassMemoryLimit: options.libassMemoryLimit ?? 128,
        libassGlyphLimit: options.libassGlyphLimit ?? 2048,
        useLocalFonts: typeof (globalThis as any).queryLocalFonts !== 'undefined' && (options.useLocalFonts ?? true),
        useFontconfigProvider: options.useFontconfigProvider ?? true,
        hasBitmapBug: AkariSub._hasBitmapBug
      }

      this._worker.postMessage(
        initMessage,
        AkariSub._getSubtitleTransfers(options.subContent, options.encryptedSubContent)
      )

      if (this._offscreenRender) {
        const offscreenCanvas = this._canvasctrl as OffscreenCanvas
        // Post this immediately after init, before the worker can emit ready and
        // trigger an on-demand render. sendMessage() waits for ready and races
        // the first render, leaving offscreenRender=true with no canvas bound.
        this._worker.postMessage(
          {
            target: 'offscreenCanvas',
            rawAssImageGpu,
            canvasColorSpace: this._videoColorProfile.canvasColorSpace,
            hdr: this._shouldUseHdr(),
            transferable: [offscreenCanvas]
          },
          [offscreenCanvas]
        )
      }
    })
  }

  /** @internal */
  private static async _testImageBugs(): Promise<void> {
    if (AkariSub._hasBitmapBug !== null) return

    const canvas1 = document.createElement('canvas')
    const ctx1 = canvas1.getContext('2d', { willReadFrequently: true })
    if (!ctx1) throw new Error('Canvas rendering not supported')

    if (typeof ImageData.prototype.constructor === 'function') {
      try {
        new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1)
      } catch {
        console.log('Detected that ImageData is not constructable despite browser saying so')
      }
    }

    const canvas2 = document.createElement('canvas')
    const ctx2 = canvas2.getContext('2d', { willReadFrequently: true })
    if (!ctx2) throw new Error('Canvas rendering not supported')

    canvas1.width = canvas2.width = 1
    canvas1.height = canvas2.height = 1
    ctx1.clearRect(0, 0, 1, 1)
    ctx2.clearRect(0, 0, 1, 1)

    const prePut = ctx2.getImageData(0, 0, 1, 1).data
    ctx1.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0)
    ctx2.drawImage(canvas1, 0, 0)
    const postPut = ctx2.getImageData(0, 0, 1, 1).data

    AkariSub._hasAlphaBug = prePut[1] !== postPut[1]
    if (AkariSub._hasAlphaBug) {
      console.log('Detected a browser having issue with transparent pixels, applying workaround')
    }

    if (typeof createImageBitmap !== 'undefined') {
      const subarray = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5)
      ctx2.drawImage(await createImageBitmap(new ImageData(subarray, 1)), 0, 0)
      const { data } = ctx2.getImageData(0, 0, 1, 1)
      AkariSub._hasBitmapBug = false

      for (let i = 0; i < data.length; i++) {
        if (Math.abs(subarray[i] - data[i]) > 15) {
          AkariSub._hasBitmapBug = true
          console.log('Detected a browser having issue with partial bitmaps, applying workaround')
          break
        }
      }
    } else {
      AkariSub._hasBitmapBug = false
    }

    canvas1.remove()
    canvas2.remove()
  }

  /** @internal */
  private static async _test(): Promise<void> {
    await AkariSub._testImageBugs()
  }

  /** @internal */
  private static _getSubtitleTransfers(
    subContent?: string | Uint8Array | ArrayBuffer,
    encryptedSubContent?: EncryptedSubtitleContent
  ): Transferable[] {
    const transfers: Transferable[] = []

    if (subContent instanceof ArrayBuffer) {
      transfers.push(subContent)
    } else if (subContent instanceof Uint8Array) {
      transfers.push(subContent.buffer)
    }

    if (encryptedSubContent?.encrypted) {
      transfers.push(encryptedSubContent.encrypted)
    }

    for (const chunk of encryptedSubContent?.encryptedChunks || []) {
      transfers.push(chunk)
    }

    return transfers
  }

  /** @internal */
  private async _initGPURenderer(): Promise<void> {
    if (isWebGPUSupported()) {
      try {
        const renderer = new WebGPURenderer()
        await renderer.init()
        if (!this._canvas || this._destroyed) {
          renderer.destroy()
          return
        }
        await renderer.setCanvas(
          this._canvas,
          Math.max(1, this._canvas.width || 1),
          Math.max(1, this._canvas.height || 1)
        )
        if (this._destroyed) {
          renderer.destroy()
          return
        }
        this._gpuRenderer = renderer
        this._setRendererType('webgpu')
        this._applyGpuColorManagement()
        console.log('[AkariSub] Using WebGPU renderer')
        return
      } catch (error) {
        console.warn('[AkariSub] WebGPU init failed, trying WebGL2:', error)
      }
    }

    if (isWebGL2Supported()) {
      try {
        const renderer = new WebGL2Renderer()
        await renderer.init()
        if (!this._canvas || this._destroyed) {
          renderer.destroy()
          return
        }
        await renderer.setCanvas(
          this._canvas,
          Math.max(1, this._canvas.width || 1),
          Math.max(1, this._canvas.height || 1)
        )
        if (this._destroyed) {
          renderer.destroy()
          return
        }
        this._gpuRenderer = renderer
        this._setRendererType('webgl2')
        this._applyGpuColorManagement()
        console.log('[AkariSub] Using WebGL2 renderer')
        return
      } catch (error) {
        console.warn('[AkariSub] WebGL2 init failed, falling back to Canvas2D:', error)
      }
    }

    this._setRendererType('canvas2d')
    if (!this._offscreenRender && !this._ctx) {
      this._ctx = this._canvas.getContext('2d', this._canvas2dSettings())
    }
    this.sendMessage('setAsyncRender', { value: false })
    this._onCanvasFallback?.()
  }

  /** Active compositor: WebGPU, WebGL2, or Canvas2D. */
  get rendererType(): RendererType {
    return this._rendererType
  }

  /** @deprecated Use rendererType === 'webgpu' */
  get isUsingWebGPU(): boolean {
    return this._rendererType === 'webgpu'
  }

  /** True when WebGPU or WebGL2 is compositing bitmaps. */
  get isUsingGPURenderer(): boolean {
    return this._gpuRenderer !== null
  }

  /** @internal */
  private _setRendererType(next: RendererType): void {
    const previous = this._rendererType
    if (previous === next || this._destroyed) return
    this._rendererType = next
    const event: RendererChangeEvent = { rendererType: next, previous }
    this._onRendererChange?.(event)
    this.dispatchEvent(new CustomEvent('rendererChange', { detail: event }))
  }

  /** @internal */
  private _shouldUseHdr(): boolean {
    if (this._hdrOverride === false) return false
    if (this._hdrOverride === true) return true
    return this._videoColorProfile.hdr
  }

  /** @internal */
  private _canvas2dSettings(hdr: boolean = this._shouldUseHdr()): CanvasRenderingContext2DSettings {
    return canvas2dContextSettings({
      colorSpace: this._videoColorProfile.canvasColorSpace,
      hdr,
      alpha: true
    })
  }

  /** @internal */
  private _applyGpuColorManagement(): void {
    const matrix = getColorMatrix3(this._lastSubtitleColorSpace, this._videoColorProfile.matrix)
    if (this._gpuRenderer instanceof WebGPURenderer) {
      this._gpuRenderer.setColorManagement(matrix, this._videoColorProfile.canvasColorSpace, this._shouldUseHdr())
    } else if (this._gpuRenderer instanceof WebGL2Renderer) {
      this._gpuRenderer.setColorManagement(matrix, this._videoColorProfile.canvasColorSpace)
    }
  }

  /** @internal */
  private _createCanvas(): HTMLCanvasElement {
    this._canvas = document.createElement('canvas')
    this._canvas.style.display = 'block'
    this._canvas.style.position = 'absolute'
    this._canvas.style.pointerEvents = 'none'
    this._canvas.style.zIndex = '0'
    this._canvasParent!.appendChild(this._canvas)
    return this._canvas
  }

  /**
   * Resize the overlay canvas.
   *
   * When `width` or `height` is `0` and a video is attached, the overlay is
   * fitted to the letterboxed video rectangle.
   */
  resize(
    width: number = 0,
    height: number = 0,
    top: number = 0,
    left: number = 0,
    force: boolean = this._video?.paused ?? false
  ): void {
    if ((!width || !height) && this._video) {
      const videoSize = getVideoPosition(this._video)
      let renderSize: { width: number; height: number }

      if (this._videoWidth) {
        const widthRatio = this._video.videoWidth / this._videoWidth
        const heightRatio = this._video.videoHeight / this._videoHeight
        renderSize = computeCanvasSize(
          (videoSize.width || 0) / widthRatio,
          (videoSize.height || 0) / heightRatio,
          this.prescaleFactor,
          this.prescaleHeightLimit,
          this.maxRenderHeight
        )
      } else {
        renderSize = computeCanvasSize(
          videoSize.width || 0,
          videoSize.height || 0,
          this.prescaleFactor,
          this.prescaleHeightLimit,
          this.maxRenderHeight
        )
      }

      width = renderSize.width
      height = renderSize.height

      if (this._canvasParent) {
        top = videoSize.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top)
        left = videoSize.x
      }

      this._canvas.style.width = videoSize.width + 'px'
      this._canvas.style.height = videoSize.height + 'px'
    }

    this._canvas.style.top = top + 'px'
    this._canvas.style.left = left + 'px'
    for (const stage of this._stagedCanvases) this._syncStagedCanvasLayout(stage)

    if (width > 0 && height > 0 && (this._canvasctrl.width !== width || this._canvasctrl.height !== height)) {
      this._bumpRenderEpoch()
      this._canvasctrl.width = width
      this._canvasctrl.height = height
    }

    if (this._gpuRenderer && width > 0 && height > 0) {
      this._gpuRenderer.updateSize(width, height)
    }

    if (force && this.busy === false) {
      this.busy = true
    } else {
      force = false
    }

    const storageWidth = this._videoWidth || this._video?.videoWidth || width || this._canvasctrl.width || 0
    const storageHeight = this._videoHeight || this._video?.videoHeight || height || this._canvasctrl.height || 0

    this.sendMessage('canvas', {
      width,
      height,
      videoWidth: storageWidth,
      videoHeight: storageHeight,
      force
    })
  }

  /** @internal */
  private _timeupdate(event: Event): void {
    this._syncVideoClock(event)
  }

  /** Attach a video element and subscribe to its playback and resize events. */
  setVideo(video: HTMLVideoElement): void {
    if (video instanceof HTMLVideoElement) {
      this._removeListeners()
      this._videoFrameClock = null
      this._video = video
      this._playstate = video.paused || video.ended

      if (this._onDemandRender) {
        if (!this._destroyed && this._video === video) {
          this._scheduleRVFC(video)
        }
      } else {
        video.addEventListener('resize', this._boundResize, false)
      }

      video.addEventListener('timeupdate', this._boundTimeUpdate, false)
      video.addEventListener('progress', this._boundTimeUpdate, false)
      video.addEventListener('play', this._boundTimeUpdate, false)
      video.addEventListener('playing', this._boundTimeUpdate, false)
      video.addEventListener('pause', this._boundTimeUpdate, false)
      video.addEventListener('ended', this._boundTimeUpdate, false)
      video.addEventListener('waiting', this._boundTimeUpdate, false)
      video.addEventListener('stalled', this._boundTimeUpdate, false)
      video.addEventListener('seeking', this._boundTimeUpdate, false)
      video.addEventListener('seeked', this._boundTimeUpdate, false)
      video.addEventListener('ratechange', this._boundSetRate, false)

      if ('VideoFrame' in window) {
        video.addEventListener('loadedmetadata', this._boundUpdateColorSpace, false)
        if (video.readyState > 2) this._updateColorSpace()
      }

      if (video.videoWidth > 0) this.resize()

      this._syncVideoClock()

      if (typeof ResizeObserver !== 'undefined') {
        if (!this._ro) this._ro = new ResizeObserver(() => this.resize())
        this._ro.observe(video)
      }
    } else {
      this._error(new Error('Video element invalid!'))
    }
  }

  /**
   * Present a decoded WebCodecs `VideoFrame` as the current video clock.
   *
   * Uses the same demand, prefetch, and frame-timeline path as
   * `requestVideoFrameCallback`. Does not take ownership of `frame`; the caller
   * must `close()` it. Canvas-only WebCodecs players should pass `canvas` at
   * construction and leave `onDemandRender` enabled, or set it `true` when the
   * browser has no `requestVideoFrameCallback`.
   */
  presentVideoFrame(frame: VideoFrameLike, options: PresentVideoFrameOptions = {}): void {
    if (this._destroyed) return
    if (!isVideoFrameLike(frame)) {
      this._error(new Error('VideoFrame invalid!'))
      return
    }

    const metadata = videoFrameCallbackMetadata(frame, options)
    const previous = this._videoFrameClock
    const isPaused = options.isPaused ?? previous?.paused ?? false
    const rate = Number.isFinite(options.rate) ? options.rate! : (previous?.rate ?? 1)

    this._videoFrameClock = {
      currentTime: metadata.mediaTime,
      paused: isPaused,
      rate,
      width: metadata.width,
      height: metadata.height
    }
    this._playstate = isPaused
    this._setVideoColorProfile(profileFromVideoFrameColorSpace(frame.colorSpace, this._canvasColorSpaceOverride))
    this.setCurrentTime(isPaused, metadata.mediaTime + this.timeOffset, rate)

    if (this._onDemandRender) {
      this._handleRVFC(Number.isFinite(options.now) ? options.now! : (metadata.presentationTime ?? 0), metadata)
    }
  }

  /**
   * Set the video YCbCr matrix used for subtitle color conversion.
   *
   * Accepts `'BT709'` / `'BT601'`, a WebCodecs matrix name such as `'bt709'`,
   * or a `VideoFrame.colorSpace` object. Pass `null` to clear the override.
   */
  setVideoColorSpace(colorSpace: WebYCbCrColorSpace | VideoFrameLike['colorSpace'] | string | null): void {
    if (colorSpace === 'BT709' || colorSpace === 'BT601' || colorSpace === 'BT2020') {
      this._setVideoColorSpace(colorSpace)
      return
    }
    if (colorSpace == null || typeof colorSpace === 'string') {
      this._setVideoColorSpace(typeof colorSpace === 'string' ? (webYCbCrMap[colorSpace] ?? null) : null)
      return
    }
    this._setVideoColorProfile(profileFromVideoFrameColorSpace(colorSpace, this._canvasColorSpaceOverride))
  }

  /** Fetch and load an ASS/SSA track from `url`. */
  setTrackByUrl(url: string): void {
    this._bumpRenderEpoch()
    this.sendMessage('setTrackByUrl', { url })
    this._reAttachOffscreen()
    if (this._ctx) this._ctx.filter = 'none'
  }

  /** Replace the current track with ASS/SSA text or bytes. */
  setTrack(content: string | Uint8Array | ArrayBuffer): void {
    this._bumpRenderEpoch()
    this.sendMessage('setTrack', { content }, AkariSub._getSubtitleTransfers(content))
    this._reAttachOffscreen()
    if (this._ctx) this._ctx.filter = 'none'
  }

  /**
   * Overwrites the current subtitle content with encrypted v2 payloads.
   * Decryption happens inside the AkariSub worker so plaintext ASS text is not
   * materialized in the main thread.
   */
  setEncryptedTrack(content: EncryptedSubtitleContent): void {
    this._bumpRenderEpoch()
    this.sendMessage('setEncryptedTrack', { content }, AkariSub._getSubtitleTransfers(undefined, content))
    this._reAttachOffscreen()
    if (this._ctx) this._ctx.filter = 'none'
  }

  /** Unload the current track without destroying the renderer. */
  freeTrack(): void {
    this._sendMutatingMessage('freeTrack')
  }

  /**
   * Fetch, parse, and load fonts for a track without replacing the visible
   * one. Call {@linkcode activatePreloadedTrack} to swap atomically.
   */
  async preloadTrack(source: PreloadTrackSource | string | Uint8Array | ArrayBuffer): Promise<PreloadedTrack> {
    const parsed = parsePreloadTrackSource(source)
    const ready =
      this._workerReady ||
      (await Promise.race([this._loaded.then(() => true), this._destroyedSignal.then(() => false)]))
    if (!ready || this._destroyed) throw new Error('Renderer was destroyed before the track could be preloaded')

    const requestId = this._nextTrackRequestId++
    const transfers =
      parsed.kind === 'content'
        ? AkariSub._getSubtitleTransfers(parsed.content)
        : parsed.kind === 'encrypted'
          ? AkariSub._getSubtitleTransfers(undefined, parsed.content)
          : []

    const result = await this._fetchFromWorker<{ success: boolean; id?: number; error?: string }>({
      target: 'preloadTrack',
      requestId,
      source: parsed,
      timeoutMs: null,
      transferable: transfers
    })
    if (!result.success || result.id == null) {
      throw new Error(result.error || 'The renderer rejected the preloaded track')
    }
    this._preloadedTrackId = result.id
    return { id: result.id }
  }

  /**
   * Replace the visible track with a previously preloaded one. The last
   * painted frame stays on screen until the new track's first frame is ready.
   */
  async activatePreloadedTrack(id: number = this._preloadedTrackId ?? -1): Promise<PreloadedTrack> {
    const ready =
      this._workerReady ||
      (await Promise.race([this._loaded.then(() => true), this._destroyedSignal.then(() => false)]))
    if (!ready || this._destroyed) throw new Error('Renderer was destroyed before the track could be activated')
    if (id < 0) throw new Error('No preloaded track is ready')

    this._bumpRenderEpoch()
    const requestId = this._nextTrackRequestId++
    const result = await this._fetchFromWorker<{ success: boolean; id?: number; error?: string }>({
      target: 'activatePreloadedTrack',
      requestId,
      id,
      timeoutMs: null
    })
    if (!result.success || result.id == null) {
      throw new Error(result.error || 'The preloaded track could not be activated')
    }
    if (this._preloadedTrackId === result.id) this._preloadedTrackId = null
    this._reAttachOffscreen()
    if (this._ctx) this._ctx.filter = 'none'
    this._syncVideoClock()
    return { id: result.id }
  }

  /** Tell the worker whether playback is paused. Ignored when a video element is attached. */
  setIsPaused(isPaused: boolean): void {
    if (this._video) {
      this._playstate = isPaused
      this._syncVideoClock()
      return
    }

    if (this._videoFrameClock) {
      this._videoFrameClock.paused = isPaused
      this._playstate = isPaused
    }

    this.sendMessage('video', { isPaused })
  }

  /** Tell the worker the playback rate. Ignored when a video element is attached. */
  setRate(rate: number): void {
    if (this._video) {
      this.setCurrentTime(this._isVideoPausedForWorker(), this._currentVideoTimeWithOffset(), rate)
      return
    }

    if (this._videoFrameClock && Number.isFinite(rate)) this._videoFrameClock.rate = rate

    this.sendMessage('video', { rate })
  }

  /**
   * Push a manual clock sample to the worker.
   *
   * Omit fields to keep the last known paused state, time, or rate.
   */
  setCurrentTime(isPaused?: boolean, currentTime?: number, rate?: number): void {
    if (!this._video && this._videoFrameClock) {
      if (isPaused != null) {
        this._videoFrameClock.paused = isPaused
        this._playstate = isPaused
      }
      if (currentTime != null && Number.isFinite(currentTime)) {
        this._videoFrameClock.currentTime = currentTime - this.timeOffset
      }
      if (rate != null && Number.isFinite(rate)) this._videoFrameClock.rate = rate
    }

    this.sendMessage('video', {
      isPaused,
      currentTime,
      rate,
      renderAhead: this.renderAhead,
      colorSpace: this._videoColorSpace
    })
  }

  /** Append a Dialogue event to the loaded track. */
  createEvent(event: Partial<ASSEvent>): void {
    this._sendMutatingMessage('createEvent', { event })
  }

  /** Overwrite the event at `index`. */
  setEvent(event: Partial<ASSEvent>, index: number): void {
    this._sendMutatingMessage('setEvent', { event, index })
  }

  /** Delete the event at `index`. */
  removeEvent(index: number): void {
    this._sendMutatingMessage('removeEvent', { index })
  }

  /** Return a snapshot of every event in the loaded track. */
  async getEvents(): Promise<ASSEvent[]> {
    const data = await this._fetchFromWorker<{ events: ASSEvent[] }>({ target: 'getEvents' })
    return data.events ?? []
  }

  /** Force a style onto every event until {@linkcode disableStyleOverride}. */
  styleOverride(style: Partial<ASSStyle>): void {
    this._sendMutatingMessage('styleOverride', { style })
  }

  /** Clear a style override previously set with {@linkcode styleOverride}. */
  disableStyleOverride(): void {
    this._sendMutatingMessage('disableStyleOverride')
  }

  /** Append a style to the loaded track. */
  createStyle(style: Partial<ASSStyle>): void {
    this._sendMutatingMessage('createStyle', { style })
  }

  /** Overwrite the style at `index`. */
  setStyle(style: Partial<ASSStyle>, index: number): void {
    this._sendMutatingMessage('setStyle', { style, index })
  }

  /** Delete the style at `index`. */
  removeStyle(index: number): void {
    this._sendMutatingMessage('removeStyle', { index })
  }

  /** Return a snapshot of every style in the loaded track. */
  async getStyles(): Promise<ASSStyle[]> {
    const data = await this._fetchFromWorker<{ styles: ASSStyle[] }>({ target: 'getStyles' })
    return data.styles ?? []
  }

  /** Register a font URL or file. Fonts larger than 32 MiB are rejected. */
  async addFont(font: string | Uint8Array): Promise<void> {
    this._bumpRenderEpoch()
    if (typeof font !== 'string' && font.byteLength > AkariSub.MAX_FONT_BYTES) {
      throw new Error('Font files are limited to 32 MiB')
    }
    const ready =
      this._workerReady ||
      (await Promise.race([this._loaded.then(() => true), this._destroyedSignal.then(() => false)]))
    if (!ready || this._destroyed) throw new Error('Renderer was destroyed before the font could be added')
    const requestId = this._nextFontRequestId++
    const result = await this._fetchFromWorker<{ success: boolean; error?: string }>({
      target: 'addFont',
      font,
      requestId,
      timeoutMs: null
    })
    if (!result.success) throw new Error(result.error || 'The renderer rejected the font')
    this._syncVideoClock()
  }

  /** Set the default font family used when a style font is missing. */
  setDefaultFont(font: string): void {
    this._sendMutatingMessage('defaultFont', { font })
  }

  /** Return renderer throughput and latency counters. */
  async getStats(): Promise<PerformanceStats> {
    const data = await this._fetchFromWorker<{ stats: Partial<PerformanceStats> }>({ target: 'getStats' })
    const stats = data.stats ?? {}
    return {
      framesRendered: stats.framesRendered ?? 0,
      framesDropped: stats.framesDropped ?? 0,
      avgRenderTime: stats.avgRenderTime ?? 0,
      maxRenderTime: stats.maxRenderTime ?? 0,
      minRenderTime: stats.minRenderTime ?? 0,
      lastRenderTime: stats.lastRenderTime ?? 0,
      timingCompensationMs: this._onDemandRender
        ? Math.round(this._timingCompensationSeconds * 100_000) / 100
        : stats.timingCompensationMs,
      lastImageCount: stats.lastImageCount,
      lastImagePixels: stats.lastImagePixels,
      pendingRenders: stats.pendingRenders ?? 0,
      totalEvents: stats.totalEvents ?? 0,
      cacheHits: stats.cacheHits ?? 0,
      cacheMisses: stats.cacheMisses ?? 0,
      renderFps: stats.avgRenderTime && stats.avgRenderTime > 0 ? Math.round(1000 / stats.avgRenderTime) : 0,
      usingWorker: stats.usingWorker ?? true,
      rawAssImageGpu: stats.rawAssImageGpu,
      workerRenderer: stats.workerRenderer,
      offscreenRender: stats.offscreenRender ?? this._offscreenRender,
      onDemandRender: stats.onDemandRender ?? this._onDemandRender,
      wasmSimd: stats.wasmSimd ?? this._wasmSimd,
      wasmThreads: stats.wasmThreads ?? this._wasmThreads,
      canvasColorSpace: this._videoColorProfile.canvasColorSpace,
      videoTransfer: this._videoColorProfile.transfer,
      videoPrimaries: this._videoColorProfile.primaries
    }
  }

  /** Zero the worker-side performance counters. */
  async resetStats(): Promise<void> {
    await this._fetchFromWorker({ target: 'resetStats' })
  }

  /**
   * Set encoded video-frame timestamps used to snap live predictions to exact
   * libass sampling times. Pass null to return to continuous-time prediction.
   */
  setFrameTimeline(frameTimes: FrameTimeline | null): void {
    this._frameTimeline = frameTimes ? normalizeFrameTimeline(frameTimes) : null
    if (this._frameTimeline) this._startRefreshSampling()
    this._bumpRenderEpoch()
    void this.sendMessage('frameTimelineMode', {
      enabled: this._frameTimeline != null && this.framePrefetch > 0
    })
    this._syncVideoClock()
    this._primePreparedFrames(this._currentExactFrameMediaTime())
    this._dispatchNextPreparation()
  }

  /** Number of events in the loaded track. */
  async getEventCount(): Promise<number> {
    const data = await this._fetchFromWorker<{ count: number }>({ target: 'getEventCount' })
    return data.count
  }

  /** Number of styles in the loaded track. */
  async getStyleCount(): Promise<number> {
    const data = await this._fetchFromWorker<{ count: number }>({ target: 'getStyleCount' })
    return data.count
  }

  /** @internal */
  private async _sendLocalFont(name: string): Promise<void> {
    let success = false
    try {
      const fontData = await (globalThis as any).queryLocalFonts()
      const font = fontData?.find((obj: any) => obj.fullName.toLowerCase() === name)
      if (font) {
        const blob = await font.blob()
        const buffer = await blob.arrayBuffer()
        await this.addFont(new Uint8Array(buffer))
        success = true
      }
    } catch (error) {
      console.warn('Local fonts API:', error)
    } finally {
      if (!this._destroyed) {
        void this.sendMessage('localFontResult', { font: name, success }).catch((error) => {
          if (!this._destroyed) console.warn('Local font result:', error)
        })
      }
    }
  }

  /** @internal */
  private _getLocalFont(data: { font: string }): void {
    try {
      if (navigator?.permissions?.query) {
        ;(navigator.permissions.query as any)({ name: 'local-fonts' }).then((permission: any) => {
          if (permission.state === 'granted') {
            void this._sendLocalFont(data.font)
          }
        })
      } else {
        void this._sendLocalFont(data.font)
      }
    } catch (e) {
      console.warn('Local fonts API:', e)
    }
  }

  /** @internal */
  private _unbusy(
    data: { requestId?: number; renderEpoch?: number; painted?: boolean; images?: RenderImage[] } = {},
    observeDemandCompletion: boolean = true
  ): void {
    if (observeDemandCompletion) {
      this._observeDemandCompletion(data.requestId, data.renderEpoch, data.painted === true || data.images != null)
    }
    this._prepareForce = true

    this._finishWorkerSlot()
  }

  /** @internal */
  private _finishWorkerSlot(): void {
    if (this._pendingDemandTimes.length > 0) {
      if (this._pendingDemandTimes.length > 1) {
        const latestDemand = this._pendingDemandTimes[this._pendingDemandTimes.length - 1]
        latestDemand.force = latestDemand.force || this._pendingDemandTimes.some((demand) => demand.force)
        this._pendingDemandTimes.length = 0
        this._pendingDemandTimes.push(latestDemand)
      }

      const nextDemand = this._pendingDemandTimes.shift()
      if (nextDemand) {
        if (!this._tryPresentPreparedDemand(nextDemand)) {
          this._demandRender(nextDemand)
          return
        }
      }
    }

    this.busy = false
    this._primePreparedFrames(this._currentExactFrameMediaTime())
    this._dispatchNextPreparation()
    this._dispatchReadyWhenFrameBufferFilled()
  }

  /** @internal */
  private _tryPresentPreparedDemand(metadata: DemandMetadata): boolean {
    if (
      !this._frameTimeline ||
      this.framePrefetch <= 0 ||
      this._isVideoPausedForWorker() ||
      metadata.presentationId == null
    ) {
      return false
    }

    if (isStalePresentation(metadata.presentationId, this._latestPresentationId)) return true

    const frameIndex = presentedFrameIndex(this._frameTimeline, metadata.mediaTime)
    if (frameIndex < 0 || this._lastPresentedFrameIndex == null) return false
    if (frameIndex !== this._lastPresentedFrameIndex) return true
    if (metadata.width !== this._videoWidth || metadata.height !== this._videoHeight) return false

    const prepared = this._preparedFrames.get(frameIndex)
    if (!prepared) return false
    this._preparedFrames.delete(frameIndex)

    if (prepared.width !== this._canvasctrl.width || prepared.height !== this._canvasctrl.height) {
      this._disposePreparedFrame(prepared)
      this._prepareForce = true
      return false
    }

    this._presentPreparedFrame(prepared, metadata.presentationId, metadata.expectedDisplayTime)
    return true
  }

  /** @internal */
  private _dispatchReadyWhenFrameBufferFilled(): void {
    if (
      !this._frameBufferReadyEvent ||
      this.busy ||
      this._pendingDemandTimes.length > 0 ||
      this._prepareQueue.length > 0 ||
      this._prepareRequests.size > 0
    ) {
      return
    }

    const event = this._frameBufferReadyEvent
    this._frameBufferReadyEvent = null
    this.dispatchEvent(new CustomEvent(event))
  }

  /** @internal */
  private _startRefreshSampling(): void {
    if (
      this._refreshRafHandle != null ||
      !this._frameTimeline ||
      !this._canvasParent ||
      typeof requestAnimationFrame !== 'function'
    ) {
      return
    }

    const sample = (time: number): void => {
      if (this._destroyed) return

      if (Number.isFinite(this._lastRefreshRafTime)) {
        const interval = time - this._lastRefreshRafTime!
        if (interval >= 3 && interval <= 50) {
          this._refreshSamples.push(interval)
          if (this._refreshSamples.length > 48) this._refreshSamples.shift()
        }
      }
      this._lastRefreshRafTime = time
      this._refreshRafHandle = requestAnimationFrame(sample)
    }

    this._refreshRafHandle = requestAnimationFrame(sample)
  }

  /** @internal */
  private _syncStagedCanvasLayout(stage: HTMLCanvasElement): void {
    stage.style.display = 'block'
    stage.style.position = 'absolute'
    stage.style.pointerEvents = 'none'
    stage.style.top = this._canvas.style.top
    stage.style.left = this._canvas.style.left
    stage.style.width = this._canvas.style.width
    stage.style.height = this._canvas.style.height
    stage.style.willChange = 'opacity'
    stage.style.zIndex = '0'
  }

  /** @internal */
  private _releaseGPUStage(stage: HTMLCanvasElement): void {
    if (this._rendererType !== 'webgpu') return
    ;(this._gpuRenderer as WebGPURenderer | null)?.releaseCanvas(stage)
  }

  /** @internal */
  private _removeStagedCanvas(stage: HTMLCanvasElement): void {
    for (const animation of stage.getAnimations()) animation.cancel()
    this._releaseGPUStage(stage)
    stage.remove()
    if (this._committedStage === stage) this._committedStage = null
    this._stagedCanvases.delete(stage)
    this._stageFrameIndices.delete(stage)
    this._stageDisplayTimes.delete(stage)
  }

  /** @internal */
  private _currentExactFrameIndex(): number | undefined {
    if (!this._frameTimeline) return undefined
    const currentTime = this._clockCurrentTime()
    if (currentTime == null) return undefined
    if (!this._isVideoPausedForWorker() && this._lastPresentedFrameIndex != null) {
      return this._lastPresentedFrameIndex
    }
    return presentedFrameIndex(this._frameTimeline, currentTime)
  }

  /** @internal */
  private _currentExactFrameMediaTime(): number {
    const index = this._currentExactFrameIndex()
    if (index != null && this._frameTimeline) return this._frameTimeline[index]
    return this._clockCurrentTime() ?? 0
  }

  /** Make a freshly painted base canvas visible without discarding future prefetch. */
  private _activateBaseCanvas(presentedIndex?: number): void {
    if (!this._canvas) return

    // A compositor-scheduled frame can become visible before its RVFC arrives.
    // Never let an older demand response roll that already-visible frame back.
    if (presentedIndex != null) {
      const now = performance.now()
      let visibleIndex = this._committedStage ? this._stageFrameIndices.get(this._committedStage) : undefined
      for (const stage of this._stagedCanvases) {
        const boundary = this._stageDisplayTimes.get(stage)
        const index = this._stageFrameIndices.get(stage)
        if (boundary != null && boundary <= now && index != null && (visibleIndex == null || index > visibleIndex)) {
          visibleIndex = index
        }
      }
      if (visibleIndex != null && visibleIndex > presentedIndex) return
    }

    for (const animation of this._canvas.getAnimations()) animation.cancel()
    this._canvas.style.opacity = '1'

    const retainedStages = new Set<HTMLCanvasElement>()
    for (const [index, frame] of [...this._preparedFrames]) {
      const frameIndex = frame.index ?? index
      if (presentedIndex != null && frameIndex > presentedIndex && frame.stage) {
        for (const animation of frame.animations ?? []) animation.cancel()
        frame.animations = undefined
        frame.scheduled = false
        frame.committed = false
        frame.stage.style.opacity = '0'
        retainedStages.add(frame.stage)
        continue
      }
      this._disposePreparedFrame(frame)
      this._preparedFrames.delete(index)
    }
    this._scheduledPreparedFrame = null
    for (const stage of [...this._stagedCanvases]) {
      if (!retainedStages.has(stage)) this._removeStagedCanvas(stage)
    }
    this._committedStage = null
    this._scheduleNextPreparedFrame()
  }

  /** @internal */
  private _activateBaseCanvasAfterGPUWork(
    renderEpoch: number = this._renderEpoch,
    presentedIndex?: number
  ): Promise<boolean> | null {
    if (this._rendererType !== 'webgpu' || !(this._gpuRenderer instanceof WebGPURenderer)) {
      this._activateBaseCanvas(presentedIndex)
      return null
    }

    const renderer = this._gpuRenderer
    let submittedWork: Promise<void>
    try {
      submittedWork = renderer.submittedWorkDone()
    } catch {
      return Promise.resolve(false)
    }

    return submittedWork.then(
      () => {
        if (this._destroyed || renderEpoch !== this._renderEpoch) return false
        this._activateBaseCanvas(presentedIndex)
        return true
      },
      () => {
        // Keep the last committed stage visible when the GPU device/queue is lost.
        return false
      }
    )
  }

  /** @internal */
  private _disposePreparedFrame(frame: PreparedFrame): void {
    if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null
    for (const animation of frame.animations ?? []) animation.cancel()
    frame.animations = undefined
    frame.scheduled = false
    frame.bitmap?.close()
    frame.bitmap = undefined

    if (frame.stage) {
      this._removeStagedCanvas(frame.stage)
      frame.stage = undefined
    }
  }

  /** @internal */
  private _stagePreparedFrame(index: number, frame: PreparedFrame, allowWebGPU: boolean = true): void {
    if (!this._canvasParent || !frame.bitmap || this._destroyed) return

    let stage = document.createElement('canvas')
    stage.width = frame.width
    stage.height = frame.height
    this._syncStagedCanvasLayout(stage)
    stage.style.opacity = '0'

    frame.index = index
    frame.stage = stage
    frame.ready = false
    this._stagedCanvases.add(stage)
    this._stageFrameIndices.set(stage, index)

    let rendered = false
    const webgpuRenderer =
      allowWebGPU && this._rendererType === 'webgpu' && this._gpuRenderer instanceof WebGPURenderer
        ? this._gpuRenderer
        : null
    if (webgpuRenderer) {
      // A WebGPU canvas is a presentation surface, not retained bitmap storage.
      // Connect it before submitting work so Chromium cannot discard a frame
      // rendered into a detached/never-composited swap chain.
      this._canvasParent.appendChild(stage)
      try {
        rendered = webgpuRenderer.renderBitmapToCanvas(stage, frame.bitmap, frame.width, frame.height)
      } catch {
        rendered = false
      }
    }
    if (!rendered) {
      // A synchronized context guarantees drawImage has entered the canvas
      // presentation pipeline before this hidden stage is compositor-scheduled.
      // desynchronized:true can expose a newly appended but not-yet-painted layer.
      const context = stage.getContext('2d', this._canvas2dSettings())
      if (!context) {
        this._removeStagedCanvas(stage)
        stage = document.createElement('canvas')
        stage.width = frame.width
        stage.height = frame.height
        this._syncStagedCanvasLayout(stage)
        stage.style.opacity = '0'
        frame.stage = stage
        this._stagedCanvases.add(stage)
        this._stageFrameIndices.set(stage, index)
        const fallbackContext = stage.getContext('2d', this._canvas2dSettings())
        if (!fallbackContext) {
          this._removeStagedCanvas(stage)
          frame.stage = undefined
          return
        }
        fallbackContext.drawImage(frame.bitmap, 0, 0)
      } else {
        context.drawImage(frame.bitmap, 0, 0)
      }
      frame.ready = true
      if (!stage.isConnected) this._canvasParent.appendChild(stage)
    }
    frame.bitmap.close()
    frame.bitmap = undefined

    const targetDisplayTime = this._predictedDisplayTimes.get(index)
    if (Number.isFinite(targetDisplayTime)) {
      frame.targetDisplayTime = targetDisplayTime
    }

    if (webgpuRenderer && rendered) {
      // WebGPU queue submission is ordered. The target is still multiple video
      // frames ahead, and waiting on the whole queue creates a teardown race:
      // a demand handoff can unconfigure this context while the readiness
      // promise is pending, rejecting it and starving prefetch forever.
      frame.ready = true
    }

    this._scheduleNextPreparedFrame()
  }

  /** @internal */
  private _scheduleNextPreparedFrame(): void {
    if (this._scheduledPreparedFrame || this._destroyed) return

    let next: PreparedFrame | undefined
    let nextTime = Number.POSITIVE_INFINITY
    const now = performance.now()
    for (const frame of this._preparedFrames.values()) {
      const target = frame.targetDisplayTime
      if (
        !frame.stage ||
        frame.committed ||
        frame.scheduled ||
        !Number.isFinite(target) ||
        target! <= now ||
        target! >= nextTime
      ) {
        continue
      }
      next = frame
      nextTime = target!
    }

    if (next?.ready) this._schedulePreparedFrame(next, nextTime)
  }

  /** @internal */
  private _commitPreparedStage(frame: PreparedFrame): void {
    const stage = frame.stage
    if (!stage || !this._stagedCanvases.has(stage) || this._destroyed) return

    for (const animation of frame.animations ?? []) animation.cancel()
    frame.animations = undefined
    frame.scheduled = false
    frame.committed = true
    if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null

    for (const animation of this._canvas.getAnimations()) animation.cancel()
    this._canvas.style.opacity = '0'
    stage.style.opacity = '1'
    this._committedStage = stage

    const frameIndex = frame.index ?? this._stageFrameIndices.get(stage)
    for (const candidate of [...this._stagedCanvases]) {
      if (candidate === stage) continue
      for (const animation of candidate.getAnimations()) animation.cancel()
      const candidateIndex = this._stageFrameIndices.get(candidate)
      const shouldRetire =
        frame.replaceAll || frameIndex == null || candidateIndex == null || candidateIndex < frameIndex
      if (shouldRetire) {
        this._removeStagedCanvas(candidate)
      } else {
        candidate.style.opacity = '0'
      }
    }

    this._scheduleNextPreparedFrame()
  }

  /** @internal */
  private _schedulePreparedFrame(frame: PreparedFrame, targetDisplayTime: number): void {
    const stage = frame.stage
    frame.targetDisplayTime = targetDisplayTime
    if (
      !stage ||
      !frame.ready ||
      frame.scheduled ||
      frame.committed ||
      this._scheduledPreparedFrame ||
      this._destroyed ||
      targetDisplayTime <= performance.now()
    ) {
      return
    }

    // Each swap independently hides every other layer. Do not form a single
    // predecessor chain: removing one skipped prefetched frame would otherwise
    // cancel the only animation capable of hiding its predecessor. Future and
    // unscheduled stages are hidden too, but retained for their own later show.
    const previousStages = [...this._stagedCanvases].filter((candidate) => candidate !== stage)
    this._stageDisplayTimes.set(stage, targetDisplayTime)

    const performanceTime = performance.now()
    const compositorSwapTime =
      targetDisplayTime - compositorScheduleLeadMs(estimateRefreshIntervalMs(this._refreshSamples ?? []))
    const documentTime = Number(document.timeline?.currentTime)
    const hasDocumentTime = Number.isFinite(documentTime)
    const sharedStartTime = hasDocumentTime ? documentTime + (compositorSwapTime - performanceTime) : undefined
    const animationOptions: KeyframeAnimationOptions = {
      delay: hasDocumentTime ? 0 : Math.max(0, compositorSwapTime - performanceTime),
      // A near-zero positive interval keeps the swap compositor-scheduled while
      // allowing its cleanup promise to run in the same refresh. A full 1 ms
      // interval can survive until the next paint when animation composite order
      // temporarily favors an older stage.
      duration: 0.001,
      easing: 'steps(1, jump-start)',
      fill: 'forwards'
    }

    const hiddenLayers = [this._canvas, ...previousStages]
    let showAnimation: Animation | null = null
    const hideAnimations: Animation[] = []
    try {
      showAnimation = stage.animate([{ opacity: '0' }, { opacity: '1' }], animationOptions)
      for (const layer of hiddenLayers) {
        hideAnimations.push(layer.animate([{ opacity: '1' }, { opacity: '0' }], animationOptions))
      }
    } catch {
      showAnimation?.cancel()
      for (const animation of hideAnimations) animation.cancel()
      return
    }
    if (!showAnimation) return

    if (sharedStartTime != null) {
      showAnimation.startTime = sharedStartTime
      for (const animation of hideAnimations) animation.startTime = sharedStartTime
    }

    frame.scheduled = true
    this._scheduledPreparedFrame = frame
    const swapAnimations = [showAnimation, ...hideAnimations]
    frame.animations = swapAnimations
    const releaseSwapAnimations = (): void => {
      for (const animation of swapAnimations) animation.cancel()
      if (frame.animations === swapAnimations) frame.animations = undefined
    }

    // The show animation is the authoritative commit. Once it completes, make
    // its state explicit, release this swap's fill animations, and remove all
    // older layers. A later prefetched swap may already have its own independent
    // hide animation on this stage; it is intentionally left untouched.
    void showAnimation.finished.then(
      () => {
        if (frame.animations !== swapAnimations) return
        if (!frame.committed) this._commitPreparedStage(frame)
        releaseSwapAnimations()
        if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null
        this._scheduleNextPreparedFrame()
      },
      () => {
        if (frame.animations !== swapAnimations) return
        releaseSwapAnimations()
        if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null
        frame.scheduled = false
        if (!frame.committed) this._scheduleNextPreparedFrame()
      }
    )
  }

  /** @internal */
  private _recordPresentationClock(frameIndex: number, mediaTime: number, expectedDisplayTime?: number): void {
    const timeline = this._frameTimeline
    const playbackRate = this._videoPlaybackRateForWorker()
    if (timeline && frameIndex >= 0) {
      this._predictedDisplayTimes.delete(frameIndex)
    }
    if (
      !timeline ||
      frameIndex < 0 ||
      frameIndex + 1 >= timeline.length ||
      !Number.isFinite(expectedDisplayTime) ||
      playbackRate <= 0
    ) {
      return
    }

    if (
      (Number.isFinite(this._lastClockMediaTime) &&
        (mediaTime <= this._lastClockMediaTime! || Math.abs(mediaTime - this._lastClockMediaTime!) > 0.5)) ||
      (Number.isFinite(this._lastClockPlaybackRate) && this._lastClockPlaybackRate !== playbackRate)
    ) {
      this._displayClockOffsets.length = 0
      this._predictedDisplayTimes.clear()
      this._displayGridAnchorMs = undefined
    }
    this._lastClockMediaTime = mediaTime
    this._lastClockPlaybackRate = playbackRate

    this._displayGridAnchorMs = expectedDisplayTime
    const frameMediaTime = timeline[frameIndex]
    this._displayClockOffsets.push(expectedDisplayTime! - (frameMediaTime * 1000) / playbackRate)
    if (this._displayClockOffsets.length > 12) this._displayClockOffsets.shift()

    const refreshInterval = estimateRefreshIntervalMs(this._refreshSamples)
    const targetDisplayTime = predictFrameDisplayTimeMs(
      timeline[frameIndex + 1],
      playbackRate,
      this._displayClockOffsets,
      this._displayGridAnchorMs,
      refreshInterval
    )
    if (!Number.isFinite(targetDisplayTime)) return

    this._predictedDisplayTimes.set(frameIndex + 1, targetDisplayTime!)
    const prepared = this._preparedFrames.get(frameIndex + 1)
    if (prepared) prepared.targetDisplayTime = targetDisplayTime
    this._scheduleNextPreparedFrame()
  }

  /** @internal */
  private _clearPreparedFrames(preservePresentation: boolean = true): void {
    let preservedStage = preservePresentation ? this._committedStage : null
    if (preservePresentation) {
      const now = performance.now()
      let latestBoundary = preservedStage ? (this._stageDisplayTimes.get(preservedStage) ?? -Infinity) : -Infinity
      for (const stage of this._stagedCanvases) {
        const boundary = this._stageDisplayTimes.get(stage)
        if (boundary != null && boundary <= now && boundary >= latestBoundary) {
          preservedStage = stage
          latestBoundary = boundary
        }
      }
    }
    const preservedFrameIndex = preservedStage ? this._stageFrameIndices.get(preservedStage) : undefined
    const preservedDisplayTime = preservedStage ? this._stageDisplayTimes.get(preservedStage) : undefined

    this._scheduledPreparedFrame = null
    for (const frame of this._preparedFrames.values()) {
      if (frame.stage === preservedStage) {
        for (const animation of frame.animations ?? []) animation.cancel()
        frame.animations = undefined
        frame.scheduled = false
        frame.bitmap?.close()
        frame.bitmap = undefined
        continue
      }
      this._disposePreparedFrame(frame)
    }
    this._preparedFrames.clear()
    for (const stage of [...this._stagedCanvases]) {
      if (stage !== preservedStage) this._removeStagedCanvas(stage)
    }
    this._stagedCanvases.clear()
    this._stageFrameIndices.clear()
    this._stageDisplayTimes.clear()
    for (const animation of this._canvas?.getAnimations?.() ?? []) animation.cancel()
    if (preservedStage?.isConnected) {
      for (const animation of preservedStage.getAnimations()) animation.cancel()
      preservedStage.style.opacity = '1'
      this._stagedCanvases.add(preservedStage)
      if (preservedFrameIndex != null) this._stageFrameIndices.set(preservedStage, preservedFrameIndex)
      if (preservedDisplayTime != null) this._stageDisplayTimes.set(preservedStage, preservedDisplayTime)
      if (this._canvas) this._canvas.style.opacity = '0'
      this._committedStage = preservedStage
    } else {
      if (preservedStage) this._removeStagedCanvas(preservedStage)
      this._committedStage = null
      if (this._canvas) this._canvas.style.opacity = '1'
    }
    this._predictedDisplayTimes.clear()
    this._displayClockOffsets.length = 0
    this._displayGridAnchorMs = undefined
    this._lastClockMediaTime = undefined
    this._lastClockPlaybackRate = undefined
    this._lastPresentedFrameIndex = undefined
    this._prepareQueue.length = 0
    this._prepareRequests.clear()
  }

  /** @internal */
  private _primePreparedFrames(mediaTime: number): void {
    const timeline = this._frameTimeline
    if (!timeline || timeline.length === 0 || this.framePrefetch <= 0 || this._destroyed) {
      return
    }

    const currentIndex = presentedFrameIndex(timeline, mediaTime)
    const lastIndex = Math.min(timeline.length - 1, currentIndex + this.framePrefetch)

    for (const [index, frame] of this._preparedFrames) {
      if (index < currentIndex || index > lastIndex) {
        // A scheduled stage may already be the compositor's visible frame even
        // when Chromium skips/delays its RVFC. Removing it here produces a blank
        // refresh. Its successor's completed hide animation owns stage cleanup.
        if ((frame.scheduled || frame.committed) && index < currentIndex) {
          frame.bitmap?.close()
          frame.bitmap = undefined
        } else {
          this._disposePreparedFrame(frame)
        }
        this._preparedFrames.delete(index)
      }
    }

    const queued = this._prepareQueue.filter((index) => index > currentIndex && index <= lastIndex)
    this._prepareQueue.length = 0
    this._prepareQueue.push(...queued)

    const requested = new Set<number>()
    for (const request of this._prepareRequests.values()) requested.add(request.index)
    for (const index of this._prepareQueue) requested.add(index)

    for (let index = currentIndex + 1; index <= lastIndex; index++) {
      if (!this._preparedFrames.has(index) && !requested.has(index)) this._prepareQueue.push(index)
    }
  }

  /** @internal */
  private _dispatchNextPreparation(): void {
    if (this.busy || !this._workerReady || !this._frameTimeline || this.framePrefetch <= 0) return

    let index: number | undefined
    while ((index = this._prepareQueue.shift()) != null) {
      if (!this._preparedFrames.has(index)) break
    }
    if (index == null) return

    const time = subtitleTimeForFrame(this._frameTimeline, index)
    if (!Number.isFinite(time)) return

    const prepareId = this._nextPrepareId++
    this._prepareRequests.set(prepareId, { index, renderEpoch: this._renderEpoch })
    this.busy = true
    const force = this._prepareForce
    this._prepareForce = false
    this._postWorkerMessage('prepare', {
      time: time + this.timeOffset,
      prepareId,
      renderEpoch: this._renderEpoch,
      force
    })
  }

  /** @internal */
  private _preparedFrame(data: {
    prepareId: number
    renderEpoch: number
    time: number
    width?: number
    height?: number
    bitmap?: ImageBitmap
  }): void {
    const request = this._prepareRequests.get(data.prepareId)
    this._prepareRequests.delete(data.prepareId)

    if (request?.presentation) {
      const presentation = request.presentation
      const validEpoch = request.renderEpoch === this._renderEpoch && data.renderEpoch === this._renderEpoch
      const currentIndex = this._currentExactFrameIndex()
      const obsolete = currentIndex != null && request.index < currentIndex

      if (data.bitmap && validEpoch && !obsolete) {
        this._presentPreparedFrame(
          {
            width: data.width ?? this._canvasctrl.width,
            height: data.height ?? this._canvasctrl.height,
            bitmap: data.bitmap,
            index: request.index,
            time: data.time
          },
          presentation.presentationId!,
          presentation.expectedDisplayTime
        )
        this._prepareForce = true
        this._finishWorkerSlot()
        return
      }

      data.bitmap?.close()
      if (validEpoch && obsolete) {
        this._prepareForce = true
        this._finishWorkerSlot()
        return
      }

      if (validEpoch) {
        this._demandRender({ ...presentation, preparedPresentationAttempted: true })
        return
      }

      this._prepareForce = true
      this._finishWorkerSlot()
      return
    }

    const currentIndex = this._currentExactFrameIndex() ?? -1

    if (
      request &&
      data.bitmap &&
      request.renderEpoch === this._renderEpoch &&
      data.renderEpoch === this._renderEpoch &&
      request.index >= currentIndex
    ) {
      const previous = this._preparedFrames.get(request.index)
      if (previous) this._disposePreparedFrame(previous)
      const prepared: PreparedFrame = {
        width: data.width ?? this._canvasctrl.width,
        height: data.height ?? this._canvasctrl.height,
        bitmap: data.bitmap,
        time: data.time
      }
      this._stagePreparedFrame(request.index, prepared)
      this._preparedFrames.set(request.index, prepared)
      this._scheduleNextPreparedFrame()
    } else {
      data.bitmap?.close()
    }

    // Preparations share libass' changed-frame baseline with demand renders but
    // paint to a different canvas; force complete snapshots afterwards.
    this._prepareForce = true

    this._finishWorkerSlot()
  }

  /** @internal */
  private _presentPreparedFrame(frame: PreparedFrame, presentationId: number, expectedDisplayTime?: number): void {
    if (!this._activatePresentation(presentationId, frame.time)) {
      // Scheduling happens on the display clock before RVFC validation. If a
      // newer callback has already advanced the presentation watermark, this
      // stage can still be the compositor's current frame. Never tear down a
      // scheduled stage from a stale callback; the next atomic swap removes it.
      if (frame.stage && (frame.scheduled || frame.committed || this._committedStage === frame.stage)) {
        frame.bitmap?.close()
        frame.bitmap = undefined
      } else {
        this._disposePreparedFrame(frame)
      }
      return
    }

    const { bitmap, width, height, stage } = frame
    if (stage) {
      if (!frame.committed || this._committedStage !== stage) {
        for (const animation of frame.animations ?? []) {
          try {
            animation.finish()
          } catch {
            animation.cancel()
          }
        }
        this._commitPreparedStage(frame)
      }
      this._stageDisplayTimes.set(
        stage,
        Number.isFinite(expectedDisplayTime) ? expectedDisplayTime! : performance.now()
      )
      bitmap?.close()
      frame.bitmap = undefined
      return
    }

    if (!bitmap) return

    try {
      if (this._gpuRenderer) {
        let painted: boolean | void = false
        try {
          painted = this._gpuRenderer.renderBitmaps([{ image: bitmap, x: 0, y: 0 }], width, height)
        } catch (error) {
          console.warn('[AkariSub] GPU prepared-frame presentation failed; using Canvas2D fallback.', error)
        }
        if (painted === false) {
          frame.bitmap = bitmap
          frame.replaceAll = true
          this._stagePreparedFrame(-1, frame, false)
          if (frame.stage) this._commitPreparedStage(frame)
          return
        }
        this._activateBaseCanvasAfterGPUWork(this._renderEpoch, frame.index)
        return
      }

      if (this._ctx) {
        this._ctx.clearRect(0, 0, width, height)
        this._ctx.drawImage(bitmap, 0, 0)
        this._activateBaseCanvas(frame.index)
        return
      }

      this._postWorkerMessage(
        'presentFrame',
        { bitmap, presentationId, renderEpoch: this._renderEpoch, frameIndex: frame.index },
        [bitmap]
      )
    } finally {
      if (this._ctx || this._gpuRenderer) bitmap.close()
    }
  }

  /** @internal */
  private _presentedFrame(data: { presentationId: number; renderEpoch?: number; frameIndex?: number }): void {
    if (
      (data.renderEpoch != null && data.renderEpoch !== this._renderEpoch) ||
      isStalePresentation(data.presentationId, this._latestPresentationId)
    ) {
      return
    }
    this._activateBaseCanvas(data.frameIndex)
  }

  // Advance the presentation watermark only when a frame enters the pipeline,
  // not when an RVFC is merely queued (avoids starving the in-flight render).
  /** @internal */
  private _activatePresentation(presentationId: number, time?: number): boolean {
    if (isStalePresentation(presentationId, this._latestPresentationId)) return false
    this._latestPresentationId = presentationId
    if (this._workerReady) this._postWorkerMessage('presentation', { presentationId, time })
    return true
  }

  /** @internal */
  private _bumpRenderEpoch(): void {
    this._renderEpoch++
    this._pendingDemandTimes.length = 0
    this._demandTimings.clear()
    this._clearPreparedFrames()
    this._prepareForce = true
  }

  /** @internal */
  private _sendMutatingMessage(target: string, data: Record<string, any> = {}, transferable?: Transferable[]): void {
    this._bumpRenderEpoch()
    void this.sendMessage(target, data, transferable).then(() => {
      this._syncVideoClock()
    })
  }

  /** @internal */
  private _cancelRVFC(): void {
    this._rvfcGeneration++

    if (this._video && this._rvfcHandle != null) {
      const cancelVideoFrameCallback = (this._video as any).cancelVideoFrameCallback
      if (typeof cancelVideoFrameCallback === 'function') {
        try {
          cancelVideoFrameCallback.call(this._video, this._rvfcHandle)
        } catch {
          // Some browser/polyfill combinations can throw for already-fired
          // handles. The generation guard below still rejects stale callbacks.
        }
      }
    }

    this._rvfcHandle = null
  }

  /** @internal */
  private _scheduleRVFC(video: HTMLVideoElement | undefined = this._video): void {
    if (!this._onDemandRender || !video || this._destroyed) return

    const requestVideoFrameCallback = (video as any).requestVideoFrameCallback
    if (typeof requestVideoFrameCallback !== 'function') return

    const generation = this._rvfcGeneration
    this._rvfcHandle = requestVideoFrameCallback.call(
      video,
      (now: number, metadata: VideoFrameCallbackMetadata): void => {
        if (this._video === video && generation === this._rvfcGeneration) {
          this._rvfcHandle = null
        }

        if (this._destroyed || this._video !== video || generation !== this._rvfcGeneration) return

        this._handleRVFC(now, metadata)
      }
    )
  }

  /** @internal */
  private _closeRenderImages(images: RenderImage[]): void {
    for (const image of images) {
      if (image.image instanceof ImageBitmap) {
        image.image.close()
      }
    }
  }

  /** @internal */
  private _isVideoPausedForWorker(): boolean {
    if (this._video) return this._video.paused || this._video.ended || this._playstate
    if (this._videoFrameClock) return this._videoFrameClock.paused || this._playstate
    return true
  }

  /** @internal */
  private _videoPlaybackRateForWorker(): number {
    const playbackRate = this._video?.playbackRate ?? this._videoFrameClock?.rate ?? 1
    return Number.isFinite(playbackRate) ? playbackRate : 1
  }

  /** @internal */
  private _clockCurrentTime(): number | undefined {
    if (this._video) {
      const currentTime = this._video.currentTime
      return Number.isFinite(currentTime) ? currentTime : 0
    }
    if (this._videoFrameClock) return this._videoFrameClock.currentTime
    return undefined
  }

  /** @internal */
  private _setVideoClockStateFromEvent(event?: Event): void {
    if (!event || !this._video) return

    switch (event.type) {
      case 'play':
      case 'playing':
      case 'canplay':
        this._playstate = false
        break
      case 'pause':
      case 'ended':
      case 'seeking':
      case 'waiting':
      case 'stalled':
        this._playstate = true
        break
      case 'seeked':
        this._playstate = this._video.paused || this._video.ended
        break
    }
  }

  /** @internal */
  private _currentVideoTimeWithOffset(): number {
    return (this._clockCurrentTime() ?? 0) + this.timeOffset
  }

  /** @internal */
  private _syncVideoClock(event?: Event): void {
    if (this._destroyed) return
    if (this._video) this._setVideoClockStateFromEvent(event)
    else if (!this._videoFrameClock) return

    const currentTime = this._currentVideoTimeWithOffset()
    const playbackRate = this._videoPlaybackRateForWorker()
    const isPaused = this._isVideoPausedForWorker()
    this.setCurrentTime(isPaused, currentTime, playbackRate)

    if (!this._onDemandRender) return

    // RVFC and presentVideoFrame render ahead while frames are advancing. When
    // playback pauses, stalls, or seeks, the last ahead render can be visibly
    // in the future. Force an exact render at the displayed media time.
    const shouldRenderExactFrame =
      isPaused ||
      event?.type === 'pause' ||
      event?.type === 'seeking' ||
      event?.type === 'seeked' ||
      event?.type === 'waiting' ||
      event?.type === 'stalled' ||
      event?.type === 'ended'

    if (shouldRenderExactFrame) {
      this._bumpRenderEpoch()
      const presentationId = this._nextPresentationId++
      // Pause/seek is terminal: supersede any speculative play-ahead immediately.
      this._activatePresentation(presentationId)
      this._requestDemandRender({
        mediaTime: currentTime - this.timeOffset,
        width: this._video?.videoWidth || this._videoFrameClock?.width || this._videoWidth || 0,
        height: this._video?.videoHeight || this._videoFrameClock?.height || this._videoHeight || 0,
        force: true,
        presentationId
      })
    }
  }

  /** @internal */
  private _requestDemandRender(metadata: DemandMetadata): void {
    if (!this._workerReady) {
      this._enqueueDemand(metadata)
      return
    }

    if (this.busy) {
      this._enqueueDemand(metadata)
    } else {
      this.busy = true
      this._demandRender(metadata)
    }
  }

  /** @internal */
  private _enqueueDemand(metadata: DemandMetadata): void {
    const queue = this._pendingDemandTimes

    if (queue.length > 0) {
      const lastQueued = queue[queue.length - 1]
      if (Math.abs(lastQueued.mediaTime - metadata.mediaTime) > 0.25) {
        metadata.force = metadata.force || queue.some((demand) => demand.force)
        queue.length = 0
      }
    }

    if (queue.length >= AkariSub.MAX_PENDING_DEMANDS) {
      const dropped = queue.shift()
      if (dropped?.force) metadata.force = true
    }

    queue.push(metadata)
    this._emitPerformanceWarnings({ pendingRenders: queue.length })
  }

  /** @internal */
  private _handleRVFC(now: number, metadata: VideoFrameCallbackMetadata): void {
    if (this._destroyed) return

    const presentationId = this._nextPresentationId++

    // Keep the browser frame timestamp unmodified while queued; predict at dispatch.
    const isPaused = this._isVideoPausedForWorker()
    const expectedDisplayTime = Number.isFinite(metadata.expectedDisplayTime)
      ? metadata.expectedDisplayTime
      : Number.isFinite(metadata.presentationTime)
        ? metadata.presentationTime
        : now
    const mediaTime = resolvePresentationMediaTime(
      metadata.mediaTime,
      this._clockCurrentTime(),
      !!this._frameTimeline?.length,
      this._frameTimeline?.mediaTimeOrigin,
      this._frameTimeline ?? undefined
    )

    const demandData = {
      mediaTime,
      width: metadata.width,
      height: metadata.height,
      expectedDisplayTime: isPaused ? undefined : expectedDisplayTime,
      presentationId
    }

    let presented = false
    if (!isPaused && this._frameTimeline && this.framePrefetch > 0) {
      const frameIndex = presentedFrameIndex(this._frameTimeline, mediaTime)
      if (frameIndex >= 0) this._lastPresentedFrameIndex = frameIndex
      const prepared = this._preparedFrames.get(frameIndex)
      if (prepared) {
        this._preparedFrames.delete(frameIndex)
        if (prepared.width === this._canvasctrl.width && prepared.height === this._canvasctrl.height) {
          this._presentPreparedFrame(prepared, presentationId, expectedDisplayTime)
          presented = true
        } else {
          this._disposePreparedFrame(prepared)
          this._prepareForce = true
        }
      }
      this._primePreparedFrames(mediaTime)
      this._recordPresentationClock(frameIndex, mediaTime, expectedDisplayTime)
    }

    if (!presented) this._requestDemandRender(demandData)
    this._dispatchNextPreparation()
    this._scheduleRVFC(this._video)
  }

  /** @internal */
  private _observeDemandCompletion(requestId?: number, renderEpoch?: number, painted: boolean = false): void {
    if (requestId == null) return

    const timing = this._demandTimings.get(requestId)
    if (!timing) return
    this._demandTimings.delete(requestId)

    if (!painted) return
    if (renderEpoch != null && renderEpoch !== timing.renderEpoch) return
    if (timing.renderEpoch !== this._renderEpoch || !this._adaptiveTiming) return

    this._timingCompensationSeconds = updateTimingCompensation(
      this._timingCompensationSeconds,
      performance.now(),
      timing.dispatchedAt
    )
  }

  /** @internal */
  private _demandRender(metadata: DemandMetadata): void {
    if (metadata.width !== this._videoWidth || metadata.height !== this._videoHeight) {
      this._videoWidth = metadata.width
      this._videoHeight = metadata.height
      this.resize()
    }

    const isPaused = this._isVideoPausedForWorker()
    const presentationId = metadata.presentationId ?? this._nextPresentationId++
    metadata.presentationId = presentationId

    if (!isPaused && this._frameTimeline && this.framePrefetch > 0 && !metadata.preparedPresentationAttempted) {
      const frameIndex = presentedFrameIndex(this._frameTimeline, metadata.mediaTime)
      const renderTime = frameIndex >= 0 ? subtitleTimeForFrame(this._frameTimeline, frameIndex) : metadata.mediaTime
      const prepareId = this._nextPrepareId++
      this._prepareRequests.set(prepareId, {
        index: frameIndex,
        renderEpoch: this._renderEpoch,
        presentation: metadata
      })
      this._postWorkerMessage('prepare', {
        time: renderTime + this.timeOffset,
        prepareId,
        renderEpoch: this._renderEpoch,
        force: true
      })
      return
    }

    const dispatchedAt = performance.now()
    const adaptiveLead =
      this._adaptiveTiming && !isPaused
        ? presentationLeadSeconds(dispatchedAt, metadata.expectedDisplayTime, this._timingCompensationSeconds)
        : 0
    const predictedRenderTime = compensatedMediaTime(
      metadata.mediaTime,
      this._videoPlaybackRateForWorker(),
      this.renderAhead,
      adaptiveLead,
      isPaused
    )
    const renderTime = selectRenderMediaTime(this._frameTimeline, metadata.mediaTime, predictedRenderTime, isPaused)

    if (!this._activatePresentation(presentationId)) {
      this._finishWorkerSlot()
      return
    }

    const requestId = this._nextDemandId++
    if (this._adaptiveTiming && !isPaused) {
      this._demandTimings.set(requestId, {
        dispatchedAt,
        renderEpoch: this._renderEpoch
      })
    }

    this.sendMessage('demand', {
      time: renderTime + this.timeOffset,
      // Exact-timeline preparation mutates libass' change baseline; force a full frame.
      force: metadata.force || this._frameTimeline != null,
      requestId,
      renderEpoch: this._renderEpoch,
      presentationId
    })
  }

  /** @internal */
  private _detachOffscreen(): void {
    if (!this._offscreenRender || this._ctx) return

    this._canvas.remove()
    this._createCanvas()
    this._canvasctrl = this._canvas
    this._ctx = this._canvasctrl.getContext('2d', this._canvas2dSettings())
    this.sendMessage('detachOffscreen')
    this.busy = false
    this._pendingDemandTimes.length = 0
    this.resize(0, 0, 0, 0, true)
  }

  /** @internal */
  private _reAttachOffscreen(): void {
    if (!this._offscreenRender || !this._ctx) return

    this._canvas.remove()
    this._createCanvas()
    this._canvasctrl = (this._canvas as any).transferControlToOffscreen()
    this._ctx = false
    this.sendMessage(
      'offscreenCanvas',
      {
        canvasColorSpace: this._videoColorProfile.canvasColorSpace,
        hdr: this._shouldUseHdr()
      },
      [this._canvasctrl as OffscreenCanvas]
    )
    this.resize(0, 0, 0, 0, true)
  }

  /** @internal */
  private _setVideoColorSpace(next: WebYCbCrColorSpace | null, forceNotify: boolean = false): void {
    this._setVideoColorProfile(
      {
        ...this._videoColorProfile,
        matrix: next
      },
      forceNotify
    )
  }

  /** @internal */
  private _setVideoColorProfile(profile: VideoColorProfile, forceNotify: boolean = false): void {
    const current = this._videoColorProfile ?? defaultVideoColorProfile()
    const matrixChanged = profile.matrix !== this._videoColorSpace
    const profileChanged = !videoColorProfilesEqual(current, profile)
    this._videoColorSpace = profile.matrix
    this._videoColorProfile = profile
    if (profileChanged) this._applyVideoColorProfile()
    if (forceNotify || matrixChanged) this.sendMessage('getColorSpace')
  }

  /** @internal */
  private _updateColorSpace(): void {
    ;(this._video as any).requestVideoFrameCallback(() => {
      try {
        const frame = new (globalThis as any).VideoFrame(this._video)
        const profile = profileFromVideoFrameColorSpace(frame.colorSpace, this._canvasColorSpaceOverride)
        frame.close()
        this._setVideoColorProfile(profile, true)
      } catch (e) {
        console.warn(e)
      }
    })
  }

  /** @internal */
  private _applyVideoColorProfile(): void {
    this._applyGpuColorManagement()
    if (!this._workerReady) return
    this.sendMessage('video', {
      canvasColorSpace: this._videoColorProfile.canvasColorSpace,
      hdr: this._shouldUseHdr()
    })
  }

  /** @internal */
  private _verifyColorSpace(data: {
    subtitleColorSpace: SubtitleColorSpace
    videoColorSpace?: WebYCbCrColorSpace | null
  }): void {
    const { subtitleColorSpace, videoColorSpace = this._videoColorProfile.matrix ?? this._videoColorSpace } = data
    this._lastSubtitleColorSpace = subtitleColorSpace
    this._applyGpuColorManagement()

    if (!subtitleColorSpace || !videoColorSpace) return
    if (subtitleColorSpace === videoColorSpace) {
      if (this._ctx) this._ctx.filter = 'none'
      return
    }

    if (this._gpuRenderer) return

    this._detachOffscreen()

    const filter = getColorSpaceFilterUrl(subtitleColorSpace, videoColorSpace)
    if (filter && this._ctx) {
      this._ctx.filter = filter
    }
  }

  /** @internal */
  private _render(data: {
    images: RenderImage[]
    asyncRender: boolean
    times: RenderTimes
    width: number
    height: number
    colorSpace: SubtitleColorSpace
    requestId?: number
    renderEpoch?: number
    presentationId?: number
  }): void {
    let gpuCompletion: boolean | Promise<boolean> | undefined
    try {
      if (
        (data.renderEpoch != null && data.renderEpoch !== this._renderEpoch) ||
        isStalePresentation(data.presentationId, this._latestPresentationId)
      ) {
        this._closeRenderImages(data.images)
        return
      }

      const dataWidth = data.width
      const dataHeight = data.height

      if (this.debug) {
        data.times.IPCTime = Date.now() - (data.times.JSRenderTime || 0)
      }

      const sizeChanged = this._canvasctrl.width !== dataWidth || this._canvasctrl.height !== dataHeight
      if (sizeChanged) {
        this._canvasctrl.width = dataWidth
        this._canvasctrl.height = dataHeight
        this._lastRenderWidth = dataWidth
        this._lastRenderHeight = dataHeight

        if (this._gpuRenderer) {
          this._gpuRenderer.updateSize(dataWidth, dataHeight)
        }

        this._verifyColorSpace({ subtitleColorSpace: data.colorSpace })
      }

      if (this._gpuRenderer) {
        gpuCompletion = this._renderGPU(data)
        return
      }

      if (!this._ctx) return

      const ctx = this._ctx
      const images = data.images
      const imageCount = images.length

      ctx.clearRect(0, 0, dataWidth, dataHeight)

      if (data.asyncRender) {
        for (let i = 0; i < imageCount; i++) {
          const image = images[i]
          if (image.image) {
            ctx.drawImage(image.image as ImageBitmap, image.x, image.y)
            ;(image.image as ImageBitmap).close()
          }
        }
      } else {
        const hasAlphaBug = AkariSub._hasAlphaBug ?? false
        const bufferCanvas = this._bufferCanvas
        const bufferCtx = this._bufferCtx

        for (let i = 0; i < imageCount; i++) {
          const image = images[i]
          if (image.image) {
            const imgW = image.w
            const imgH = image.h

            const rawImage = image.image
            const rawData =
              rawImage instanceof Uint8ClampedArray
                ? rawImage
                : rawImage instanceof Uint8Array
                  ? new Uint8ClampedArray(rawImage.buffer, rawImage.byteOffset, rawImage.byteLength)
                  : new Uint8ClampedArray(rawImage as ArrayBuffer)
            const fixedData = fixAlpha(rawData, hasAlphaBug)
            if (bufferCanvas.width !== imgW || bufferCanvas.height !== imgH) {
              bufferCanvas.width = imgW
              bufferCanvas.height = imgH
            }
            bufferCtx.putImageData(createSubtitleImageData(fixedData as Uint8ClampedArray, imgW, imgH), 0, 0)
            ctx.drawImage(bufferCanvas, image.x, image.y)
          }
        }
      }

      this._activateBaseCanvas(this._currentExactFrameIndex())

      if (this.debug) {
        data.times.JSRenderTime = Date.now() - (data.times.JSRenderTime || 0) - (data.times.IPCTime || 0)
        let total = 0
        const count = data.times.bitmaps || imageCount
        delete data.times.bitmaps

        for (const key in data.times) {
          total += (data.times as any)[key] || 0
        }

        console.log('Bitmaps: ' + count + ' Total: ' + (total | 0) + 'ms', data.times)
      }
    } finally {
      if (gpuCompletion === undefined) {
        this._unbusy(data)
      } else {
        if (typeof gpuCompletion === 'boolean') {
          this._observeDemandCompletion(data.requestId, data.renderEpoch, gpuCompletion)
        } else {
          void gpuCompletion.then(
            (painted) => this._observeDemandCompletion(data.requestId, data.renderEpoch, painted),
            () => this._observeDemandCompletion(data.requestId, data.renderEpoch, false)
          )
        }
        // GPU submission frees the worker immediately; only the latency sample
        // waits for the queue fence so queued RVFCs can continue to coalesce.
        this._unbusy(data, false)
      }
    }
  }

  /** @internal */
  private _renderGPU(data: {
    images: RenderImage[]
    asyncRender: boolean
    times: RenderTimes
    presentationId?: number
    renderEpoch?: number
  }): boolean | Promise<boolean> {
    const renderer = this._gpuRenderer
    if (!renderer) return false
    const presentedIndex = this._currentExactFrameIndex()

    if (data.images.length === 0) {
      let painted: boolean | void = false
      try {
        painted = renderer.clear()
      } catch (error) {
        console.warn('[AkariSub] GPU clear failed; preserving the last subtitle frame.', error)
      }
      if (painted !== false) {
        return this._activateBaseCanvasAfterGPUWork(data.renderEpoch, presentedIndex) ?? true
      }
      return false
    }

    let painted: boolean | void
    if (data.asyncRender) {
      const bitmapImages = this._gpuBitmapImages
      let bitmapCount = 0

      for (let i = 0; i < data.images.length; i++) {
        const img = data.images[i]
        if (!(img.image instanceof ImageBitmap)) continue

        const target = bitmapImages[bitmapCount] || (bitmapImages[bitmapCount] = { image: img.image, x: 0, y: 0 })
        target.image = img.image
        target.x = img.x
        target.y = img.y
        bitmapCount++
      }

      bitmapImages.length = bitmapCount

      try {
        painted = renderer.renderBitmaps(bitmapImages, this._canvasctrl.width, this._canvasctrl.height)
      } catch (error) {
        painted = false
        console.warn('[AkariSub] GPU bitmap render failed; preserving the last subtitle frame.', error)
      } finally {
        for (const img of data.images) {
          if (img.image instanceof ImageBitmap) {
            img.image.close()
          }
        }
      }
    } else {
      try {
        painted = renderer.render(data.images, this._canvasctrl.width, this._canvasctrl.height)
      } catch (error) {
        painted = false
        console.warn('[AkariSub] GPU render failed; preserving the last subtitle frame.', error)
      }
    }

    const completion =
      painted !== false ? (this._activateBaseCanvasAfterGPUWork(data.renderEpoch, presentedIndex) ?? true) : false

    if (this.debug) {
      data.times.JSRenderTime = Date.now() - (data.times.JSRenderTime || 0) - (data.times.IPCTime || 0)
      let total = 0
      const count = (data.times as any).bitmaps || data.images.length
      delete (data.times as any).bitmaps

      for (const key in data.times) {
        total += (data.times as any)[key] || 0
      }

      console.log(
        `[${this._rendererType.toUpperCase()}] Bitmaps: ` + count + ' Total: ' + (total | 0) + 'ms',
        data.times
      )
    }

    return completion
  }

  /** @internal */
  private _ready(): void {
    this._workerReady = true
    this._init()

    if (this._video || this._videoFrameClock) {
      const currentTime = this._clockCurrentTime() ?? 0
      const isPaused = this._isVideoPausedForWorker()
      const bufferExactFrames =
        isPaused && this._onDemandRender && !!this._frameTimeline?.length && this.framePrefetch > 0
      this._frameBufferReadyEvent = bufferExactFrames ? 'ready' : null
      this.setCurrentTime(isPaused, currentTime + this.timeOffset, this._videoPlaybackRateForWorker())

      if (!this._onDemandRender) {
        this.dispatchEvent(new CustomEvent('ready'))
        return
      }

      const latestPending = this._pendingDemandTimes[this._pendingDemandTimes.length - 1]
      const canUsePendingDemand = !isPaused && latestPending && Math.abs(latestPending.mediaTime - currentTime) <= 0.25
      const pending = canUsePendingDemand
        ? latestPending
        : {
            mediaTime: currentTime,
            width: this._video?.videoWidth || this._videoFrameClock?.width || this._videoWidth || 0,
            height: this._video?.videoHeight || this._videoFrameClock?.height || this._videoHeight || 0,
            expectedDisplayTime: isPaused ? undefined : performance.now()
          }

      this._pendingDemandTimes.length = 0
      this.busy = true
      this._demandRender(pending)
      if (bufferExactFrames) return
    }

    this.dispatchEvent(new CustomEvent('ready'))
  }

  /** @internal */
  private _partial_ready(): void {
    this.dispatchEvent(new CustomEvent('partial_ready'))
  }

  /** @internal */
  private _trackReady(): void {
    const bufferExactFrames =
      this._workerReady &&
      this._isVideoPausedForWorker() &&
      this._onDemandRender &&
      !!this._frameTimeline?.length &&
      this.framePrefetch > 0
    this._frameBufferReadyEvent = bufferExactFrames ? 'trackReady' : null
    this._syncVideoClock()
    if (bufferExactFrames) {
      this._primePreparedFrames(this._currentExactFrameMediaTime())
      this._dispatchNextPreparation()
      return
    }
    this.dispatchEvent(new CustomEvent('trackReady'))
  }

  /** Send a raw message to the worker. Prefer the typed methods above. */
  async sendMessage(target: string, data: Record<string, any> = {}, transferable?: Transferable[]): Promise<void> {
    if (this._workerReady) {
      this._postWorkerMessage(target, data, transferable)
      return
    }

    await this._loaded

    // Drop stale pre-ready video/canvas updates; ready re-syncs current state.
    if ((target === 'video' || target === 'canvas') && this._video) return

    this._postWorkerMessage(target, data, transferable)
  }

  /** @internal */
  private _postWorkerMessage(target: string, data: Record<string, any> = {}, transferable?: Transferable[]): void {
    if (transferable) {
      this._worker.postMessage({ target, transferable, ...data }, [...transferable])
    } else {
      this._worker.postMessage({ target, ...data })
    }
  }

  /** @internal */
  private _fetchFromWorker<T = any>(workerOptions: {
    target: string
    requestId?: number
    timeoutMs?: number | null
    transferable?: Transferable[]
    [key: string]: any
  }): Promise<T> {
    return new Promise((resolve, reject) => {
      let cleanup = (): void => {}
      try {
        if (this._destroyed) throw new Error('Renderer was destroyed before the worker request started')
        const { timeoutMs = 5000, transferable, ...workerMessage } = workerOptions
        const target = workerMessage.target

        const timeout =
          timeoutMs === null
            ? null
            : setTimeout(() => {
                cleanup()
                reject(new Error('Error: Timeout while trying to fetch ' + target))
              }, timeoutMs)

        const handleMessage = (event: MessageEvent) => {
          if (
            event.data.target === target &&
            (workerMessage.requestId === undefined || event.data.requestId === workerMessage.requestId)
          ) {
            cleanup()
            resolve(event.data as T)
          }
        }

        const handleError = (event: ErrorEvent | Error) => {
          cleanup()
          reject(event instanceof Error ? event : event.error || new Error('Worker error'))
        }

        const handleDestroyed = (error: Error) => {
          cleanup()
          reject(error)
        }

        cleanup = () => {
          this._worker.removeEventListener('message', handleMessage)
          this._worker.removeEventListener('error', handleError as any)
          this._pendingWorkerRejectors.delete(handleDestroyed)
          if (timeout !== null) clearTimeout(timeout)
        }

        this._worker.addEventListener('message', handleMessage)
        this._worker.addEventListener('error', handleError as any)
        this._pendingWorkerRejectors.add(handleDestroyed)
        if (transferable?.length) {
          this._worker.postMessage({ ...workerMessage, transferable }, transferable)
        } else {
          this._worker.postMessage(workerMessage)
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  /** @internal */
  private _cues(data: { time: number; entered: CueEvent[]; exited: CueEvent[] }): void {
    for (const cue of data.exited) {
      this._onCueExit?.(cue)
      this.dispatchEvent(new CustomEvent('cueExit', { detail: cue }))
    }
    for (const cue of data.entered) {
      this._onCueEnter?.(cue)
      this.dispatchEvent(new CustomEvent('cueEnter', { detail: cue }))
    }
  }

  /** @internal */
  private _renderInfo(data: {
    time: number
    cached: boolean
    renderTimeMs: number
    imageCount: number
    framesDropped: number
    pendingRenders: number
  }): void {
    const event: RenderEvent = {
      time: data.time,
      imageCount: data.imageCount,
      renderTimeMs: data.renderTimeMs,
      rendererType: this._rendererType,
      cached: data.cached
    }
    this._onRender?.(event)
    this.dispatchEvent(new CustomEvent('render', { detail: event }))
    this._emitPerformanceWarnings({
      renderTimeMs: data.renderTimeMs,
      droppedDelta: data.framesDropped,
      pendingRenders: Math.max(data.pendingRenders, this._pendingDemandTimes.length)
    })
  }

  /** @internal */
  private _emitPerformanceWarnings(sample: {
    renderTimeMs?: number
    droppedDelta?: number
    pendingRenders?: number
  }): void {
    const warnings = classifyPerformanceWarnings({
      ...sample,
      maxPendingRenders: AkariSub.MAX_PENDING_DEMANDS
    })
    for (const warning of warnings) {
      this._onPerformanceWarning?.(warning)
      this.dispatchEvent(new CustomEvent('performanceWarning', { detail: warning }))
    }
  }

  /** @internal */
  private _console(data: { content: string; command: string }): void {
    ;(console as any)[data.command].apply(console, JSON.parse(data.content))
  }

  /** @internal */
  private _onmessage(event: MessageEvent): void {
    const target = event.data.target
    if (target === 'error') {
      this._error(event.data.error || 'Unknown worker error')
      return
    }
    const handler = (this as any)['_' + target]
    if (handler) {
      handler.call(this, event.data)
    }
  }

  /** @internal */
  private _error(err: Error | ErrorEvent | string): Error {
    const error =
      err instanceof Error
        ? err
        : err instanceof ErrorEvent
          ? err.error || new Error(err.message)
          : new Error(String(err))

    const event = err instanceof Event ? new ErrorEvent(err.type, err) : new ErrorEvent('error', { error })

    this.dispatchEvent(event)
    console.error(error)

    return error
  }

  /** @internal */
  private _removeListeners(): void {
    this._cancelRVFC()

    if (this._video) {
      if (this._ro) this._ro.unobserve(this._video)
      if (this._ctx) this._ctx.filter = 'none'

      this._video.removeEventListener('timeupdate', this._boundTimeUpdate)
      this._video.removeEventListener('progress', this._boundTimeUpdate)
      this._video.removeEventListener('play', this._boundTimeUpdate)
      this._video.removeEventListener('pause', this._boundTimeUpdate)
      this._video.removeEventListener('ended', this._boundTimeUpdate)
      this._video.removeEventListener('waiting', this._boundTimeUpdate)
      this._video.removeEventListener('stalled', this._boundTimeUpdate)
      this._video.removeEventListener('seeking', this._boundTimeUpdate)
      this._video.removeEventListener('seeked', this._boundTimeUpdate)
      this._video.removeEventListener('playing', this._boundTimeUpdate)
      this._video.removeEventListener('ratechange', this._boundSetRate)
      this._video.removeEventListener('resize', this._boundResize)
      this._video.removeEventListener('loadedmetadata', this._boundUpdateColorSpace)
    }
  }

  /**
   * Tear down the overlay, GPU renderer, and worker.
   *
   * @param err Optional error to report through the `error` event.
   * @returns The same error object when `err` was passed, otherwise `undefined`.
   */
  destroy(err?: Error | string): Error | undefined {
    const error = err ? this._error(err) : undefined

    if (this._destroyed) return error

    if (this._refreshRafHandle != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._refreshRafHandle)
      this._refreshRafHandle = null
    }
    this._clearPreparedFrames(false)

    if (this._video && this._canvasParent) {
      this._video.parentNode?.removeChild(this._canvasParent)
    }

    if (this._gpuRenderer) {
      this._gpuRenderer.destroy()
      this._gpuRenderer = null
      this._rendererType = 'canvas2d'
    }

    this._destroyed = true
    this._resolveDestroyed?.()
    const destroyedError = new Error('Renderer was destroyed before the worker request completed')
    for (const rejectPending of [...this._pendingWorkerRejectors]) rejectPending(destroyedError)
    this._removeListeners()
    if (this._workerReady) this._postWorkerMessage('destroy')
    this._worker?.terminate()

    return error
  }
}
