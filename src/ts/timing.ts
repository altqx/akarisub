const MAX_OBSERVED_LATENCY_SECONDS = 0.25
const MAX_COMPENSATION_SECONDS = 0.1
const COMPENSATION_RISE_ALPHA = 0.5
const COMPENSATION_FALL_ALPHA = 0.1
const MIN_COMPENSATION_SECONDS = 0.0005
export const MAX_FRAME_TIMELINE_ENTRIES = 250_000

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

/** Copy, validate, sort, and de-duplicate media presentation timestamps. */
export const normalizeFrameTimeline = (frameTimes: ArrayLike<number>): Float64Array => {
  const length = frameTimes.length
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError('Frame timeline length must be a non-negative safe integer')
  }
  if (length > MAX_FRAME_TIMELINE_ENTRIES) {
    throw new RangeError(`Frame timeline resource limit is ${MAX_FRAME_TIMELINE_ENTRIES} entries`)
  }
  const times: number[] = []
  for (let i = 0; i < length; i++) {
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
  return Float64Array.from(times)
}

/** Find the first encoded video frame at or after a media timestamp. */
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

/** Find the encoded frame timestamp closest to a browser media timestamp. */
export const nearestFrameIndex = (frameTimes: ArrayLike<number>, mediaTime: number): number => {
  const next = frameIndexAtOrAfter(frameTimes, mediaTime)
  if (next <= 0) return next
  const previous = next - 1
  return mediaTime - frameTimes[previous] <= frameTimes[next] - mediaTime ? previous : next
}

/** Snap a prediction to the encoded frame currently presented at that media time. */
export const snapToFrameTimeline = (frameTimes: ArrayLike<number>, mediaTime: number): number => {
  const next = frameIndexAtOrAfter(frameTimes, mediaTime)
  if (next < 0) return mediaTime
  return next > 0 && frameTimes[next]! > mediaTime ? frameTimes[next - 1]! : frameTimes[next]!
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
