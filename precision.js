import AkariSub from './dist/index.js'

// Keep exact prepared subtitle swaps on the compositor clock instead of
// force-finishing them on the main thread when requestVideoFrameCallback fires.
// A swap that is already on time or early is left armed; only a prediction that
// would be more than 0.05 ms late is retimed to the authoritative RVFC deadline.
const AUTHORITATIVE_DEADLINE_TOLERANCE_MS = 0.05
const prototype = AkariSub.prototype
const presentPreparedFrame = prototype._presentPreparedFrame

prototype._presentPreparedFrame = function (frame, presentationId, expectedDisplayTime) {
  const stage = frame?.stage
  if (!stage) {
    return presentPreparedFrame.call(this, frame, presentationId, expectedDisplayTime)
  }

  if (!this._activatePresentation(presentationId)) {
    if (frame.scheduled || frame.committed || this._committedStage === stage) {
      frame.bitmap?.close()
      frame.bitmap = undefined
    } else {
      this._disposePreparedFrame(frame)
    }
    return
  }

  if (!frame.committed || this._committedStage !== stage) {
    const authoritativeDisplayTime = Number.isFinite(expectedDisplayTime)
      ? Math.max(expectedDisplayTime, performance.now() + 0.001)
      : undefined
    const alreadyOnTimeOrAhead =
      authoritativeDisplayTime != null &&
      frame.scheduled &&
      !!frame.animations?.length &&
      Number.isFinite(frame.targetDisplayTime) &&
      frame.targetDisplayTime <= authoritativeDisplayTime + AUTHORITATIVE_DEADLINE_TOLERANCE_MS

    if (authoritativeDisplayTime != null && !alreadyOnTimeOrAhead) {
      const previousAnimations = frame.animations
      frame.animations = undefined
      frame.scheduled = false
      if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null
      for (const animation of previousAnimations ?? []) animation.cancel()
      stage.style.opacity = '0'
      this._schedulePreparedFrame(frame, authoritativeDisplayTime)
      if (!frame.scheduled) this._commitPreparedStage(frame)
    } else if (authoritativeDisplayTime == null) {
      for (const animation of frame.animations ?? []) animation.cancel()
      this._commitPreparedStage(frame)
    }
  }

  this._stageDisplayTimes.set(
    stage,
    Number.isFinite(expectedDisplayTime) ? expectedDisplayTime : performance.now()
  )
  frame.bitmap?.close()
  frame.bitmap = undefined
}

export default AkariSub
export { AkariSub }
export * from './dist/index.js'
