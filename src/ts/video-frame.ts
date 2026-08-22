import type {
  FrameTimeline,
  PresentVideoFrameOptions,
  VideoFrameCallbackMetadata,
  VideoFrameLike,
  WebYCbCrColorSpace
} from './types'
import { normalizeFrameTimeline } from './timing'
import { webYCbCrMap } from './utils'

/** WebCodecs `VideoFrame.timestamp` is in microseconds. */
export const VIDEO_FRAME_TIMESTAMP_SECONDS = 1e-6

/** True when the WebCodecs `VideoFrame` constructor exists. */
export function isWebCodecsVideoFrameSupported(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as { VideoFrame?: unknown }).VideoFrame === 'function'
}

/** True when `value` has the WebCodecs fields used as a subtitle clock. */
export const isVideoFrameLike = (value: unknown): value is VideoFrameLike => {
  if (value == null || typeof value !== 'object') return false

  const frame = value as VideoFrameLike
  return Number.isFinite(frame.timestamp) && Number.isFinite(frame.displayWidth) && Number.isFinite(frame.displayHeight)
}

/** Convert a WebCodecs timestamp in microseconds to media seconds. */
export const videoFrameMediaTime = (timestampUs: number): number => {
  if (!Number.isFinite(timestampUs)) return Number.NaN
  return timestampUs * VIDEO_FRAME_TIMESTAMP_SECONDS
}

/** Map a VideoFrame color matrix onto the subtitle conversion tables, or `null`. */
export const videoFrameColorSpace = (frame: Pick<VideoFrameLike, 'colorSpace'>): WebYCbCrColorSpace | null => {
  const matrix = frame.colorSpace?.matrix
  if (typeof matrix !== 'string') return null
  return webYCbCrMap[matrix] ?? null
}

/**
 * Build RVFC-shaped metadata from a decoded `VideoFrame`.
 *
 * `timestamp` is converted from microseconds to seconds unless `mediaTime` is set.
 */
export const videoFrameCallbackMetadata = (
  frame: VideoFrameLike,
  options: Pick<PresentVideoFrameOptions, 'now' | 'expectedDisplayTime' | 'presentationTime' | 'mediaTime'> = {}
): VideoFrameCallbackMetadata => {
  const now = Number.isFinite(options.now) ? options.now! : typeof performance !== 'undefined' ? performance.now() : 0
  const mediaTime = Number.isFinite(options.mediaTime) ? options.mediaTime! : videoFrameMediaTime(frame.timestamp)
  const expectedDisplayTime = Number.isFinite(options.expectedDisplayTime) ? options.expectedDisplayTime : undefined
  const presentationTime = Number.isFinite(options.presentationTime) ? options.presentationTime : undefined

  return {
    mediaTime,
    width: frame.displayWidth,
    height: frame.displayHeight,
    expectedDisplayTime,
    presentationTime: presentationTime ?? now
  }
}

/**
 * Build a {@linkcode FrameTimeline} from timestamps.
 *
 * WebCodecs packet and `VideoFrame` timestamps default to microseconds.
 * Pass `unit: 'seconds'` when the values are already on the browser media clock.
 */
export const frameTimelineFromTimestamps = (
  timestamps: ArrayLike<number>,
  options: {
    unit?: 'microseconds' | 'seconds'
    mediaTimeOrigin?: number
    subtitleTimeOffset?: number
  } = {}
): FrameTimeline => {
  const scale = options.unit === 'seconds' ? 1 : VIDEO_FRAME_TIMESTAMP_SECONDS
  const times = new Float64Array(timestamps.length)
  for (let i = 0; i < timestamps.length; i++) {
    times[i] = Number(timestamps[i]) * scale
  }

  const timeline = normalizeFrameTimeline(times)
  if (Number.isFinite(options.mediaTimeOrigin)) timeline.mediaTimeOrigin = options.mediaTimeOrigin
  if (Number.isFinite(options.subtitleTimeOffset)) timeline.subtitleTimeOffset = options.subtitleTimeOffset
  return timeline
}

/** Build a {@linkcode FrameTimeline} from decoded `VideoFrame.timestamp` values. */
export const frameTimelineFromVideoFrames = (
  frames: Iterable<Pick<VideoFrameLike, 'timestamp'>>,
  options: { mediaTimeOrigin?: number; subtitleTimeOffset?: number } = {}
): FrameTimeline => {
  const timestamps: number[] = []
  for (const frame of frames) {
    if (frame && Number.isFinite(frame.timestamp)) timestamps.push(frame.timestamp)
  }
  return frameTimelineFromTimestamps(timestamps, { unit: 'microseconds', ...options })
}
