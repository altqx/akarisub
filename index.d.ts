interface ASS_Event {
  Start: number;
  Duration: number;
  Style: string;
  Name: string;
  MarginL: number;
  MarginR: number;
  MarginV: number;
  Effect: string;
  Text: string;
  ReadOrder: number;
  Layer: number;
  _index: number;
}

interface ASS_Style {
  Name: string;
  FontName: string;
  FontSize: number;
  PrimaryColour: number; // uint32_t RGBA
  SecondaryColour: number; // uint32_t RGBA
  OutlineColour: number; // uint32_t RGBA
  BackColour: number; // uint32_t RGBA
  Bold: number;
  Italic: number;
  Underline: number;
  StrikeOut: number;
  ScaleX: number;
  ScaleY: number;
  Spacing: number;
  Angle: number;
  BorderStyle: number;
  Outline: number;
  Shadow: number;
  Alignment: number;
  MarginL: number;
  MarginR: number;
  MarginV: number;
  Encoding: number;
  treat_fontname_as_pattern: number;
  Blur: number;
  Justify: number;
}

interface PerformanceStats {
  /** Total frames rendered since reset */
  framesRendered: number;
  /** Number of frames dropped */
  framesDropped: number;
  /** Average render time in milliseconds */
  avgRenderTime: number;
  /** Maximum render time in milliseconds */
  maxRenderTime: number;
  /** Minimum render time in milliseconds */
  minRenderTime: number;
  /** Last render time in milliseconds */
  lastRenderTime: number;
  /** Estimated render FPS based on timing */
  renderFps: number;
  /** Whether using Web Worker */
  usingWorker: boolean;
  /** Whether offscreen rendering is enabled */
  offscreenRender: boolean;
  /** Whether on-demand rendering is enabled */
  onDemandRender: boolean;
  /** Number of pending render operations */
  pendingRenders: number;
  /** Total subtitle events in current track */
  totalEvents: number;
  /** Number of cache hits (unchanged frames) */
  cacheHits: number;
  /** Number of cache misses (rendered frames) */
  cacheMisses: number;
}

interface JassubOptions {
  video?: HTMLVideoElement;
  canvas?: HTMLCanvasElement;

  blendMode?: 'js' | 'wasm';

  asyncRender?: boolean;
  offscreenRender?: boolean;
  onDemandRender?: boolean;
  targetFps?: number;
  timeOffset?: number;

  debug?: boolean;
  prescaleFactor?: number;
  prescaleHeightLimit?: number;
  maxRenderHeight?: number;
  dropAllAnimations?: boolean;
  dropAllBlur?: boolean;
  clampPos?: boolean;

  workerUrl?: string;
  wasmUrl?: string;
  legacyWasmUrl?: string;
  modernWasmUrl?: string;
  forceModernWasmUrl?: boolean;

  subUrl?: string;
  subContent?: string;

  fonts?: string[] | Uint8Array[];
  availableFonts?: Record<string, string>;
  fallbackFont?: string;
  useLocalFonts?: boolean;

  libassMemoryLimit?: number;
  libassGlyphLimit?: number;
}

type ASS_EventCallback = (error: Error | null, event: ASS_Event[]) => void;
type ASS_StyleCallback = (error: Error | null, event: ASS_Style[]) => void;
type PerformanceStatsCallback = (
  error: Error | null,
  stats: PerformanceStats
) => void;
type ResetStatsCallback = (error: Error | null) => void;

export default class JASSUB extends EventTarget {
  constructor(options: JassubOptions);

  resize(width?: number, height?: number, top?: number, left?: number): void;
  setVideo(video: HTMLVideoElement): void;
  runBenchmark(): void;

  setTrackByUrl(url: string): void;
  setTrack(content: string): void;
  freeTrack(): void;

  setIsPaused(isPaused: boolean): void;
  setRate(rate: number): void;
  setCurrentTime(isPaused?: boolean, currentTime?: number, rate?: number): void;

  createEvent(event: ASS_Event): void;
  setEvent(event: ASS_Event, index: number): void;
  removeEvent(index: number): void;
  getEvents(callback: ASS_EventCallback): void;

  createStyle(style: ASS_Style): void;
  setStyle(style: ASS_Style, index: number): void;
  removeStyle(index: number): void;
  getStyles(callback: ASS_StyleCallback): void;
  styleOverride(style: ASS_Style): void;
  disableStyleOverride(): void;
  setDefaultFont(font: string): void;

  addFont(font: string | Uint8Array): void;

  /** Get real-time performance statistics */
  getStats(callback: PerformanceStatsCallback): void;
  /** Reset performance statistics counters */
  resetStats(callback?: ResetStatsCallback): void;

  sendMessage(
    target: string,
    data?: Record<string, unknown>,
    transferable?: Transferable[]
  ): void;
  destroy(err?: string): void;

  static _hasAlphaBug: boolean;
  static _hasBitmapBug: boolean;
  _ctx: CanvasRenderingContext2D;
  _canvas: HTMLCanvasElement;
}
