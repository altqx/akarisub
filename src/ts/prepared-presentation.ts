import { compositorScheduleLeadMs } from './timing'

export interface PreparedFrame {
  width: number
  height: number
  bitmap?: ImageBitmap
  stage?: HTMLCanvasElement
  index?: number
  time?: number
  targetDisplayTime?: number
  ready?: boolean
  scheduled?: boolean
  committed?: boolean
  replaceAll?: boolean
  gpuStage?: boolean
  animations?: Animation[]
}

/** Browser effects used by the presentation lifetime owner. */
export interface PresentationHost {
  canvas(): HTMLCanvasElement | undefined
  release(stage: HTMLCanvasElement): void
  committed(frame: PreparedFrame): void
  refreshInterval(): number
  now(): number
  documentTime(): number
}

/** Owns cached snapshots, compositor swaps and the lifetime of visible stages. */
export class PreparedPresentation {
  private _preparedFrames = new Map<number, PreparedFrame>()
  private _stagedCanvases = new Set<HTMLCanvasElement>()
  private _stageFrameIndices = new Map<HTMLCanvasElement, number>()
  private _stageDisplayTimes = new Map<HTMLCanvasElement, number>()
  private _committedStage: HTMLCanvasElement | null = null
  private _scheduledPreparedFrame: PreparedFrame | null = null
  private _destroyed = false
  constructor(private readonly host: PresentationHost) {}

  private get _canvas(): HTMLCanvasElement {
    return this.host.canvas()!
  }

  get(index: number): PreparedFrame | undefined {
    return this._preparedFrames.get(index)
  }
  has(index: number): boolean {
    return this._preparedFrames.has(index)
  }
  take(index: number): PreparedFrame | undefined {
    const frame = this._preparedFrames.get(index)
    this._preparedFrames.delete(index)
    return frame
  }
  store(index: number, frame: PreparedFrame): void {
    const previous = this._preparedFrames.get(index)
    if (previous && previous !== frame) this.dispose(previous)
    this._preparedFrames.set(index, frame)
    this.scheduleNext()
  }
  register(stage: HTMLCanvasElement, index: number): void {
    this._stagedCanvases.add(stage)
    this._stageFrameIndices.set(stage, index)
  }
  layout(update: (stage: HTMLCanvasElement) => void): void {
    for (const stage of this._stagedCanvases) update(stage)
  }
  prune(currentIndex: number, lastIndex: number): void {
    for (const [index, frame] of this._preparedFrames) {
      if (index >= currentIndex && index <= lastIndex) continue
      if ((frame.scheduled || frame.committed) && index < currentIndex) {
        frame.bitmap?.close()
        frame.bitmap = undefined
      } else this.dispose(frame)
      this._preparedFrames.delete(index)
    }
  }
  reject(frame: PreparedFrame): void {
    if (frame.stage && (frame.scheduled || frame.committed || this._committedStage === frame.stage)) {
      frame.bitmap?.close()
      frame.bitmap = undefined
    } else this.dispose(frame)
  }
  present(frame: PreparedFrame, expectedDisplayTime?: number): void {
    const stage = frame.stage
    if (!stage) return
    if (!frame.committed || this._committedStage !== stage) {
      for (const animation of frame.animations ?? []) {
        try {
          animation.finish()
        } catch {
          animation.cancel()
        }
      }
      this.commit(frame)
    }
    this._stageDisplayTimes.set(stage, Number.isFinite(expectedDisplayTime) ? expectedDisplayTime! : this.host.now())
    frame.bitmap?.close()
    frame.bitmap = undefined
  }
  destroy(): void {
    this._destroyed = true
    this.clear(false)
  }

  remove(stage: HTMLCanvasElement): void {
    for (const animation of stage.getAnimations()) animation.cancel()
    this.host.release(stage)
    stage.remove()
    if (this._committedStage === stage) this._committedStage = null
    this._stagedCanvases.delete(stage)
    this._stageFrameIndices.delete(stage)
    this._stageDisplayTimes.delete(stage)
  }

  activateBase(presentedIndex?: number): void {
    if (!this._canvas) return

    // A compositor-scheduled frame can become visible before its RVFC arrives.
    // Never let an older demand response roll that already-visible frame back.
    if (presentedIndex != null) {
      const now = this.host.now()
      let visibleIndex = this._committedStage ? this._stageFrameIndices.get(this._committedStage) : undefined
      for (const stage of this._stagedCanvases) {
        const boundary = this._stageDisplayTimes.get(stage)
        const index = this._stageFrameIndices.get(stage)
        if (boundary != null && boundary <= now && index != null && (visibleIndex == null || index > visibleIndex)) {
          visibleIndex = index
        }
      }
      if (visibleIndex != null && visibleIndex > presentedIndex) return
    }

    for (const animation of this._canvas.getAnimations()) animation.cancel()
    this._canvas.style.opacity = '1'

    const retainedStages = new Set<HTMLCanvasElement>()
    for (const [index, frame] of [...this._preparedFrames]) {
      const frameIndex = frame.index ?? index
      if (presentedIndex != null && frameIndex > presentedIndex && frame.stage) {
        for (const animation of frame.animations ?? []) animation.cancel()
        frame.animations = undefined
        frame.scheduled = false
        frame.committed = false
        frame.stage.style.opacity = '0'
        retainedStages.add(frame.stage)
        continue
      }
      this.dispose(frame)
      this._preparedFrames.delete(index)
    }
    this._scheduledPreparedFrame = null
    for (const stage of [...this._stagedCanvases]) {
      if (!retainedStages.has(stage)) this.remove(stage)
    }
    this._committedStage = null
    this.scheduleNext()
  }

  dispose(frame: PreparedFrame): void {
    if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null
    for (const animation of frame.animations ?? []) animation.cancel()
    frame.animations = undefined
    frame.scheduled = false
    frame.bitmap?.close()
    frame.bitmap = undefined
    frame.gpuStage = false

    if (frame.stage) {
      this.remove(frame.stage)
      frame.stage = undefined
    }
  }

  scheduleNext(): void {
    if (this._scheduledPreparedFrame || this._destroyed) return

    let next: PreparedFrame | undefined
    let nextTime = Number.POSITIVE_INFINITY
    const now = this.host.now()
    for (const frame of this._preparedFrames.values()) {
      const target = frame.targetDisplayTime
      if (
        !frame.stage ||
        frame.committed ||
        frame.scheduled ||
        !Number.isFinite(target) ||
        target! <= now ||
        target! >= nextTime
      ) {
        continue
      }
      next = frame
      nextTime = target!
    }

    if (next?.ready) this.schedule(next, nextTime)
  }

  commit(frame: PreparedFrame): void {
    const stage = frame.stage
    if (!stage || !this._stagedCanvases.has(stage) || this._destroyed) return

    if (!frame.committed) {
      this.host.committed(frame)
    }

    for (const animation of frame.animations ?? []) animation.cancel()
    frame.animations = undefined
    frame.scheduled = false
    frame.committed = true
    if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null

    for (const animation of this._canvas.getAnimations()) animation.cancel()
    this._canvas.style.opacity = '0'
    stage.style.opacity = '1'
    this._committedStage = stage

    const frameIndex = frame.index ?? this._stageFrameIndices.get(stage)
    for (const candidate of [...this._stagedCanvases]) {
      if (candidate === stage) continue
      for (const animation of candidate.getAnimations()) animation.cancel()
      const candidateIndex = this._stageFrameIndices.get(candidate)
      const shouldRetire =
        frame.replaceAll || frameIndex == null || candidateIndex == null || candidateIndex < frameIndex
      if (shouldRetire) {
        this.remove(candidate)
      } else {
        candidate.style.opacity = '0'
      }
    }

    this.scheduleNext()
  }

  schedule(frame: PreparedFrame, targetDisplayTime: number): void {
    const stage = frame.stage
    frame.targetDisplayTime = targetDisplayTime
    if (
      !stage ||
      !frame.ready ||
      frame.scheduled ||
      frame.committed ||
      this._scheduledPreparedFrame ||
      this._destroyed ||
      targetDisplayTime <= this.host.now()
    ) {
      return
    }

    // Each swap independently hides every other layer. Do not form a single
    // predecessor chain: removing one skipped prefetched frame would otherwise
    // cancel the only animation capable of hiding its predecessor. Future and
    // unscheduled stages are hidden too, but retained for their own later show.
    const previousStages = [...this._stagedCanvases].filter((candidate) => candidate !== stage)
    this._stageDisplayTimes.set(stage, targetDisplayTime)

    const performanceTime = this.host.now()
    const compositorSwapTime = targetDisplayTime - compositorScheduleLeadMs(this.host.refreshInterval())
    const documentTime = this.host.documentTime()
    const hasDocumentTime = Number.isFinite(documentTime)
    const sharedStartTime = hasDocumentTime ? documentTime + (compositorSwapTime - performanceTime) : undefined
    const animationOptions: KeyframeAnimationOptions = {
      delay: hasDocumentTime ? 0 : Math.max(0, compositorSwapTime - performanceTime),
      // A near-zero positive interval keeps the swap compositor-scheduled while
      // allowing its cleanup promise to run in the same refresh. A full 1 ms
      // interval can survive until the next paint when animation composite order
      // temporarily favors an older stage.
      duration: 0.001,
      easing: 'steps(1, jump-start)',
      fill: 'forwards'
    }

    const hiddenLayers = [this._canvas, ...previousStages]
    let showAnimation: Animation | null = null
    const hideAnimations: Animation[] = []
    try {
      showAnimation = stage.animate([{ opacity: '0' }, { opacity: '1' }], animationOptions)
      for (const layer of hiddenLayers) {
        hideAnimations.push(layer.animate([{ opacity: '1' }, { opacity: '0' }], animationOptions))
      }
    } catch {
      showAnimation?.cancel()
      for (const animation of hideAnimations) animation.cancel()
      return
    }
    if (!showAnimation) return

    if (sharedStartTime != null) {
      showAnimation.startTime = sharedStartTime
      for (const animation of hideAnimations) animation.startTime = sharedStartTime
    }

    frame.scheduled = true
    this._scheduledPreparedFrame = frame
    const swapAnimations = [showAnimation, ...hideAnimations]
    frame.animations = swapAnimations
    const releaseSwapAnimations = (): void => {
      for (const animation of swapAnimations) animation.cancel()
      if (frame.animations === swapAnimations) frame.animations = undefined
    }

    // The show animation is the authoritative commit. Once it completes, make
    // its state explicit, release this swap's fill animations, and remove all
    // older layers. A later prefetched swap may already have its own independent
    // hide animation on this stage; it is intentionally left untouched.
    void showAnimation.finished.then(
      () => {
        if (frame.animations !== swapAnimations) return
        if (!frame.committed) this.commit(frame)
        releaseSwapAnimations()
        if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null
        this.scheduleNext()
      },
      () => {
        if (frame.animations !== swapAnimations) return
        releaseSwapAnimations()
        if (this._scheduledPreparedFrame === frame) this._scheduledPreparedFrame = null
        frame.scheduled = false
        if (!frame.committed) this.scheduleNext()
      }
    )
  }

  clear(preservePresentation: boolean = true): void {
    let preservedStage = preservePresentation ? this._committedStage : null
    if (preservePresentation) {
      const now = this.host.now()
      let latestBoundary = preservedStage ? (this._stageDisplayTimes.get(preservedStage) ?? -Infinity) : -Infinity
      for (const stage of this._stagedCanvases) {
        const boundary = this._stageDisplayTimes.get(stage)
        if (boundary != null && boundary <= now && boundary >= latestBoundary) {
          preservedStage = stage
          latestBoundary = boundary
        }
      }
    }
    const preservedFrameIndex = preservedStage ? this._stageFrameIndices.get(preservedStage) : undefined
    const preservedDisplayTime = preservedStage ? this._stageDisplayTimes.get(preservedStage) : undefined

    this._scheduledPreparedFrame = null
    for (const frame of this._preparedFrames.values()) {
      if (frame.stage === preservedStage) {
        for (const animation of frame.animations ?? []) animation.cancel()
        frame.animations = undefined
        frame.scheduled = false
        frame.bitmap?.close()
        frame.bitmap = undefined
        continue
      }
      this.dispose(frame)
    }
    this._preparedFrames.clear()
    for (const stage of [...this._stagedCanvases]) {
      if (stage !== preservedStage) this.remove(stage)
    }
    this._stagedCanvases.clear()
    this._stageFrameIndices.clear()
    this._stageDisplayTimes.clear()
    for (const animation of this._canvas?.getAnimations?.() ?? []) animation.cancel()
    if (preservedStage?.isConnected) {
      for (const animation of preservedStage.getAnimations()) animation.cancel()
      preservedStage.style.opacity = '1'
      this._stagedCanvases.add(preservedStage)
      if (preservedFrameIndex != null) this._stageFrameIndices.set(preservedStage, preservedFrameIndex)
      if (preservedDisplayTime != null) this._stageDisplayTimes.set(preservedStage, preservedDisplayTime)
      if (this._canvas) this._canvas.style.opacity = '0'
      this._committedStage = preservedStage
    } else {
      if (preservedStage) this.remove(preservedStage)
      this._committedStage = null
      if (this._canvas) this._canvas.style.opacity = '1'
    }
  }
}
