/** A single Dialogue or Comment event from an ASS/SSA track. */
export interface ASSEvent {
  /** Start time in seconds. */
  Start: number
  /** Duration in seconds. */
  Duration: number
  /** Style name referenced by this event. */
  Style: string
  /** Character name (for information only) */
  Name: string
  /** Left margin in script pixels. */
  MarginL: number
  /** Right margin in script pixels. */
  MarginR: number
  /** Vertical margin in script pixels. */
  MarginV: number
  /** Transition or karaoke effect string. */
  Effect: string
  /** Dialogue text, including override tags. */
  Text: string
  /** libass read order used to break timestamp ties. */
  ReadOrder: number
  /** Collision layer. */
  Layer: number
  /** Original event index in the loaded track, when known. */
  _index?: number
}

/** A named style from an ASS/SSA `[V4+ Styles]` section. */
export interface ASSStyle {
  /** Style name (case sensitive) */
  Name: string
  /** Typeface family used when the event does not override `\\fn`. */
  FontName: string
  /** Font size in script pixels. */
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
  /** Extra glyph spacing in script pixels. */
  Spacing: number
  /** Z-axis rotation in degrees. */
  Angle: number
  /** Border style (1 = outline + shadow, 3 = opaque box) */
  BorderStyle: number
  /** Outline width in script pixels. */
  Outline: number
  /** Shadow offset in script pixels. */
  Shadow: number
  /** Alignment (1-9, numpad style) */
  Alignment: number
  /** Left margin in script pixels. */
  MarginL: number
  /** Right margin in script pixels. */
  MarginR: number
  /** Vertical margin in script pixels. */
  MarginV: number
  /** Windows charset / encoding id. */
  Encoding: number
  /** When non-zero, `FontName` is treated as a fontconfig pattern. */
  treat_fontname_as_pattern: number
  /** Gaussian blur strength. */
  Blur: number
  /** Horizontal justification used with some alignments. */
  Justify: number
}

/** Snapshot of renderer throughput, latency, and worker mode. */
export interface PerformanceStats {
  /** Number of frames the worker finished. */
  framesRendered: number
  /** Number of frames skipped because a newer demand arrived. */
  framesDropped: number
  /** Mean worker render time in milliseconds. */
  avgRenderTime: number
  /** Slowest worker render time in milliseconds. */
  maxRenderTime: number
  /** Fastest worker render time in milliseconds. */
  minRenderTime: number
  /** Most recent worker render time in milliseconds. */
  lastRenderTime: number
  /** Current automatically learned presentation-latency compensation in milliseconds */
  timingCompensationMs?: number
  /** Number of image planes emitted by the last render */
  lastImageCount?: number
  /** Total RGBA/raw image pixels emitted by the last render */
  lastImagePixels?: number
  /** Estimated frames per second from `avgRenderTime`. */
  renderFps: number
  /** Always true for this renderer; kept for compatibility. */
  usingWorker: boolean
  /** Whether worker-side raw ASS_Image WebGL2 composition is active */
  rawAssImageGpu?: boolean
  /** Backend that composed the last frame. */
  workerRenderer?: 'webgl2-raw-ass' | 'canvas2d' | 'hybrid' | 'main-thread'
  /** Whether the worker owns an OffscreenCanvas. */
  offscreenRender: boolean
  /** Whether `requestVideoFrameCallback` drives presentation. */
  onDemandRender: boolean
  /** Whether the loaded WASM binary includes SIMD kernels. */
  wasmSimd?: boolean
  /** Whether the loaded WASM binary is using pthreads. */
  wasmThreads?: boolean
  /** Canvas color space used for compositing. */
  canvasColorSpace?: 'srgb' | 'display-p3' | 'rec2020'
  /** Video transfer function used for HDR overlay. */
  videoTransfer?: 'sdr' | 'pq' | 'hlg'
  /** Video primaries used to pick the canvas color space. */
  videoPrimaries?: 'bt709' | 'bt2020' | 'smpte432' | 'unknown'
  /** Demand renders still in flight. */
  pendingRenders: number
  /** Dialogue events currently in the track. */
  totalEvents: number
  /** Worker bitmap-cache hits. */
  cacheHits: number
  /** Worker bitmap-cache misses. */
  cacheMisses: number
}

/** Active compositor backend. */
export type RendererType = 'webgpu' | 'webgl2' | 'canvas2d'

/** One Dialogue event that is active at a sampled media time. */
export interface CueEvent {
  /** Event index in the loaded track. */
  index: number
  /** Start time in seconds. */
  start: number
  /** Duration in seconds. */
  duration: number
  /** Style name referenced by this event. */
  style: string
  /** Character name (for information only). Empty for encrypted tracks. */
  name: string
  /** Dialogue text, including override tags. Empty for encrypted tracks. */
  text: string
  /** Collision layer. */
  layer: number
}

/** Snapshot emitted after a demand-frame render cycle. */
export interface RenderEvent {
  /** Media time sampled for this frame, in seconds. */
  time: number
  /** Image planes emitted by the last changed render. */
  imageCount: number
  /** Worker render time in milliseconds. */
  renderTimeMs: number
  /** Active compositor backend. */
  rendererType: RendererType
  /** True when the worker reused the previous bitmap. */
  cached: boolean
}

/** Fired when the compositor backend changes after construction. */
export interface RendererChangeEvent {
  rendererType: RendererType
  previous: RendererType
}

/** Why the renderer is falling behind the display clock. */
export type PerformanceWarning =
  | { kind: 'slow-frame'; renderTimeMs: number }
  | { kind: 'dropped-frames'; droppedFrames: number }
  | { kind: 'queue-backlog'; pendingRenders: number }

/** Source for {@linkcode AkariSub.preloadTrack}. */
export type PreloadTrackSource =
  | { kind: 'url'; url: string }
  | { kind: 'content'; content: string | Uint8Array | ArrayBuffer }
  | { kind: 'encrypted'; content: EncryptedSubtitleContent }

/** Handle returned by {@linkcode AkariSub.preloadTrack}. */
export interface PreloadedTrack {
  id: number
}

/** Packet format for {@linkcode AkariSub.initStreamingTrack}. */
export type StreamingTrackFormat = 'ass' | 'matroska'

/** Options for {@linkcode AkariSub.initStreamingTrack}. */
export interface StreamingTrackOptions {
  /** ASS header or Matroska CodecPrivate. Omit to start from an empty track. */
  header?: string | Uint8Array | ArrayBuffer
  /**
   * How `header` and later packets are parsed.
   * `'ass'` uses `ass_process_data` (Dialogue lines). `'matroska'` uses
   * CodecPrivate plus `ass_process_chunk`.
   */
  format?: StreamingTrackFormat
  /**
   * Drop events that ended more than this many seconds before the last
   * rendered timestamp. `null` or a negative value disables automatic pruning.
   */
  pruneDelay?: number | null
  /** Deduplicate Matroska packets by ReadOrder. Default true. */
  checkReadOrder?: boolean
}

/** URL or in-memory font file. */
export type FontBytes = string | Uint8Array

/**
 * One downloadable glyph slice of a family. Use `unicodeRange` and/or
 * `scripts` so AkariSub can skip CJK (and other) slices the current track
 * does not need.
 */
export interface FontSubsetSource {
  src: FontBytes
  /** CSS `unicode-range` syntax, for example `U+0000-00FF, U+3040-309F`. */
  unicodeRange?: string
  /** OpenType tags or aliases: `latn`, `hani`, `cjk`, `jp`, `kr`. */
  scripts?: string[]
}

/** Value stored under one `availableFonts` family name. */
export type FontFamilySource = FontBytes | FontSubsetSource | FontSubsetSource[]

/** Encoded-frame timestamps with optional media/subtitle clock offsets. */
export interface FrameTimeline extends ArrayLike<number> {
  /** Origin subtracted from raw browser media timestamps when locating a frame. */
  mediaTimeOrigin?: number
  /** Signed offset subtracted from frame time when sampling libass. */
  subtitleTimeOffset?: number
}

/**
 * WebCodecs `VideoFrame` fields used as a subtitle clock.
 *
 * A real `VideoFrame` satisfies this type. Tests and custom decoders may pass a
 * duck-typed object. AkariSub never takes ownership or calls `close()`.
 */
export interface VideoFrameLike {
  /** Presentation timestamp in microseconds. */
  readonly timestamp: number
  /** Frame duration in microseconds, when the decoder provides one. */
  readonly duration?: number | null
  /** Display width in pixels. */
  readonly displayWidth: number
  /** Display height in pixels. */
  readonly displayHeight: number
  /** Coded width in pixels. */
  readonly codedWidth?: number
  /** Coded height in pixels. */
  readonly codedHeight?: number
  /** Optional WebCodecs color description. */
  readonly colorSpace?: {
    readonly matrix?: string | null
    readonly primaries?: string | null
    readonly transfer?: string | null
  } | null
}

/** Options for {@linkcode AkariSub.presentVideoFrame}. */
export interface PresentVideoFrameOptions {
  /** `performance.now()` for this presentation. Defaults to `performance.now()`. */
  now?: number
  /** Predicted compositor display time, in milliseconds. */
  expectedDisplayTime?: number
  /** Capture timestamp, in milliseconds. */
  presentationTime?: number
  /**
   * Decoder clock paused state. Defaults to the previous VideoFrame clock value,
   * or `false` on the first presented frame.
   */
  isPaused?: boolean
  /** Playback rate. Defaults to the previous VideoFrame clock value, or `1`. */
  rate?: number
  /** Media time in seconds. Defaults to `timestamp / 1e6`. */
  mediaTime?: number
}

/** Construction options for {@linkcode AkariSub}. */
export interface AkariSubOptions {
  /**
   * Video element to overlay. Either `video` or `canvas` is required.
   * WebCodecs players pass `canvas` and drive time with {@linkcode AkariSub.presentVideoFrame}.
   */
  video?: HTMLVideoElement
  /** Existing canvas to paint into instead of creating an overlay. */
  canvas?: HTMLCanvasElement
  /** Image blending mode: 'js' for hardware acceleration, 'wasm' for software */
  blendMode?: 'js' | 'wasm'
  /** Use async rendering with ImageBitmap (default: true) */
  asyncRender?: boolean
  /** Use offscreen canvas rendering (default: true for video-managed canvases, false for custom canvases) */
  offscreenRender?: boolean
  /** Use worker-side raw ASS_Image WebGL2 composition (default: false) */
  rawAssImageGpu?: boolean
  /**
   * Use requestVideoFrameCallback or {@linkcode AkariSub.presentVideoFrame} for
   * precise sync (default: true when RVFC exists, or when `onDemandRender` is
   * set true for a canvas-only WebCodecs clock)
   */
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
  /** Optional worker script URL. Defaults to the package worker module URL. */
  workerUrl?: string
  /** Optional WASM binary URL. Defaults to the package WASM URL resolved from import.meta.url. */
  wasmUrl?: string
  /** Optional WASM glue script URL. Defaults to the package glue URL resolved from import.meta.url. */
  glueUrl?: string
  /** Optional SIMD WASM URL. Used when the engine validates `v128` and this URL is set. */
  modernWasmUrl?: string
  /** Optional SIMD WASM glue URL. Derived from `modernWasmUrl` when omitted. */
  modernGlueUrl?: string
  /** Optional pthread SIMD WASM URL. Used on cross-origin isolated pages. */
  mtWasmUrl?: string
  /** Optional pthread SIMD WASM glue URL. Derived from `mtWasmUrl` when omitted. */
  mtGlueUrl?: string
  /** Overlay canvas color space. `auto` follows the video primaries. */
  canvasColorSpace?: 'srgb' | 'display-p3' | 'rec2020' | 'auto'
  /** Request an HDR canvas when the video transfer is PQ or HLG. Default `auto`. */
  hdr?: boolean | 'auto'
  /** HTTP(S) URL of an ASS/SSA file to load after init. */
  subUrl?: string
  /** Inline ASS/SSA text or bytes to load after init. */
  subContent?: string | Uint8Array | ArrayBuffer
  /** Encrypted subtitle content decrypted inside the worker before loading into libass */
  encryptedSubContent?: EncryptedSubtitleContent
  /** Extra fonts as URLs or file bytes. Always loaded in full. */
  fonts?: FontBytes[]
  /**
   * Map of font family name (lowercase) to a file or unicode-range slices.
   * Slice descriptors load lazily from the scripts in the current track.
   */
  availableFonts?: Record<string, FontFamilySource>
  /** Fallback font families in order (default: ['liberation sans']). Fontconfig uses these for cascade. */
  fallbackFonts?: string[]
  /**
   * When `availableFonts` entries declare `unicodeRange` or `scripts`, load
   * only the slices that overlap the current track. Default true.
   */
  lazyFonts?: boolean
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
  /** Fired when a Dialogue event becomes active at the sampled media time. */
  onCueEnter?: (cue: CueEvent) => void
  /** Fired when a Dialogue event is no longer active at the sampled media time. */
  onCueExit?: (cue: CueEvent) => void
  /** Fired after each demand-frame render cycle. */
  onRender?: (event: RenderEvent) => void
  /** Fired when the compositor backend changes after construction. */
  onRendererChange?: (event: RendererChangeEvent) => void
  /** Fired when a frame is slow, dropped, or the demand queue backs up. */
  onPerformanceWarning?: (warning: PerformanceWarning) => void
}

/** AES-GCM subtitle payload decrypted inside the worker. */
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

/** One blended subtitle bitmap or GPU plane to composite. */
export interface RenderImage {
  /** Destination X in canvas pixels. */
  x: number
  /** Destination Y in canvas pixels. */
  y: number
  /** Bitmap width in pixels. */
  w: number
  /** Bitmap height in pixels. */
  h: number
  /** Premultiplied RGBA bitmap, or a WASM pointer when using raw GPU composition. */
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

/** Timing breakdown for a single worker render, in milliseconds. */
export interface RenderTimes {
  /** libass raster time. */
  WASMRenderTime?: number
  /** Time spent copying WASM bitmaps into JS. */
  WASMBitmapDecodeTime?: number
  /** Main-thread composite time. */
  JSRenderTime?: number
  /** ImageBitmap construction time. */
  JSBitmapGenerationTime?: number
  /** Worker-to-main postMessage latency. */
  IPCTime?: number
  /** Number of bitmaps in this frame. */
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
  canvasColorSpace?: 'srgb' | 'display-p3' | 'rec2020'
  hdr?: boolean
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
  | {
      target: 'verifyColorSpace'
      subtitleColorSpace: string | null
      canvasColorSpace?: 'srgb' | 'display-p3' | 'rec2020'
      hdr?: boolean
    }
  | { target: 'getEvents'; events: ASSEvent[] }
  | { target: 'getStyles'; styles: ASSStyle[]; time: number }
  | { target: 'getStats'; stats: Partial<PerformanceStats> }
  | { target: 'resetStats'; success: boolean }
  | { target: 'getEventCount'; count: number }
  | { target: 'getStyleCount'; count: number }
  | { target: 'preloadTrack'; requestId: number; success: boolean; id?: number; error?: string }
  | { target: 'activatePreloadedTrack'; requestId: number; success: boolean; id?: number; error?: string }
  | { target: 'cues'; time: number; entered: CueEvent[]; exited: CueEvent[] }
  | {
      target: 'renderInfo'
      time: number
      cached: boolean
      renderTimeMs: number
      imageCount: number
      framesDropped: number
      pendingRenders: number
    }
  | RenderMessage

export interface WorkerInitMessage {
  target: 'init'
  wasmUrl: string
  glueUrl?: string
  fallbackWasmUrl?: string
  fallbackGlueUrl?: string
  canvasColorSpace?: 'srgb' | 'display-p3' | 'rec2020'
  hdr?: boolean
  wasmSimd?: boolean
  wasmThreads?: boolean
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
  fonts: FontBytes[]
  availableFonts: Record<string, FontFamilySource>
  fallbackFonts: string[]
  lazyFonts: boolean
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
  | {
      target: 'offscreenCanvas'
      rawAssImageGpu?: boolean
      canvasColorSpace?: 'srgb' | 'display-p3' | 'rec2020'
      hdr?: boolean
      transferable: [OffscreenCanvas]
    }
  | { target: 'detachOffscreen' }
  | { target: 'canvas'; width: number; height: number; videoWidth: number; videoHeight: number; force?: boolean }
  | {
      target: 'video'
      currentTime?: number
      isPaused?: boolean
      rate?: number
      renderAhead?: number
      colorSpace?: string | null
      canvasColorSpace?: 'srgb' | 'display-p3' | 'rec2020'
      hdr?: boolean
    }
  | { target: 'setTrack'; content: string | Uint8Array | ArrayBuffer }
  | { target: 'setEncryptedTrack'; content: EncryptedSubtitleContent }
  | { target: 'setTrackByUrl'; url: string }
  | { target: 'freeTrack' }
  | { target: 'initStreamingTrack'; options: StreamingTrackOptions }
  | { target: 'appendSubtitleData'; content: string | Uint8Array | ArrayBuffer }
  | {
      target: 'appendSubtitleChunk'
      content: string | Uint8Array | ArrayBuffer
      start: number
      duration: number
    }
  | { target: 'appendEvents'; events: Partial<ASSEvent>[] }
  | { target: 'flushEvents' }
  | { target: 'pruneEvents'; before: number }
  | { target: 'configurePrune'; delay: number }
  | { target: 'preloadTrack'; requestId: number; source: PreloadTrackSource }
  | { target: 'activatePreloadedTrack'; requestId: number; id?: number }
  | {
      target: 'demand'
      time: number
      force?: boolean
      requestId?: number
      renderEpoch?: number
      presentationId?: number
    }
  | { target: 'prepare'; time: number; prepareId: number; renderEpoch: number; force?: boolean }
  | { target: 'presentation'; presentationId: number; time?: number }
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

/** Metadata passed to `HTMLVideoElement.requestVideoFrameCallback`. */
export interface VideoFrameCallbackMetadata {
  /** Media time of the presented frame, in seconds. */
  mediaTime: number
  /** Presented frame width in CSS pixels. */
  width: number
  /** Presented frame height in CSS pixels. */
  height: number
  /** Count of frames presented since the callback was scheduled. */
  presentedFrames?: number
  /** Time spent processing the frame, in milliseconds. */
  processingDuration?: number
  /** Predicted compositor display time, in milliseconds. */
  expectedDisplayTime?: number
  /** Capture timestamp, in milliseconds. */
  presentationTime?: number
}

/** Video YCbCr matrix used for subtitle color-space conversion. */
export type WebYCbCrColorSpace = 'BT709' | 'BT601' | 'BT2020'
/** libass YCbCr matrix, or `null` when the track does not declare one. */
export type SubtitleColorSpace = 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC' | 'BT2020' | null

export interface AkariSubModule extends EmscriptenModule {
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  _akarisub_create: (width: number, height: number, fallbackFontPtr: number, debug: number) => number
  _akarisub_destroy: (handle: number) => void
  _akarisub_set_drop_animations: (handle: number, value: number) => void
  _akarisub_set_adaptive_blend_layouts: (handle: number, value: number) => void
  _akarisub_create_track_mem: (handle: number, contentPtr: number) => void
  _akarisub_remove_track: (handle: number) => void
  _akarisub_new_track: (handle: number) => void
  _akarisub_process_data: (handle: number, dataPtr: number, size: number) => void
  _akarisub_process_codec_private: (handle: number, dataPtr: number, size: number) => void
  _akarisub_process_chunk: (
    handle: number,
    dataPtr: number,
    size: number,
    timecodeMs: number,
    durationMs: number
  ) => void
  _akarisub_flush_events: (handle: number) => void
  _akarisub_prune_events: (handle: number, deadlineMs: number) => void
  _akarisub_configure_prune: (handle: number, delayMs: number) => void
  _akarisub_set_check_readorder: (handle: number, check: number) => void
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
  _akarisub_set_blend_threads?: (handle: number, threads: number) => void
  _akarisub_get_blend_threads?: (handle: number) => number
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
