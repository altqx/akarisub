import type {
  CompositedFrameResult,
  FontConfig,
  FrameMargins,
  FrameSize,
  ImageSliceFrameResult,
  RenderImageSlice,
} from './renderer'

export interface WorkerCacheLimits {
  glyphLimit: number
  bitmapCacheLimit: number
}

export interface WorkerInitMessage {
  type: 'init'
  frame: FrameSize
  storage?: FrameSize
  margins?: FrameMargins
  fonts?: FontConfig
  cacheLimits?: WorkerCacheLimits
}

export interface WorkerConfigureCanvasMessage {
  type: 'configure-canvas'
  frame: FrameSize
  storage?: FrameSize
  margins?: FrameMargins
}

export interface WorkerSetFontsMessage {
  type: 'set-fonts'
  fonts: FontConfig
}

export interface WorkerSetCacheLimitsMessage {
  type: 'set-cache-limits'
  cacheLimits: WorkerCacheLimits
}

export interface WorkerAddFontMessage {
  type: 'add-font'
  name: string
  data: Uint8Array
}

export interface WorkerLoadTrackMessage {
  type: 'load-track'
  subtitleData: string
}

export interface WorkerClearTrackMessage {
  type: 'clear-track'
}

export interface WorkerClearFontsMessage {
  type: 'clear-fonts'
}

export interface WorkerRenderCompositedFrameMessage {
  type: 'render-composited-frame'
  timestampMs: number
  force?: boolean
}

export interface WorkerRenderImageSlicesMessage {
  type: 'render-image-slices'
  timestampMs: number
  force?: boolean
}

export interface WorkerDisposeMessage {
  type: 'dispose'
}

export type AkariSubWorkerInboundMessage =
  | WorkerAddFontMessage
  | WorkerClearFontsMessage
  | WorkerClearTrackMessage
  | WorkerConfigureCanvasMessage
  | WorkerDisposeMessage
  | WorkerInitMessage
  | WorkerLoadTrackMessage
  | WorkerRenderCompositedFrameMessage
  | WorkerRenderImageSlicesMessage
  | WorkerSetCacheLimitsMessage
  | WorkerSetFontsMessage

export interface WorkerReadyMessage {
  type: 'ready'
  runtimeVersion: string
  libassVersion: number
}

export interface WorkerAckMessage {
  type: 'ack'
  action:
    | 'add-font'
    | 'clear-fonts'
    | 'clear-track'
    | 'configure-canvas'
    | 'dispose'
    | 'load-track'
    | 'set-cache-limits'
    | 'set-fonts'
  hasTrack: boolean
  eventCount: number
  styleCount: number
  trackColorSpace: number | null
}

export interface WorkerRenderedCompositedFrameMessage {
  type: 'rendered-composited-frame'
  frame: CompositedFrameResult | null
}

export interface WorkerRenderedImageSlicesMessage {
  type: 'rendered-image-slices'
  frame: ImageSliceFrameResult | null
}

export interface WorkerErrorMessage {
  type: 'error'
  error: string
  requestType?: AkariSubWorkerInboundMessage['type']
}

export type AkariSubWorkerOutboundMessage =
  | WorkerAckMessage
  | WorkerErrorMessage
  | WorkerReadyMessage
  | WorkerRenderedCompositedFrameMessage
  | WorkerRenderedImageSlicesMessage

export interface TransferableCompositedFrameResult extends Omit<CompositedFrameResult, 'pixels'> {
  pixels: Uint8Array
}

export interface TransferableRenderImageSlice extends Omit<RenderImageSlice, 'pixels'> {
  pixels: Uint8Array
}