/**
 * TypeScript wrapper for AkariSub.
 * Re-exports all types and the main AkariSub class.
 */

// Re-export all types
export type {
  ASSEvent,
  ASSStyle,
  AkariSubOptions,
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
  AkariSubModule,
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
export { default as AkariSub } from './ts/akarisub'
