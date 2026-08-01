const MAX_OBSERVED_LATENCY_SECONDS = 0.25
const MAX_COMPENSATION_SECONDS = 0.1
const COMPENSATION_RISE_ALPHA = 0.5
const COMPENSATION_FALL_ALPHA = 0.1
const MIN_COMPENSATION_SECONDS = 0.0005

/**
 * Update a presentation-latency estimate from one completed video-frame render.
 *
 * The sample is measured against RVFC's expected display deadline, rather than
 * from render start, so it includes queueing, worker IPC, bitmap creation and
 * main-thread painting. Outliers are ignored to avoid carrying background-tab
 * throttling or a long GC pause into normal playback.
 */
export const updateTimingCompensation = (
  currentSeconds: number,
  completedAtMs: number,
  expectedDisplayTimeMs: number
): number => {
  if (!Number.isFinite(currentSeconds) || !Number.isFinite(completedAtMs) || !Number.isFinite(expectedDisplayTimeMs)) {
    return Number.isFinite(currentSeconds) ? Math.max(0, currentSeconds) : 0
  }

  const observedLatencySeconds = Math.max(0, (completedAtMs - expectedDisplayTimeMs) / 1000)
  if (observedLatencySeconds > MAX_OBSERVED_LATENCY_SECONDS) return Math.max(0, currentSeconds)

  const targetSeconds = Math.min(observedLatencySeconds, MAX_COMPENSATION_SECONDS)
  const alpha = targetSeconds > currentSeconds ? COMPENSATION_RISE_ALPHA : COMPENSATION_FALL_ALPHA
  const nextSeconds = Math.max(0, currentSeconds + (targetSeconds - currentSeconds) * alpha)
  return nextSeconds < MIN_COMPENSATION_SECONDS ? 0 : nextSeconds
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
