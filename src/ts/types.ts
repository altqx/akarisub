export interface ASSEvent {
  Start: number
  Duration: number
  Style: string
  /** Character name (for information only) */
  Name: string
  MarginL: number
  MarginR: number
  MarginV: number
  Effect: string
  Text: string
  ReadOrder: number
  Layer: number
  _index?: number
}

export interface ASSStyle {
  /** Style name (case sensitive) */
  Name: string
  FontName: string
  FontSize: number
  /** RGBA packed as uint32 */
  PrimaryColour: number
  /** RGBA packed as uint32 */
  SecondaryColour: number
  /** RGBA packed as uint32 */
  OutlineColour: number
  /** RGBA packed as uint32 */
  BackColour: number
  /** Bold (-1 = true, 0 = false) */
  Bold: number
  /** Italic (-1 = true, 0 = false) */
  Italic: number
  /** Underline (-1 = true, 0 = false) */
  Underline: number
  /** StrikeOut (-1 = true, 0 = false) */
  StrikeOut: number
  /** Width scale percent */
  ScaleX: number
  /** Height scale percent */
  ScaleY: number
  Spacing: number
  Angle: number
  /** Border style (1 = outline + shadow, 3 = opaque box) */
  BorderStyle: number
  Outline: number
  Shadow: number
  /** Alignment (1-9, numpad style) */
  Alignment: number
  MarginL: number
  MarginR: number
  MarginV: number
  Encoding: number
  treat_fontname_as_pattern: number
  Blur: number
  Justify: number
}

export interface PerformanceStats {
  framesRendered: number
  framesDropped: number
  avgRenderTime: number
  maxRenderTime: number
  minRenderTime: number
  lastRenderTime: number
  /** Current automatically learned presentation-latency compensation in milliseconds */
  timingCompensationMs?: number
  /** Number of image planes emitted by the last render */
  lastImageCount?: number
  /** Total RGBA/raw image pixels emitted by the last render */
  lastImagePixels?: number
  renderFps: number
  usingWorker: boolean
  /** Whether worker-side raw ASS_Image WebGL2 composition is active */
  rawAssImageGpu?: boolean
  workerRenderer?: 'webgl2-raw-ass' | 'canvas2d' | 'hybrid' | 'main-thread'
  offscreenRender: boolean
  onDemandRender: boolean
  pendingRenders: number
  totalEvents: number
  cacheHits: number
  cacheMisses: number
}

/** Encoded-frame timestamps with optional media/subtitle clock offsets. */
export interface FrameTimeline extends ArrayLike<number> {
  /** Origin subtracted from raw browser media timestamps when locating a frame. */
  mediaTimeOrigin?: number
  /** Signed offset subtracted from frame time when sampling libass. */
  subtitleTimeOffset?: number
}

export interface AkariSubOptions {
  video?: HTMLVideoElement
  canvas?: HTMLCanvasElement
  /** Image blending mode: 'js' for hardware acceleration, 'wasm' for software */
  blendMode?: 'js' | 'wasm'
  /** Use async rendering with ImageBitmap (default: true) */
  asyncRender?: boolean
  /** Use offscreen canvas rendering (default: true for video-managed canvases, false for custom canvases) */
  offscreenRender?: boolean
  /** Use worker-side raw ASS_Image WebGL2 composition (default: false) */
  rawAssImageGpu?: boolean
  /** Use requestVideoFrameCallback for precise sync (default: true) */
  onDemandRender?: boolean
  /** Compensate measured render/presentation latency while playing (default: true) */
  adaptiveTiming?: boolean
  /** Encoded video-frame timestamps and optional browser/subtitle clock offsets, in seconds */
  frameTimeline?: FrameTimeline
  /** Number of exact subtitle frames to prepare ahead (default: 2) */
  framePrefetch?: number
  /** Target FPS when not using onDemandRender (default: 24) */
  targetFps?: number
  /** Time offset in seconds (default: 0) */
  timeOffset?: number
  /** Enable debug logging (default: false) */
  debug?: boolean
  /** Scale factor for subtitles (default: 1.0) */
  prescaleFactor?: number
  /** Height limit for prescaling (default: 1080) */
  prescaleHeightLimit?: number
  /** Maximum render height, 0 = no limit (default: 0) */
  maxRenderHeight?: number
  /** Attempt to drop all animations (default: false) */
  dropAllAnimations?: boolean
  /** Drop all blur effects for performance (default: false) */
  dropAllBlur?: boolean
  /** Clamp \\pos values to script resolution (default: false) */
  clampPos?: boolean
  workerUrl?: string
  wasmUrl?: string
  subUrl?: string
  subContent?: string | Uint8Array | ArrayBuffer
  /** Encrypted subtitle content decrypted inside the worker before loading into libass */
  encryptedSubContent?: EncryptedSubtitleContent
  fonts?: (string | Uint8Array)[]
  availableFonts?: Record<string, string | Uint8Array>
  /** Fallback font families in order (default: ['liberation sans']). Fontconfig uses these for cascade. */
  fallbackFonts?: string[]
  /** Use Local Font Access API for OS font lookup (default: true if available) */
  useLocalFonts?: boolean
  /** Use libass fontconfig provider for virtual/packaged font lookup (default: true) */
  useFontconfigProvider?: boolean
  /** libass bitmap cache memory limit in MiB */
  libassMemoryLimit?: number
  /** libass glyph cache limit */
  libassGlyphLimit?: number
  /** Callback invoked when all GPU renderers (WebGPU, WebGL2) are unavailable and the renderer falls back to Canvas2D */
  onCanvasFallback?: () => void
  /** Additional time in seconds to render subtitles ahead, on top of adaptive timing (default: 0) */
  renderAhead?: number
  /** Pre-render early track windows after load to warm libass caches (default: false) */
  fullTrackWarmup?: boolean
  /** Wait for fullTrackWarmup to finish before ready (default: false) */
  blockingFullTrackWarmup?: boolean
  /** Step in seconds for fullTrackWarmup; lower values warm more frames (default: 1) */
  fullTrackWarmupStep?: number
  /** Allow adaptive CPU preblend layouts for text-heavy frames (default: false) */
  adaptiveBlendLayouts?: boolean
}

export interface EncryptedSubtitleContent {
  /** Non-extractable AES-GCM content key from akari-crypto's v2 transport flow */
  contentKey: CryptoKey
  /** Single encrypted subtitle payload */
  encrypted?: ArrayBuffer
  /** Chunked encrypted subtitle payloads, in display file order */
  encryptedChunks?: ArrayBuffer[]
}

/** @deprecated Use Promise-based getEvents() instead */
export type ASSEventCallback = (error: Error | null, events: ASSEvent[]) => void
/** @deprecated Use Promise-based getStyles() instead */
export type ASSStyleCallback = (error: Error | null, styles: ASSStyle[]) => void
/** @deprecated Use Promise-based getStats() instead */
export type PerformanceStatsCallback = (error: Error | null, stats: PerformanceStats | null) => void
/** @deprecated Use Promise-based resetStats() instead */
export type ResetStatsCallback = (error: Error | null) => void

export interface RenderImage {
  x: number
  y: number
  w: number
  h: number
  image: ImageBitmap | ArrayBuffer | Uint8Array | Uint8ClampedArray | number
}

/** Raw libass ASS_Image plane exposed directly from WASM for GPU mask composition. */
export interface RawASSImage {
  dst_x: number
  dst_y: number
  w: number
  h: number
  /** Pointer to ASS_Image.bitmap in WASM memory */
  bitmap: number
  /** ASS_Image.color packed as RRGGBBAA */
  color: number
  stride: number
  type: number
}

export interface RenderTimes {
  WASMRenderTime?: number
  WASMBitmapDecodeTime?: number
  JSRenderTime?: number
  JSBitmapGenerationTime?: number
  IPCTime?: number
  bitmaps?: number
}

export interface RenderMessage {
  target: 'render'
  asyncRender: boolean
  images: RenderImage[]
  times: RenderTimes
  width: number
  height: number
  colorSpace: string | null
  requestId?: number
  renderEpoch?: number
  presentationId?: number
}

export type WorkerOutboundMessage =
  | { target: 'ready' }
  | { target: 'trackReady' }
  | { target: 'unbusy'; requestId?: number; renderEpoch?: number; presentationId?: number; painted?: boolean }
  | { target: 'console'; command: string; content: string }
  | { target: 'getLocalFont'; font: string }
  | { target: 'verifyColorSpace'; subtitleColorSpace: string | null }
  | { target: 'getEvents'; events: ASSEvent[] }
  | { target: 'getStyles'; styles: ASSStyle[]; time: number }
  | { target: 'getStats'; stats: Partial<PerformanceStats> }
  | { target: 'resetStats'; success: boolean }
  | { target: 'getEventCount'; count: number }
  | { target: 'getStyleCount'; count: number }
  | RenderMessage

export interface WorkerInitMessage {
  target: 'init'
  wasmUrl: string
  asyncRender: boolean
  fullTrackWarmup: boolean
  blockingFullTrackWarmup: boolean
  fullTrackWarmupStep: number
  adaptiveBlendLayouts: boolean
  rawAssImageGpu: boolean
  onDemandRender: boolean
  initialTime: number
  initialIsPaused: boolean
  initialPlaybackRate: number
  initialTimeSnapshotAtMs: number
  width: number
  height: number
  blendMode: 'js' | 'wasm'
  subUrl?: string
  subContent?: string | Uint8Array | ArrayBuffer | null
  encryptedSubContent?: EncryptedSubtitleContent | null
  fonts: (string | Uint8Array)[]
  availableFonts: Record<string, string | Uint8Array>
  fallbackFonts: string[]
  debug: boolean
  targetFps: number
  renderAhead: number
  adaptiveTiming: boolean
  frameTimelineMode: boolean
  dropAllAnimations?: boolean
  dropAllBlur?: boolean
  clampPos?: boolean
  libassMemoryLimit?: number
  libassGlyphLimit?: number
  useLocalFonts: boolean
  useFontconfigProvider: boolean
  hasBitmapBug: boolean
}

export type WorkerInboundMessage =
  | WorkerInitMessage
  | { target: 'offscreenCanvas'; rawAssImageGpu?: boolean; transferable: [OffscreenCanvas] }
  | { target: 'detachOffscreen' }
  | { target: 'canvas'; width: number; height: number; videoWidth: number; videoHeight: number; force?: boolean }
  | {
      target: 'video'
      currentTime?: number
      isPaused?: boolean
      rate?: number
      renderAhead?: number
      colorSpace?: string | null
    }
  | { target: 'setTrack'; content: string | Uint8Array | ArrayBuffer }
  | { target: 'setEncryptedTrack'; content: EncryptedSubtitleContent }
  | { target: 'setTrackByUrl'; url: string }
  | { target: 'freeTrack' }
  | {
      target: 'demand'
      time: number
      force?: boolean
      requestId?: number
      renderEpoch?: number
      presentationId?: number
    }
  | { target: 'prepare'; time: number; prepareId: number; renderEpoch: number; force?: boolean }
  | { target: 'presentation'; presentationId: number }
  | { target: 'presentFrame'; bitmap: ImageBitmap; presentationId: number }
  | { target: 'frameTimelineMode'; enabled: boolean }
  | { target: 'destroy' }
  | { target: 'addFont'; font: string | Uint8Array }
  | { target: 'defaultFont'; font: string }
  | { target: 'createEvent'; event: Partial<ASSEvent> }
  | { target: 'setEvent'; event: Partial<ASSEvent>; index: number }
  | { target: 'removeEvent'; index: number }
  | { target: 'getEvents' }
  | { target: 'createStyle'; style: Partial<ASSStyle> }
  | { target: 'setStyle'; style: Partial<ASSStyle>; index: number }
  | { target: 'removeStyle'; index: number }
  | { target: 'getStyles' }
  | { target: 'styleOverride'; style: Partial<ASSStyle> }
  | { target: 'disableStyleOverride' }
  | { target: 'getStats' }
  | { target: 'resetStats' }
  | { target: 'getEventCount' }
  | { target: 'getStyleCount' }
  | { target: 'getColorSpace' }

export interface VideoFrameCallbackMetadata {
  mediaTime: number
  width: number
  height: number
  presentedFrames?: number
  processingDuration?: number
  expectedDisplayTime?: number
  presentationTime?: number
}

export type WebYCbCrColorSpace = 'BT709' | 'BT601'
export type SubtitleColorSpace = 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC' | null

export interface AkariSubModule extends EmscriptenModule {
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  _akarisub_create: (width: number, height: number, fallbackFontPtr: number, debug: number) => number
  _akarisub_destroy: (handle: number) => void
  _akarisub_set_drop_animations: (handle: number, value: number) => void
  _akarisub_set_adaptive_blend_layouts: (handle: number, value: number) => void
  _akarisub_create_track_mem: (handle: number, contentPtr: number) => void
  _akarisub_remove_track: (handle: number) => void
  _akarisub_resize_canvas: (
    handle: number,
    width: number,
    height: number,
    videoWidth: number,
    videoHeight: number
  ) => void
  _akarisub_add_font: (handle: number, namePtr: number, dataPtr: number, size: number) => number
  _akarisub_reload_fonts: (handle: number) => void
  _akarisub_set_default_font: (handle: number, fontPtr: number) => void
  _akarisub_set_fallback_fonts: (handle: number, fontsPtr: number) => void
  _akarisub_set_use_fontconfig_provider: (handle: number, enabled: number) => void
  _akarisub_set_memory_limits: (handle: number, glyphLimit: number, memoryLimit: number) => void
  _akarisub_get_event_count: (handle: number) => number
  _akarisub_alloc_event: (handle: number) => number
  _akarisub_remove_event: (handle: number, index: number) => void
  _akarisub_get_style_count: (handle: number) => number
  _akarisub_alloc_style: (handle: number) => number
  _akarisub_remove_style: (handle: number, index: number) => void
  _akarisub_style_override_index: (handle: number, index: number) => void
  _akarisub_disable_style_override: (handle: number) => void
  _akarisub_get_track_color_space: (handle: number) => number
  _akarisub_event_get_int: (handle: number, index: number, field: number) => number
  _akarisub_event_set_int: (handle: number, index: number, field: number, value: number) => void
  _akarisub_event_get_str: (handle: number, index: number, field: number) => number
  _akarisub_event_set_str: (handle: number, index: number, field: number, valuePtr: number) => void
  _akarisub_style_get_num: (handle: number, index: number, field: number) => number
  _akarisub_style_set_num: (handle: number, index: number, field: number, value: number) => void
  _akarisub_style_get_str: (handle: number, index: number, field: number) => number
  _akarisub_style_set_str: (handle: number, index: number, field: number, valuePtr: number) => void
  _akarisub_get_event_time_range: (handle: number, outPtr: number) => number
  _akarisub_get_empty_window: (handle: number, tm: number, outPtr: number) => number
  _akarisub_render_blend_collect: (
    handle: number,
    time: number,
    force: number,
    outPtr: number,
    maxItems: number
  ) => number
  _akarisub_render_image_collect: (
    handle: number,
    time: number,
    force: number,
    outPtr: number,
    maxItems: number
  ) => number
  _akarisub_render_raw_collect: (
    handle: number,
    time: number,
    force: number,
    outPtr: number,
    maxItems: number
  ) => number
  FS_createPath: (parent: string, path: string, canRead: boolean, canWrite: boolean) => void
  FS_createDataFile: (
    parent: string,
    name: string | null,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn?: boolean
  ) => void
}
