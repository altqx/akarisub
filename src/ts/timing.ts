const MAX_OBSERVED_LATENCY_SECONDS = 0.25
const MAX_COMPENSATION_SECONDS = 0.1
const COMPENSATION_RISE_ALPHA = 0.5
const COMPENSATION_FALL_ALPHA = 0.1
const MIN_COMPENSATION_SECONDS = 0.0005

/**
 * Update a render-pipeline latency estimate from one completed video-frame render.
 *
 * The sample starts when a render is dispatched, so queued RVFC callbacks can
 * account for their own wait separately. Outliers are ignored to avoid carrying
 * background-tab throttling or a long GC pause into normal playback.
 */
export const updateTimingCompensation = (
  currentSeconds: number,
  completedAtMs: number,
  dispatchedAtMs: number
): number => {
  if (!Number.isFinite(currentSeconds) || !Number.isFinite(completedAtMs) || !Number.isFinite(dispatchedAtMs)) {
    return Number.isFinite(currentSeconds) ? Math.max(0, currentSeconds) : 0
  }

  const observedLatencySeconds = Math.max(0, (completedAtMs - dispatchedAtMs) / 1000)
  if (observedLatencySeconds > MAX_OBSERVED_LATENCY_SECONDS) return Math.max(0, currentSeconds)

  const targetSeconds = Math.min(observedLatencySeconds, MAX_COMPENSATION_SECONDS)
  const alpha = targetSeconds > currentSeconds ? COMPENSATION_RISE_ALPHA : COMPENSATION_FALL_ALPHA
  const nextSeconds = Math.max(0, currentSeconds + (targetSeconds - currentSeconds) * alpha)
  return nextSeconds < MIN_COMPENSATION_SECONDS ? 0 : nextSeconds
}

/**
 * Return how far the video clock will advance between an RVFC frame's expected
 * display time and the estimated completion of a render dispatched right now.
 */
export const presentationLeadSeconds = (
  dispatchedAtMs: number,
  expectedDisplayTimeMs: number | undefined,
  estimatedPipelineSeconds: number
): number => {
  const safePipelineSeconds = Number.isFinite(estimatedPipelineSeconds) ? Math.max(0, estimatedPipelineSeconds) : 0

  if (!Number.isFinite(dispatchedAtMs) || !Number.isFinite(expectedDisplayTimeMs)) {
    return safePipelineSeconds
  }

  return Math.max(0, (dispatchedAtMs - expectedDisplayTimeMs!) / 1000 + safePipelineSeconds)
}

/**
 * Estimate the compositor refresh interval from requestAnimationFrame samples.
 * The fastest stable cluster rejects whole-refresh main-thread stalls without
 * biasing a 144 Hz display toward 72/48 Hz, while averaging timer quantization.
 */
export const estimateRefreshIntervalMs = (
  samples: readonly number[],
  fallbackMs: number = 1000 / 60
): number => {
  const valid = samples.filter((sample) => Number.isFinite(sample) && sample >= 3 && sample <= 50)
  if (valid.length < 4) return fallbackMs

  valid.sort((left, right) => left - right)
  const baseInterval = valid[Math.floor((valid.length - 1) * 0.1)]
  const baseCluster = valid.filter((sample) => sample <= baseInterval * 1.25)
  const measuredInterval = baseCluster.reduce((sum, sample) => sum + sample, 0) / baseCluster.length
  const measuredHz = 1000 / measuredInterval
  const commonRefreshRates = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360]
  const nearestRate = commonRefreshRates.reduce((nearest, rate) =>
    Math.abs(rate - measuredHz) < Math.abs(nearest - measuredHz) ? rate : nearest
  )
  return Math.abs(nearestRate - measuredHz) / nearestRate <= 0.03 ? 1000 / nearestRate : measuredInterval
}

/**
 * Put a prepared canvas transition safely inside the interval before its video
 * refresh. A transition exactly on the boundary can be composited one refresh
 * later; staying within one quarter-refresh prevents it appearing on the
 * previous refresh while giving the compositor time to include it.
 */
export const compositorScheduleLeadMs = (refreshIntervalMs: number): number => {
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) return 0
  return Math.min(2, refreshIntervalMs * 0.25)
}

/**
 * Predict the display refresh assigned to an encoded frame before its RVFC.
 * RVFC clock offsets straddle the ideal media clock on cadence-converted
 * displays (for example 23.976 fps on 60 Hz), so average several observations
 * and snap the result to the already observed compositor refresh grid.
 */
export const predictFrameDisplayTimeMs = (
  frameMediaTime: number,
  playbackRate: number,
  clockOffsetsMs: readonly number[],
  displayGridAnchorMs: number | undefined,
  refreshIntervalMs: number
): number | undefined => {
  if (
    !Number.isFinite(frameMediaTime) ||
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0 ||
    clockOffsetsMs.length < 2 ||
    !Number.isFinite(displayGridAnchorMs) ||
    !Number.isFinite(refreshIntervalMs) ||
    refreshIntervalMs <= 0
  ) {
    return undefined
  }

  const validOffsets = clockOffsetsMs.filter(Number.isFinite)
  if (validOffsets.length < 2) return undefined

  // Preserve the alternating offset clusters created by cadence conversion,
  // but prevent a short presentation stall from moving the prediction by a
  // full refresh. A symmetric quarter-trim keeps the two cadence phases while
  // rejecting consecutive outliers in the bounded observation window.
  validOffsets.sort((left, right) => left - right)
  const trimCount = validOffsets.length >= 5 ? Math.floor(validOffsets.length / 4) : 0
  const stableOffsets = trimCount > 0 ? validOffsets.slice(trimCount, -trimCount) : validOffsets
  const clockOffset = stableOffsets.reduce((sum, value) => sum + value, 0) / stableOffsets.length
  const idealDisplayTime = clockOffset + (frameMediaTime * 1000) / playbackRate
  const refreshesFromAnchor = Math.round((idealDisplayTime - displayGridAnchorMs!) / refreshIntervalMs)
  return displayGridAnchorMs! + refreshesFromAnchor * refreshIntervalMs
}

export const normalizeFrameTimeline = (
  frameTimes: ArrayLike<number> & { mediaTimeOrigin?: number; subtitleTimeOffset?: number }
): Float64Array & { mediaTimeOrigin?: number; subtitleTimeOffset?: number } => {
  const times: number[] = []
  for (let i = 0; i < frameTimes.length; i++) {
    const time = Number(frameTimes[i])
    if (Number.isFinite(time) && time >= 0) times.push(time)
  }
  times.sort((a, b) => a - b)

  let write = 0
  for (let read = 0; read < times.length; read++) {
    if (write === 0 || times[read] > times[write - 1]) {
      times[write++] = times[read]
    }
  }
  times.length = write
  const normalized = Float64Array.from(times) as Float64Array & {
    mediaTimeOrigin?: number
    subtitleTimeOffset?: number
  }
  if (Number.isFinite(frameTimes.mediaTimeOrigin)) normalized.mediaTimeOrigin = frameTimes.mediaTimeOrigin
  if (Number.isFinite(frameTimes.subtitleTimeOffset) && frameTimes.subtitleTimeOffset! >= 0) {
    normalized.subtitleTimeOffset = frameTimes.subtitleTimeOffset
  }
  return normalized
}

export const frameIndexAtOrAfter = (frameTimes: ArrayLike<number>, mediaTime: number): number => {
  if (frameTimes.length === 0 || !Number.isFinite(mediaTime)) return -1

  let low = 0
  let high = frameTimes.length
  while (low < high) {
    const middle = low + ((high - low) >> 1)
    if (frameTimes[middle] < mediaTime) low = middle + 1
    else high = middle
  }
  return low < frameTimes.length ? low : frameTimes.length - 1
}

export const nearestFrameIndex = (frameTimes: ArrayLike<number>, mediaTime: number): number => {
  const next = frameIndexAtOrAfter(frameTimes, mediaTime)
  if (next <= 0) return next
  const previous = next - 1
  return mediaTime - frameTimes[previous] <= frameTimes[next] - mediaTime ? previous : next
}

export const presentedFrameIndex = (frameTimes: ArrayLike<number>, mediaTime: number): number => {
  const next = frameIndexAtOrAfter(frameTimes, mediaTime)
  if (next < 0) return next
  return next > 0 && frameTimes[next] > mediaTime ? next - 1 : next
}

export const snapToFrameTimeline = (frameTimes: ArrayLike<number>, mediaTime: number): number => {
  const index = presentedFrameIndex(frameTimes, mediaTime)
  return index >= 0 ? frameTimes[index] : mediaTime
}

/** Map a browser frame timestamp to the PTS-normalized clock used by ASS cues. */
export const snapToSubtitleTimeline = (
  frameTimes: ArrayLike<number> & { subtitleTimeOffset?: number },
  mediaTime: number
): number => {
  const frameTime = snapToFrameTimeline(frameTimes, mediaTime)
  const offset = Number.isFinite(frameTimes.subtitleTimeOffset) ? Math.max(0, frameTimes.subtitleTimeOffset!) : 0
  return Math.max(0, frameTime - offset)
}

export const subtitleTimeForFrame = (
  frameTimes: ArrayLike<number> & { subtitleTimeOffset?: number },
  frameIndex: number
): number => {
  const frameTime = frameTimes[frameIndex]
  if (!Number.isFinite(frameTime)) return Number.NaN
  const offset = Number.isFinite(frameTimes.subtitleTimeOffset) ? Math.max(0, frameTimes.subtitleTimeOffset!) : 0
  return Math.max(0, frameTime - offset)
}

// Exact timelines identify the presented frame; do not latency-predict into a future frame.
export const selectRenderMediaTime = (
  frameTimes: (ArrayLike<number> & { subtitleTimeOffset?: number }) | null,
  mediaTime: number,
  predictedMediaTime: number,
  _isPaused: boolean
): number => (frameTimes ? snapToSubtitleTimeline(frameTimes, mediaTime) : predictedMediaTime)

export const isStalePresentation = (presentationId: number | undefined, latestPresentationId: number): boolean =>
  presentationId != null && presentationId < latestPresentationId

/**
 * Resolve an RVFC timestamp into the clock domain used by subtitle cues.
 * Transport PTS and normalized currentTime can disagree on transmuxed streams.
 */
export const resolvePresentationMediaTime = (
  metadataMediaTime: number,
  videoCurrentTime: number | undefined,
  frameTimelineEnabled: boolean,
  mediaTimeOrigin?: number,
  frameTimes?: ArrayLike<number>
): number => {
  if (!frameTimelineEnabled) return metadataMediaTime

  if (Number.isFinite(mediaTimeOrigin)) {
    const adjustedMediaTime = metadataMediaTime - mediaTimeOrigin!
    if (frameTimes?.length) {
      const directIndex = nearestFrameIndex(frameTimes, metadataMediaTime)
      const adjustedIndex = nearestFrameIndex(frameTimes, adjustedMediaTime)
      const directError = directIndex >= 0 ? Math.abs(frameTimes[directIndex] - metadataMediaTime) : Infinity
      const adjustedError = adjustedIndex >= 0 ? Math.abs(frameTimes[adjustedIndex] - adjustedMediaTime) : Infinity

      // Prefer the clock domain that lands on the probed frame map.
      if (Math.abs(directError - adjustedError) > 0.0001) {
        return adjustedError < directError ? adjustedMediaTime : metadataMediaTime
      }

      // Ambiguous origin (near a frame-period multiple): use currentTime as a hint only.
      if (Number.isFinite(videoCurrentTime)) {
        return Math.abs(adjustedMediaTime - videoCurrentTime!) < Math.abs(metadataMediaTime - videoCurrentTime!)
          ? adjustedMediaTime
          : metadataMediaTime
      }
    }
    return adjustedMediaTime
  }

  if (frameTimes?.length && Number.isFinite(videoCurrentTime)) {
    const metadataIndex = nearestFrameIndex(frameTimes, metadataMediaTime)
    const metadataError = metadataIndex >= 0 ? Math.abs(frameTimes[metadataIndex] - metadataMediaTime) : Infinity

    // v1 timelines lack mediaTimeOrigin; prefer normalized RVFC when it fits the map.
    return metadataError <= 0.0025 ? metadataMediaTime : videoCurrentTime!
  }

  return Number.isFinite(videoCurrentTime) ? videoCurrentTime! : metadataMediaTime
}

/** Return the subtitle media time expected to be visible when painting completes. */
export const compensatedMediaTime = (
  mediaTime: number,
  playbackRate: number,
  configuredRenderAheadSeconds: number,
  adaptiveCompensationSeconds: number,
  isPaused: boolean
): number => {
  if (isPaused) return mediaTime

  const safeRate = Number.isFinite(playbackRate) ? playbackRate : 1
  const configuredLead = Number.isFinite(configuredRenderAheadSeconds) ? configuredRenderAheadSeconds : 0
  const adaptiveLead = Number.isFinite(adaptiveCompensationSeconds) ? Math.max(0, adaptiveCompensationSeconds) : 0

  return mediaTime + (configuredLead + adaptiveLead) * safeRate
}
