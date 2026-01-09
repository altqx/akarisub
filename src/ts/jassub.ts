/**
 * Main JASSUB class - TypeScript implementation.
 * High-level ASS/SSA subtitle renderer for web browsers using libass.
 */

import type {
  JASSUBOptions,
  ASSEvent,
  ASSStyle,
  ASSEventCallback,
  ASSStyleCallback,
  PerformanceStatsCallback,
  ResetStatsCallback,
  PerformanceStats,
  RenderImage,
  RenderTimes,
  VideoFrameCallbackMetadata,
  SubtitleColorSpace,
  WebYCbCrColorSpace
} from './types'
import {
  webYCbCrMap,
  colorMatrixConversionMap,
  computeCanvasSize,
  getVideoPosition,
  fixAlpha,
  getAlphaBug,
  getBitmapBug
} from './utils'

/**
 * JASSUB - JavaScript ASS/SSA Subtitle Renderer
 *
 * Renders ASS/SSA subtitles on an HTML5 video element using libass compiled to WebAssembly.
 *
 * @example
 * ```typescript
 * const renderer = new JASSUB({
 *   video: document.querySelector('video'),
 *   subUrl: '/subtitles/example.ass',
 *   workerUrl: '/jassub-worker.js'
 * });
 *
 * // Later, cleanup
 * renderer.destroy();
 * ```
 */
export default class JASSUB extends EventTarget {
  // Feature detection cache (static)
  private static _hasAlphaBug: boolean | null = null
  private static _hasBitmapBug: boolean | null = null

  // Instance properties
  private _loaded: Promise<void>
  private _init!: () => void
  private _onDemandRender: boolean
  private _offscreenRender: boolean
  private _video?: HTMLVideoElement
  private _videoWidth: number = 0
  private _videoHeight: number = 0
  private _videoColorSpace: WebYCbCrColorSpace | null = null
  private _canvas!: HTMLCanvasElement
  private _canvasParent?: HTMLDivElement
  private _bufferCanvas: HTMLCanvasElement
  private _bufferCtx: CanvasRenderingContext2D
  private _canvasctrl!: HTMLCanvasElement | OffscreenCanvas
  private _ctx: CanvasRenderingContext2D | false | null = null
  private _lastRenderTime: number = 0
  private _playstate: boolean = true
  private _destroyed: boolean = false
  private _ro?: ResizeObserver
  private _worker: Worker
  private _lastDemandTime: { mediaTime: number; width: number; height: number } | null = null

  // Bound methods for event listeners
  private _boundResize: () => void
  private _boundTimeUpdate: (e: Event) => void
  private _boundSetRate: () => void
  private _boundUpdateColorSpace: () => void

  // Public properties
  public timeOffset: number
  public debug: boolean
  public prescaleFactor: number
  public prescaleHeightLimit: number
  public maxRenderHeight: number
  public busy: boolean = false

  constructor(options: JASSUBOptions) {
    super()

    if (!globalThis.Worker) {
      throw this.destroy(new Error('Worker not supported'))
    }
    if (!options) {
      throw this.destroy(new Error('No options provided'))
    }

    this._loaded = new Promise((resolve) => {
      this._init = resolve
    })

    // Run feature tests
    const test = JASSUB._test()

    this._onDemandRender =
      'requestVideoFrameCallback' in HTMLVideoElement.prototype && (options.onDemandRender ?? true)

    // Don't support offscreen rendering on custom canvases
    this._offscreenRender =
      'transferControlToOffscreen' in HTMLCanvasElement.prototype &&
      !options.canvas &&
      (options.offscreenRender ?? true)

    this.timeOffset = options.timeOffset || 0
    this._video = options.video
    this._canvas = options.canvas!

    if (this._video && !this._canvas) {
      this._canvasParent = document.createElement('div')
      this._canvasParent.className = 'JASSUB'
      this._canvasParent.style.position = 'relative'
      this._canvas = this._createCanvas()
      this._video.insertAdjacentElement('afterend', this._canvasParent)
    } else if (!this._canvas) {
      throw this.destroy(new Error("Don't know where to render: you should give video or canvas in options."))
    }

    this._bufferCanvas = document.createElement('canvas')
    const bufferCtx = this._bufferCanvas.getContext('2d')
    if (!bufferCtx) throw this.destroy(new Error('Canvas rendering not supported'))
    this._bufferCtx = bufferCtx

    this._canvasctrl = this._offscreenRender
      ? (this._canvas as HTMLCanvasElement & { transferControlToOffscreen(): OffscreenCanvas }).transferControlToOffscreen()
      : this._canvas

    this._ctx = !this._offscreenRender ? (this._canvasctrl as HTMLCanvasElement).getContext('2d') : null

    this._lastRenderTime = 0
    this.debug = !!options.debug
    this.prescaleFactor = options.prescaleFactor || 1.0
    this.prescaleHeightLimit = options.prescaleHeightLimit || 1080
    this.maxRenderHeight = options.maxRenderHeight || 0

    // Bind methods
    this._boundResize = this.resize.bind(this)
    this._boundTimeUpdate = this._timeupdate.bind(this)
    this._boundSetRate = () => this.setRate((this._video as HTMLVideoElement).playbackRate)
    this._boundUpdateColorSpace = this._updateColorSpace.bind(this)

    if (this._video) {
      this.setVideo(this._video)
    }

    if (this._onDemandRender) {
      this.busy = false
      this._lastDemandTime = null
    }

    // Create worker
    this._worker = new Worker(options.workerUrl || 'jassub-worker.js')
    this._worker.onmessage = (e) => this._onmessage(e)
    this._worker.onerror = (e) => this._error(e)

    // Initialize worker after feature tests complete
    test.then(() => {
      this._worker.postMessage({
        target: 'init',
        wasmUrl: options.wasmUrl ?? 'jassub-worker.wasm',
        asyncRender: typeof createImageBitmap !== 'undefined' && (options.asyncRender ?? true),
        onDemandRender: this._onDemandRender,
        width: this._canvasctrl.width || 0,
        height: this._canvasctrl.height || 0,
        blendMode: options.blendMode || 'js',
        subUrl: options.subUrl,
        subContent: options.subContent || null,
        fonts: options.fonts || [],
        availableFonts: options.availableFonts || { 'liberation sans': './default.woff2' },
        fallbackFont: options.fallbackFont || 'liberation sans',
        debug: this.debug,
        targetFps: options.targetFps || 24,
        dropAllAnimations: options.dropAllAnimations,
        dropAllBlur: options.dropAllBlur,
        clampPos: options.clampPos,
        libassMemoryLimit: options.libassMemoryLimit ?? 128,
        libassGlyphLimit: options.libassGlyphLimit ?? 2048,
        useLocalFonts: typeof (globalThis as any).queryLocalFonts !== 'undefined' && (options.useLocalFonts ?? true),
        hasBitmapBug: JASSUB._hasBitmapBug
      })

      if (this._offscreenRender) {
        this.sendMessage('offscreenCanvas', {}, [this._canvasctrl as OffscreenCanvas])
      }
    })
  }

  // ==========================================================================
  // Static Methods
  // ==========================================================================

  private static async _testImageBugs(): Promise<void> {
    if (JASSUB._hasBitmapBug !== null) return

    const canvas1 = document.createElement('canvas')
    const ctx1 = canvas1.getContext('2d', { willReadFrequently: true })
    if (!ctx1) throw new Error('Canvas rendering not supported')

    // Test ImageData constructor
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

    JASSUB._hasAlphaBug = prePut[1] !== postPut[1]
    if (JASSUB._hasAlphaBug) {
      console.log('Detected a browser having issue with transparent pixels, applying workaround')
    }

    if (typeof createImageBitmap !== 'undefined') {
      const subarray = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5)
      ctx2.drawImage(await createImageBitmap(new ImageData(subarray, 1)), 0, 0)
      const { data } = ctx2.getImageData(0, 0, 1, 1)
      JASSUB._hasBitmapBug = false

      for (let i = 0; i < data.length; i++) {
        if (Math.abs(subarray[i] - data[i]) > 15) {
          JASSUB._hasBitmapBug = true
          console.log('Detected a browser having issue with partial bitmaps, applying workaround')
          break
        }
      }
    } else {
      JASSUB._hasBitmapBug = false
    }

    canvas1.remove()
    canvas2.remove()
  }

  private static async _test(): Promise<void> {
    await JASSUB._testImageBugs()
  }

  // ==========================================================================
  // Canvas Management
  // ==========================================================================

  private _createCanvas(): HTMLCanvasElement {
    this._canvas = document.createElement('canvas')
    this._canvas.style.display = 'block'
    this._canvas.style.position = 'absolute'
    this._canvas.style.pointerEvents = 'none'
    this._canvasParent!.appendChild(this._canvas)
    return this._canvas
  }

  /**
   * Resize the canvas to given parameters. Auto-generated if values are omitted.
   */
  resize(width: number = 0, height: number = 0, top: number = 0, left: number = 0, force: boolean = this._video?.paused ?? false): void {
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

    if (force && this.busy === false) {
      this.busy = true
    } else {
      force = false
    }

    this.sendMessage('canvas', {
      width,
      height,
      videoWidth: this._videoWidth || this._video?.videoWidth || 0,
      videoHeight: this._videoHeight || this._video?.videoHeight || 0,
      force
    })
  }

  // ==========================================================================
  // Video Management
  // ==========================================================================

  private _timeupdate(event: Event): void {
    const eventmap: Record<string, boolean> = {
      seeking: true,
      waiting: true,
      playing: false
    }
    const playing = eventmap[event.type]
    if (playing != null) this._playstate = playing
    this.setCurrentTime(this._video!.paused || this._playstate, this._video!.currentTime + this.timeOffset)
  }

  /**
   * Change the video to use as target for event listeners.
   */
  setVideo(video: HTMLVideoElement): void {
    if (video instanceof HTMLVideoElement) {
      this._removeListeners()
      this._video = video

      if (this._onDemandRender) {
        (video as any).requestVideoFrameCallback(this._handleRVFC.bind(this))
      } else {
        this._playstate = video.paused

        video.addEventListener('timeupdate', this._boundTimeUpdate, false)
        video.addEventListener('progress', this._boundTimeUpdate, false)
        video.addEventListener('waiting', this._boundTimeUpdate, false)
        video.addEventListener('seeking', this._boundTimeUpdate, false)
        video.addEventListener('playing', this._boundTimeUpdate, false)
        video.addEventListener('ratechange', this._boundSetRate, false)
        video.addEventListener('resize', this._boundResize, false)
      }

      if ('VideoFrame' in window) {
        video.addEventListener('loadedmetadata', this._boundUpdateColorSpace, false)
        if (video.readyState > 2) this._updateColorSpace()
      }

      if (video.videoWidth > 0) this.resize()

      if (typeof ResizeObserver !== 'undefined') {
        if (!this._ro) this._ro = new ResizeObserver(() => this.resize())
        this._ro.observe(video)
      }
    } else {
      this._error(new Error('Video element invalid!'))
    }
  }

  /**
   * Run a benchmark on the worker.
   */
  runBenchmark(): void {
    this.sendMessage('runBenchmark')
  }

  // ==========================================================================
  // Track Management
  // ==========================================================================

  /**
   * Overwrites the current subtitle content by URL.
   */
  setTrackByUrl(url: string): void {
    this.sendMessage('setTrackByUrl', { url })
    this._reAttachOffscreen()
    if (this._ctx) this._ctx.filter = 'none'
  }

  /**
   * Overwrites the current subtitle content.
   */
  setTrack(content: string): void {
    this.sendMessage('setTrack', { content })
    this._reAttachOffscreen()
    if (this._ctx) this._ctx.filter = 'none'
  }

  /**
   * Free currently used subtitle track.
   */
  freeTrack(): void {
    this.sendMessage('freeTrack')
  }

  // ==========================================================================
  // Playback Control
  // ==========================================================================

  /**
   * Sets the playback state of the media.
   */
  setIsPaused(isPaused: boolean): void {
    this.sendMessage('video', { isPaused })
  }

  /**
   * Sets the playback rate of the media.
   */
  setRate(rate: number): void {
    this.sendMessage('video', { rate })
  }

  /**
   * Sets the current time, playback state and rate of the subtitles.
   */
  setCurrentTime(isPaused?: boolean, currentTime?: number, rate?: number): void {
    this.sendMessage('video', {
      isPaused,
      currentTime,
      rate,
      colorSpace: this._videoColorSpace
    })
  }

  // ==========================================================================
  // Event Management
  // ==========================================================================

  /**
   * Create a new ASS event directly.
   */
  createEvent(event: Partial<ASSEvent>): void {
    this.sendMessage('createEvent', { event })
  }

  /**
   * Overwrite the data of the event with the specified index.
   */
  setEvent(event: Partial<ASSEvent>, index: number): void {
    this.sendMessage('setEvent', { event, index })
  }

  /**
   * Remove the event with the specified index.
   */
  removeEvent(index: number): void {
    this.sendMessage('removeEvent', { index })
  }

  /**
   * Get all ASS events.
   */
  getEvents(callback: ASSEventCallback): void {
    this._fetchFromWorker({ target: 'getEvents' }, (err, data) => {
      callback(err, (data as any)?.events ?? [])
    })
  }

  // ==========================================================================
  // Style Management
  // ==========================================================================

  /**
   * Set a style override.
   */
  styleOverride(style: Partial<ASSStyle>): void {
    this.sendMessage('styleOverride', { style })
  }

  /**
   * Disable style override.
   */
  disableStyleOverride(): void {
    this.sendMessage('disableStyleOverride')
  }

  /**
   * Create a new ASS style directly.
   */
  createStyle(style: Partial<ASSStyle>): void {
    this.sendMessage('createStyle', { style })
  }

  /**
   * Overwrite the data of the style with the specified index.
   */
  setStyle(style: Partial<ASSStyle>, index: number): void {
    this.sendMessage('setStyle', { style, index })
  }

  /**
   * Remove the style with the specified index.
   */
  removeStyle(index: number): void {
    this.sendMessage('removeStyle', { index })
  }

  /**
   * Get all ASS styles.
   */
  getStyles(callback: ASSStyleCallback): void {
    this._fetchFromWorker({ target: 'getStyles' }, (err, data) => {
      callback(err, (data as any)?.styles ?? [])
    })
  }

  // ==========================================================================
  // Font Management
  // ==========================================================================

  /**
   * Adds a font to the renderer.
   */
  addFont(font: string | Uint8Array): void {
    this.sendMessage('addFont', { font })
  }

  /**
   * Changes the font family of the default font.
   */
  setDefaultFont(font: string): void {
    this.sendMessage('defaultFont', { font })
  }

  // ==========================================================================
  // Performance Stats
  // ==========================================================================

  /**
   * Get real-time performance statistics.
   */
  getStats(callback: PerformanceStatsCallback): void {
    this._fetchFromWorker({ target: 'getStats' }, (err, data) => {
      if (err) return callback(err, null)
      const stats = (data as any)?.stats as Partial<PerformanceStats>
      const augmented: PerformanceStats = {
        framesRendered: stats.framesRendered ?? 0,
        framesDropped: stats.framesDropped ?? 0,
        avgRenderTime: stats.avgRenderTime ?? 0,
        maxRenderTime: stats.maxRenderTime ?? 0,
        minRenderTime: stats.minRenderTime ?? 0,
        lastRenderTime: stats.lastRenderTime ?? 0,
        pendingRenders: stats.pendingRenders ?? 0,
        totalEvents: stats.totalEvents ?? 0,
        cacheHits: stats.cacheHits ?? 0,
        cacheMisses: stats.cacheMisses ?? 0,
        renderFps: stats.avgRenderTime && stats.avgRenderTime > 0 ? Math.round(1000 / stats.avgRenderTime) : 0,
        usingWorker: true,
        offscreenRender: this._offscreenRender,
        onDemandRender: this._onDemandRender
      }
      callback(null, augmented)
    })
  }

  /**
   * Reset performance statistics counters.
   */
  resetStats(callback?: ResetStatsCallback): void {
    this._fetchFromWorker({ target: 'resetStats' }, (err) => {
      if (callback) callback(err)
    })
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private _sendLocalFont(name: string): void {
    try {
      ;(globalThis as any).queryLocalFonts().then((fontData: any[]) => {
        const font = fontData?.find((obj: any) => obj.fullName.toLowerCase() === name)
        if (font) {
          font.blob().then((blob: Blob) => {
            blob.arrayBuffer().then((buffer: ArrayBuffer) => {
              this.addFont(new Uint8Array(buffer))
            })
          })
        }
      })
    } catch (e) {
      console.warn('Local fonts API:', e)
    }
  }

  private _getLocalFont(data: { font: string }): void {
    try {
      if (navigator?.permissions?.query) {
        ;(navigator.permissions.query as any)({ name: 'local-fonts' }).then((permission: any) => {
          if (permission.state === 'granted') {
            this._sendLocalFont(data.font)
          }
        })
      } else {
        this._sendLocalFont(data.font)
      }
    } catch (e) {
      console.warn('Local fonts API:', e)
    }
  }

  private _unbusy(): void {
    if (this._lastDemandTime) {
      this._demandRender(this._lastDemandTime)
    } else {
      this.busy = false
    }
  }

  private _handleRVFC(_now: number, metadata: VideoFrameCallbackMetadata): void {
    if (this._destroyed) return

    if (this.busy) {
      this._lastDemandTime = { mediaTime: metadata.mediaTime, width: metadata.width, height: metadata.height }
    } else {
      this.busy = true
      this._demandRender({ mediaTime: metadata.mediaTime, width: metadata.width, height: metadata.height })
    }

    ;(this._video as any).requestVideoFrameCallback(this._handleRVFC.bind(this))
  }

  private _demandRender(metadata: { mediaTime: number; width: number; height: number }): void {
    this._lastDemandTime = null

    if (metadata.width !== this._videoWidth || metadata.height !== this._videoHeight) {
      this._videoWidth = metadata.width
      this._videoHeight = metadata.height
      this.resize()
    }

    this.sendMessage('demand', { time: metadata.mediaTime + this.timeOffset })
  }

  private _detachOffscreen(): void {
    if (!this._offscreenRender || this._ctx) return

    this._canvas.remove()
    this._createCanvas()
    this._canvasctrl = this._canvas
    this._ctx = this._canvasctrl.getContext('2d')
    this.sendMessage('detachOffscreen')
    this.busy = false
    this.resize(0, 0, 0, 0, true)
  }

  private _reAttachOffscreen(): void {
    if (!this._offscreenRender || !this._ctx) return

    this._canvas.remove()
    this._createCanvas()
    this._canvasctrl = (this._canvas as any).transferControlToOffscreen()
    this._ctx = false
    this.sendMessage('offscreenCanvas', {}, [this._canvasctrl as OffscreenCanvas])
    this.resize(0, 0, 0, 0, true)
  }

  private _updateColorSpace(): void {
    ;(this._video as any).requestVideoFrameCallback(() => {
      try {
        const frame = new (globalThis as any).VideoFrame(this._video)
        this._videoColorSpace = webYCbCrMap[frame.colorSpace.matrix] ?? null
        frame.close()
        this.sendMessage('getColorSpace')
      } catch (e) {
        console.warn(e)
      }
    })
  }

  private _verifyColorSpace(data: { subtitleColorSpace: SubtitleColorSpace; videoColorSpace?: WebYCbCrColorSpace | null }): void {
    const { subtitleColorSpace, videoColorSpace = this._videoColorSpace } = data

    if (!subtitleColorSpace || !videoColorSpace) return
    if (subtitleColorSpace === videoColorSpace) return

    this._detachOffscreen()

    const matrix = colorMatrixConversionMap[subtitleColorSpace]?.[videoColorSpace]
    if (matrix && this._ctx) {
      this._ctx.filter = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${matrix} 0 0 0 0 0 1 0'/></filter></svg>#f")`
    }
  }

  private _render(data: {
    images: RenderImage[]
    asyncRender: boolean
    times: RenderTimes
    width: number
    height: number
    colorSpace: SubtitleColorSpace
  }): void {
    this._unbusy()

    if (this.debug) {
      data.times.IPCTime = Date.now() - (data.times.JSRenderTime || 0)
    }

    if (this._canvasctrl.width !== data.width || this._canvasctrl.height !== data.height) {
      this._canvasctrl.width = data.width
      this._canvasctrl.height = data.height
      this._verifyColorSpace({ subtitleColorSpace: data.colorSpace })
    }

    if (!this._ctx) return

    this._ctx.clearRect(0, 0, this._canvasctrl.width, this._canvasctrl.height)

    for (const image of data.images) {
      if (image.image) {
        if (data.asyncRender) {
          this._ctx.drawImage(image.image as ImageBitmap, image.x, image.y)
          ;(image.image as ImageBitmap).close()
        } else {
          this._bufferCanvas.width = image.w
          this._bufferCanvas.height = image.h
          const rawData = new Uint8ClampedArray(image.image as ArrayBuffer)
          const fixedData = fixAlpha(rawData, JASSUB._hasAlphaBug ?? false)
          this._bufferCtx.putImageData(
            new ImageData(fixedData as Uint8ClampedArray<ArrayBuffer>, image.w, image.h),
            0,
            0
          )
          this._ctx.drawImage(this._bufferCanvas, image.x, image.y)
        }
      }
    }

    if (this.debug) {
      data.times.JSRenderTime = Date.now() - (data.times.JSRenderTime || 0) - (data.times.IPCTime || 0)
      let total = 0
      const count = data.times.bitmaps || data.images.length
      delete data.times.bitmaps

      for (const key in data.times) {
        total += (data.times as any)[key] || 0
      }

      console.log('Bitmaps: ' + count + ' Total: ' + (total | 0) + 'ms', data.times)
    }
  }

  private _ready(): void {
    this._init()
    this.dispatchEvent(new CustomEvent('ready'))
  }

  /**
   * Send data and execute function in the worker.
   */
  async sendMessage(target: string, data: Record<string, any> = {}, transferable?: Transferable[]): Promise<void> {
    await this._loaded

    if (transferable) {
      this._worker.postMessage({ target, transferable, ...data }, [...transferable])
    } else {
      this._worker.postMessage({ target, ...data })
    }
  }

  private _fetchFromWorker(
    workerOptions: { target: string },
    callback: (err: Error | null, data?: any) => void
  ): void {
    try {
      const target = workerOptions.target

      const timeout = setTimeout(() => {
        reject(new Error('Error: Timeout while trying to fetch ' + target))
      }, 5000)

      const resolve = (event: MessageEvent) => {
        if (event.data.target === target) {
          callback(null, event.data)
          this._worker.removeEventListener('message', resolve)
          this._worker.removeEventListener('error', reject)
          clearTimeout(timeout)
        }
      }

      const reject = (event: ErrorEvent | Error) => {
        callback(event instanceof Error ? event : event.error || new Error('Worker error'))
        this._worker.removeEventListener('message', resolve)
        this._worker.removeEventListener('error', reject as any)
        clearTimeout(timeout)
      }

      this._worker.addEventListener('message', resolve)
      this._worker.addEventListener('error', reject as any)

      this._worker.postMessage(workerOptions)
    } catch (error) {
      this._error(error as Error)
    }
  }

  private _console(data: { content: string; command: string }): void {
    ;(console as any)[data.command].apply(console, JSON.parse(data.content))
  }

  private _onmessage(event: MessageEvent): void {
    const handler = (this as any)['_' + event.data.target]
    if (handler) {
      handler.call(this, event.data)
    }
  }

  private _error(err: Error | ErrorEvent | string): Error {
    const error =
      err instanceof Error
        ? err
        : err instanceof ErrorEvent
          ? err.error || new Error(err.message)
          : new Error(String(err))

    const event =
      err instanceof Event ? new ErrorEvent(err.type, err) : new ErrorEvent('error', { error })

    this.dispatchEvent(event)
    console.error(error)

    return error
  }

  private _removeListeners(): void {
    if (this._video) {
      if (this._ro) this._ro.unobserve(this._video)
      if (this._ctx) this._ctx.filter = 'none'

      this._video.removeEventListener('timeupdate', this._boundTimeUpdate)
      this._video.removeEventListener('progress', this._boundTimeUpdate)
      this._video.removeEventListener('waiting', this._boundTimeUpdate)
      this._video.removeEventListener('seeking', this._boundTimeUpdate)
      this._video.removeEventListener('playing', this._boundTimeUpdate)
      this._video.removeEventListener('ratechange', this._boundSetRate)
      this._video.removeEventListener('resize', this._boundResize)
      this._video.removeEventListener('loadedmetadata', this._boundUpdateColorSpace)
    }
  }

  /**
   * Destroy the object, worker, listeners and all data.
   */
  destroy(err?: Error | string): Error | undefined {
    const error = err ? this._error(err) : undefined

    if (this._video && this._canvasParent) {
      this._video.parentNode?.removeChild(this._canvasParent)
    }

    this._destroyed = true
    this._removeListeners()
    this.sendMessage('destroy')
    this._worker?.terminate()

    return error
  }
}
