/**
 * Type definitions for JASSUB TypeScript implementation.
 */

// =============================================================================
// ASS/SSA Subtitle Types
// =============================================================================

/** ASS Event (dialogue/subtitle entry) */
export interface ASSEvent {
  /** Start Time of the Event (in seconds) */
  Start: number
  /** Duration of the Event (in seconds) */
  Duration: number
  /** Style name */
  Style: string
  /** Character name (for information only) */
  Name: string
  /** Left Margin override in pixels */
  MarginL: number
  /** Right Margin override in pixels */
  MarginR: number
  /** Bottom Margin override in pixels */
  MarginV: number
  /** Transition Effect */
  Effect: string
  /** Subtitle Text */
  Text: string
  /** Read order number */
  ReadOrder: number
  /** Z-index layer */
  Layer: number
  /** Internal index */
  _index?: number
}

/** ASS Style definition */
export interface ASSStyle {
  /** Style name (case sensitive) */
  Name: string
  /** Font family name */
  FontName: string
  /** Font size */
  FontSize: number
  /** Primary color (RGBA as uint32) */
  PrimaryColour: number
  /** Secondary color (RGBA as uint32) */
  SecondaryColour: number
  /** Outline color (RGBA as uint32) */
  OutlineColour: number
  /** Background/shadow color (RGBA as uint32) */
  BackColour: number
  /** Bold (-1 = true, 0 = false) */
  Bold: number
  /** Italic (-1 = true, 0 = false) */
  Italic: number
  /** Underline (-1 = true, 0 = false) */
  Underline: number
  /** StrikeOut (-1 = true, 0 = false) */
  StrikeOut: number
  /** Width scale (percent) */
  ScaleX: number
  /** Height scale (percent) */
  ScaleY: number
  /** Extra spacing between characters (pixels) */
  Spacing: number
  /** Rotation angle (degrees) */
  Angle: number
  /** Border style (1 = outline + shadow, 3 = opaque box) */
  BorderStyle: number
  /** Outline width (0-4 pixels) */
  Outline: number
  /** Shadow depth (0-4 pixels) */
  Shadow: number
  /** Alignment (1-9, numpad style) */
  Alignment: number
  /** Left margin (pixels) */
  MarginL: number
  /** Right margin (pixels) */
  MarginR: number
  /** Vertical margin (pixels) */
  MarginV: number
  /** Font encoding */
  Encoding: number
  /** Treat font name as pattern */
  treat_fontname_as_pattern: number
  /** Blur amount */
  Blur: number
  /** Text justification */
  Justify: number
}

// =============================================================================
// Performance Stats Types
// =============================================================================

/** Performance statistics for the renderer */
export interface PerformanceStats {
  /** Total frames rendered since reset */
  framesRendered: number
  /** Number of frames dropped */
  framesDropped: number
  /** Average render time in milliseconds */
  avgRenderTime: number
  /** Maximum render time in milliseconds */
  maxRenderTime: number
  /** Minimum render time in milliseconds */
  minRenderTime: number
  /** Last render time in milliseconds */
  lastRenderTime: number
  /** Estimated render FPS based on timing */
  renderFps: number
  /** Whether using Web Worker */
  usingWorker: boolean
  /** Whether offscreen rendering is enabled */
  offscreenRender: boolean
  /** Whether on-demand rendering is enabled */
  onDemandRender: boolean
  /** Number of pending render operations */
  pendingRenders: number
  /** Total subtitle events in current track */
  totalEvents: number
  /** Number of cache hits (unchanged frames) */
  cacheHits: number
  /** Number of cache misses (rendered frames) */
  cacheMisses: number
}

// =============================================================================
// JASSUB Options Types
// =============================================================================

/** Configuration options for JASSUB */
export interface JASSUBOptions {
  /** Video element to sync with and overlay */
  video?: HTMLVideoElement
  /** Custom canvas element (optional if video is provided) */
  canvas?: HTMLCanvasElement
  /** Image blending mode: 'js' for hardware acceleration, 'wasm' for software */
  blendMode?: 'js' | 'wasm'
  /** Use async rendering with ImageBitmap (default: true) */
  asyncRender?: boolean
  /** Use offscreen canvas rendering (default: true) */
  offscreenRender?: boolean
  /** Use requestVideoFrameCallback for precise sync (default: true) */
  onDemandRender?: boolean
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
  /** URL to the worker script */
  workerUrl?: string
  /** URL to the WASM binary */
  wasmUrl?: string
  /** URL to subtitle file */
  subUrl?: string
  /** Subtitle content as string */
  subContent?: string
  /** Array of font URLs or Uint8Arrays */
  fonts?: (string | Uint8Array)[]
  /** Available fonts map (lowercase name -> URL/data) */
  availableFonts?: Record<string, string | Uint8Array>
  /** Fallback font family (default: 'liberation sans') - primary fallback */
  fallbackFont?: string
  /** Additional fallback fonts (after primary). Fontconfig uses these in order. */
  fallbackFonts?: string[]
  /** Use Local Font Access API (default: true if available) */
  useLocalFonts?: boolean
  /** libass bitmap cache memory limit in MiB */
  libassMemoryLimit?: number
  /** libass glyph cache limit */
  libassGlyphLimit?: number
  /** Prefer WebGPU renderer if available (default: true) */
  preferWebGPU?: boolean
  /** Callback when WebGPU is unavailable and falling back to Canvas2D */
  onWebGPUFallback?: () => void
  /** Additional time in seconds to render subtitles ahead for pipeline latency compensation (default: 0.008) */
  renderAhead?: number
}

// =============================================================================
// Callback Types (deprecated - use Promise-based API instead)
// =============================================================================

/** @deprecated Use Promise-based getEvents() instead */
export type ASSEventCallback = (error: Error | null, events: ASSEvent[]) => void
/** @deprecated Use Promise-based getStyles() instead */
export type ASSStyleCallback = (error: Error | null, styles: ASSStyle[]) => void
/** @deprecated Use Promise-based getStats() instead */
export type PerformanceStatsCallback = (error: Error | null, stats: PerformanceStats | null) => void
/** @deprecated Use Promise-based resetStats() instead */
export type ResetStatsCallback = (error: Error | null) => void

// =============================================================================
// Worker Message Types
// =============================================================================

/** Image data for rendering */
export interface RenderImage {
  x: number
  y: number
  w: number
  h: number
  image: ImageBitmap | ArrayBuffer | number
}

/** Render timing debug info */
export interface RenderTimes {
  WASMRenderTime?: number
  WASMBitmapDecodeTime?: number
  JSRenderTime?: number
  JSBitmapGenerationTime?: number
  IPCTime?: number
  bitmaps?: number
}

/** Worker -> Main thread message for rendering */
export interface RenderMessage {
  target: 'render'
  asyncRender: boolean
  images: RenderImage[]
  times: RenderTimes
  width: number
  height: number
  colorSpace: string | null
}

/** Worker -> Main thread messages */
export type WorkerOutboundMessage =
  | { target: 'ready' }
  | { target: 'unbusy' }
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

/** Main thread -> Worker init message */
export interface WorkerInitMessage {
  target: 'init'
  wasmUrl: string
  asyncRender: boolean
  onDemandRender: boolean
  width: number
  height: number
  blendMode: 'js' | 'wasm'
  subUrl?: string
  subContent?: string | null
  fonts: (string | Uint8Array)[]
  availableFonts: Record<string, string | Uint8Array>
  fallbackFont: string
  fallbackFonts: string[]
  debug: boolean
  targetFps: number
  dropAllAnimations?: boolean
  dropAllBlur?: boolean
  clampPos?: boolean
  libassMemoryLimit?: number
  libassGlyphLimit?: number
  useLocalFonts: boolean
  hasBitmapBug: boolean
}

/** Main thread -> Worker messages */
export type WorkerInboundMessage =
  | WorkerInitMessage
  | { target: 'offscreenCanvas'; transferable: [OffscreenCanvas] }
  | { target: 'detachOffscreen' }
  | { target: 'canvas'; width: number; height: number; videoWidth: number; videoHeight: number; force?: boolean }
  | { target: 'video'; currentTime?: number; isPaused?: boolean; rate?: number; colorSpace?: string | null }
  | { target: 'setTrack'; content: string }
  | { target: 'setTrackByUrl'; url: string }
  | { target: 'freeTrack' }
  | { target: 'demand'; time: number }
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
  | { target: 'runBenchmark' }
  | { target: 'getColorSpace' }

// =============================================================================
// RVFC Types
// =============================================================================

/** requestVideoFrameCallback metadata */
export interface VideoFrameCallbackMetadata {
  /** The current media time of the frame being displayed (seconds) */
  mediaTime: number
  /** Video intrinsic width */
  width: number
  /** Video intrinsic height */
  height: number
  /** Number of frames presented so far */
  presentedFrames?: number
  /** Time spent processing the frame (milliseconds) */
  processingDuration?: number
  /** Expected time when this frame will be displayed (DOMHighResTimeStamp) */
  expectedDisplayTime?: number
  /** Time at which the frame was presented (DOMHighResTimeStamp) */
  presentationTime?: number
}

// =============================================================================
// Color Space Types
// =============================================================================

export type WebYCbCrColorSpace = 'BT709' | 'BT601'
export type SubtitleColorSpace = 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC' | null

// =============================================================================
// JASSUB WASM Module Types
// =============================================================================

/** JASSUB object exposed by Emscripten */
export interface JASSUBWasmObject {
  resizeCanvas(width: number, height: number, videoWidth: number, videoHeight: number): void
  createTrackMem(content: string): void
  removeTrack(): void
  reloadFonts(): void
  addFont(name: string, ptr: number, length: number): void
  setDefaultFont(font: string): void
  setFallbackFonts(fonts: string): void
  addFallbackFont(font: string): void
  getFallbackFonts(): string
  setDropAnimations(drop: number): void
  setMemoryLimits(glyphLimit: number, memoryLimit: number): void
  styleOverride(style: JASSUBWasmStyle): void
  disableStyleOverride(): void
  renderBlend(time: number, force: number): JASSUBWasmRenderResult | null
  renderImage(time: number, force: number): JASSUBWasmRenderResult | null
  changed: number
  count: number
  time: number
  trackColorSpace: number
  allocEvent(): number
  getEvent(index: number): JASSUBWasmEvent
  getEventCount(): number
  removeEvent(index: number): void
  allocStyle(): number
  getStyle(index: number): JASSUBWasmStyle
  getStyleCount(): number
  removeStyle(index: number): void
  quitLibrary(): void
}

/** WASM render result linked list */
export interface JASSUBWasmRenderResult {
  w: number
  h: number
  x: number
  y: number
  image: number // pointer
  next: JASSUBWasmRenderResult | null
}

/** WASM event object */
export interface JASSUBWasmEvent {
  Start: number
  Duration: number
  ReadOrder: number
  Layer: number
  Style: string
  MarginL: number
  MarginR: number
  MarginV: number
  Name: string
  Text: string
  Effect: string
}

/** WASM style object */
export interface JASSUBWasmStyle extends ASSStyle {}

/** Emscripten JASSUB Module */
export interface JASSUBModule extends EmscriptenModule {
  JASSUB: new (width: number, height: number, fallbackFont: string | null, debug: boolean) => JASSUBWasmObject
  _malloc: (size: number) => number
  _free: (ptr: number) => void
}
