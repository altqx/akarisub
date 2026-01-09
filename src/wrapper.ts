/**
 * TypeScript wrapper for JASSUB.
 * Re-exports all types and the main JASSUB class.
 */

// Re-export all types
export type {
  ASSEvent,
  ASSStyle,
  JASSUBOptions,
  PerformanceStats,
  ASSEventCallback,
  ASSStyleCallback,
  PerformanceStatsCallback,
  ResetStatsCallback,
  RenderImage,
  RenderTimes,
  VideoFrameCallbackMetadata,
  SubtitleColorSpace,
  WebYCbCrColorSpace,
  JASSUBModule,
  JASSUBWasmObject,
  WorkerInboundMessage,
  WorkerOutboundMessage
} from './ts/types'

// Re-export utilities
export {
  webYCbCrMap,
  colorMatrixConversionMap,
  libassYCbCrMap,
  computeCanvasSize,
  getVideoPosition,
  fixAlpha,
  parseAss,
  dropBlur,
  fixPlayRes,
  testImageBugs,
  runFeatureTests,
  getAlphaBug,
  getBitmapBug,
  getColorSpaceFilterUrl
} from './ts/utils'

// Re-export main class
export { default as JASSUB } from './ts/jassub'
