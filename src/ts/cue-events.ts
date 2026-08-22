import type { CueEvent, EncryptedSubtitleContent, PerformanceWarning, PreloadTrackSource } from './types'

/** One 60 Hz refresh. Frames slower than this are reported as `slow-frame`. */
export const SLOW_FRAME_MS = 16

export const isCueActiveAt = (startMs: number, durationMs: number, nowMs: number): boolean => {
  return startMs <= nowMs && nowMs < startMs + durationMs
}

/**
 * Snap a media time to the integer millisecond libass uses for
 * `Start <= now < Start + Duration`.
 */
export const toLibassTimestampMs = (seconds: number): number => {
  if (!Number.isFinite(seconds)) return 0

  const rawMilliseconds = seconds * 1000
  const nearestMillisecond = Math.round(rawMilliseconds)
  const magnitude = Math.abs(rawMilliseconds) > 1 ? Math.abs(rawMilliseconds) : 1
  const roundOffTolerance = magnitude * Number.EPSILON * 4
  if (Math.abs(rawMilliseconds - nearestMillisecond) <= roundOffTolerance) {
    return nearestMillisecond
  }
  return Math.floor(rawMilliseconds)
}

export const diffActiveCues = (
  previous: ReadonlyMap<number, CueEvent>,
  next: ReadonlyMap<number, CueEvent>
): { entered: CueEvent[]; exited: CueEvent[] } => {
  const entered: CueEvent[] = []
  const exited: CueEvent[] = []

  for (const [index, cue] of next) {
    if (!previous.has(index)) entered.push(cue)
  }
  for (const [index, cue] of previous) {
    if (!next.has(index)) exited.push(cue)
  }

  return { entered, exited }
}

export const classifyPerformanceWarnings = (sample: {
  renderTimeMs?: number
  droppedDelta?: number
  pendingRenders?: number
  maxPendingRenders?: number
}): PerformanceWarning[] => {
  const warnings: PerformanceWarning[] = []
  const renderTimeMs = sample.renderTimeMs
  if (renderTimeMs != null && renderTimeMs > SLOW_FRAME_MS) {
    warnings.push({ kind: 'slow-frame', renderTimeMs })
  }
  const droppedDelta = sample.droppedDelta
  if (droppedDelta != null && droppedDelta > 0) {
    warnings.push({ kind: 'dropped-frames', droppedFrames: droppedDelta })
  }
  const pendingRenders = sample.pendingRenders
  const maxPending = sample.maxPendingRenders ?? 3
  if (pendingRenders != null && pendingRenders >= maxPending) {
    warnings.push({ kind: 'queue-backlog', pendingRenders })
  }
  return warnings
}

const isEncryptedSubtitleContent = (value: unknown): value is EncryptedSubtitleContent => {
  return value != null && typeof value === 'object' && 'contentKey' in value
}

const hasKind = (value: object): value is { kind: unknown } => {
  return 'kind' in value
}

export const parsePreloadTrackSource = (input: unknown): PreloadTrackSource => {
  if (typeof input === 'string' || input instanceof Uint8Array || input instanceof ArrayBuffer) {
    return { kind: 'content', content: input }
  }

  if (input == null || typeof input !== 'object' || !hasKind(input)) {
    throw new Error('Invalid preload track source')
  }

  if (input.kind === 'url' && 'url' in input && typeof input.url === 'string' && input.url.length > 0) {
    return { kind: 'url', url: input.url }
  }
  if (input.kind === 'content' && 'content' in input) {
    const content = input.content
    if (typeof content === 'string' || content instanceof Uint8Array || content instanceof ArrayBuffer) {
      return { kind: 'content', content }
    }
  }
  if (input.kind === 'encrypted' && 'content' in input && isEncryptedSubtitleContent(input.content)) {
    return { kind: 'encrypted', content: input.content }
  }

  throw new Error('Invalid preload track source')
}
