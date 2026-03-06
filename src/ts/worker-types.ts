import type {
  CompositedFrameResult,
  FontConfig,
  FrameMargins,
  FrameSize,
  ImageSliceFrameResult,
  RenderImageSlice,
} from './renderer'

export interface ASSEvent {
  Start: number
  Duration: number
  Style: string
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
  Name: string
  FontName: string
  FontSize: number
  PrimaryColour: number
  SecondaryColour: number
  OutlineColour: number
  BackColour: number
  Bold: number
  Italic: number
  Underline: number
  StrikeOut: number
  ScaleX: number
  ScaleY: number
  Spacing: number
  Angle: number
  BorderStyle: number
  Outline: number
  Shadow: number
  Alignment: number
  MarginL: number
  MarginR: number
  MarginV: number
  Encoding: number
  treat_fontname_as_pattern: number
  Blur: number
  Justify: number
}

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
  wasmUrl?: string
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

export interface WorkerAttachOffscreenCanvasMessage {
  type: 'attach-offscreen-canvas'
  canvas: OffscreenCanvas
  width: number
  height: number
}

export interface WorkerLoadTrackMessage {
  type: 'load-track'
  subtitleData: string
}

export interface WorkerSetDefaultFontMessage {
  type: 'set-default-font'
  font: string | null
}

export interface WorkerCreateEventMessage {
  type: 'create-event'
  event: Partial<ASSEvent>
}

export interface WorkerSetEventMessage {
  type: 'set-event'
  index: number
  event: Partial<ASSEvent>
}

export interface WorkerRemoveEventMessage {
  type: 'remove-event'
  index: number
}

export interface WorkerGetEventsMessage {
  type: 'get-events'
}

export interface WorkerCreateStyleMessage {
  type: 'create-style'
  style: Partial<ASSStyle>
}

export interface WorkerSetStyleMessage {
  type: 'set-style'
  index: number
  style: Partial<ASSStyle>
}

export interface WorkerRemoveStyleMessage {
  type: 'remove-style'
  index: number
}

export interface WorkerGetStylesMessage {
  type: 'get-styles'
}

export interface WorkerStyleOverrideMessage {
  type: 'style-override'
  index: number
}

export interface WorkerDisableStyleOverrideMessage {
  type: 'disable-style-override'
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

export interface WorkerRenderOffscreenFrameMessage {
  type: 'render-offscreen-frame'
  timestampMs: number
  force?: boolean
}

export type AkariSubWorkerInboundMessage =
  | WorkerAddFontMessage
  | WorkerAttachOffscreenCanvasMessage
  | WorkerClearFontsMessage
  | WorkerClearTrackMessage
  | WorkerConfigureCanvasMessage
  | WorkerCreateEventMessage
  | WorkerCreateStyleMessage
  | WorkerDisableStyleOverrideMessage
  | WorkerDisposeMessage
  | WorkerGetEventsMessage
  | WorkerGetStylesMessage
  | WorkerInitMessage
  | WorkerLoadTrackMessage
  | WorkerRemoveEventMessage
  | WorkerRemoveStyleMessage
  | WorkerRenderCompositedFrameMessage
  | WorkerRenderOffscreenFrameMessage
  | WorkerRenderImageSlicesMessage
  | WorkerSetDefaultFontMessage
  | WorkerSetEventMessage
  | WorkerSetCacheLimitsMessage
  | WorkerSetStyleMessage
  | WorkerStyleOverrideMessage
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
    | 'attach-offscreen-canvas'
    | 'clear-fonts'
    | 'clear-track'
    | 'configure-canvas'
    | 'create-event'
    | 'create-style'
    | 'disable-style-override'
    | 'dispose'
    | 'load-track'
    | 'remove-event'
    | 'remove-style'
    | 'set-default-font'
    | 'set-event'
    | 'set-cache-limits'
    | 'set-style'
    | 'set-fonts'
    | 'style-override'
  hasTrack: boolean
  eventCount: number
  styleCount: number
  trackColorSpace: number | null
}

export interface WorkerEventsMessage {
  type: 'events'
  events: ASSEvent[]
}

export interface WorkerStylesMessage {
  type: 'styles'
  styles: ASSStyle[]
}

export interface WorkerCreatedEventMessage {
  type: 'created-event'
  index: number
}

export interface WorkerCreatedStyleMessage {
  type: 'created-style'
  index: number
}

export interface WorkerRenderedCompositedFrameMessage {
  type: 'rendered-composited-frame'
  frame: CompositedFrameResult | null
}

export interface WorkerRenderedImageSlicesMessage {
  type: 'rendered-image-slices'
  frame: ImageSliceFrameResult | null
}

export interface WorkerRenderedOffscreenFrameMessage {
  type: 'rendered-offscreen-frame'
  changed: number
  timestampMs: number
}

export interface WorkerErrorMessage {
  type: 'error'
  error: string
  requestType?: AkariSubWorkerInboundMessage['type']
}

export type AkariSubWorkerOutboundMessage =
  | WorkerAckMessage
  | WorkerCreatedEventMessage
  | WorkerCreatedStyleMessage
  | WorkerErrorMessage
  | WorkerEventsMessage
  | WorkerReadyMessage
  | WorkerRenderedCompositedFrameMessage
  | WorkerRenderedImageSlicesMessage
  | WorkerRenderedOffscreenFrameMessage
  | WorkerStylesMessage

export interface TransferableCompositedFrameResult extends Omit<CompositedFrameResult, 'pixels'> {
  pixels: Uint8Array
}

export interface TransferableRenderImageSlice extends Omit<RenderImageSlice, 'pixels'> {
  pixels: Uint8Array
}