import { describe, expect, test } from 'bun:test'
import AkariSub from '../src/ts/akarisub'
import { WebGPURenderer } from '../src/ts/webgpu-renderer'
import {
  compensatedMediaTime,
  estimateRefreshIntervalMs,
  frameIndexAtOrAfter,
  nearestFrameIndex,
  normalizeFrameTimeline,
  presentationLeadSeconds,
  predictFrameDisplayTimeMs,
  presentedFrameIndex,
  isStalePresentation,
  resolvePresentationMediaTime,
  selectRenderMediaTime,
  snapToSubtitleTimeline,
  snapToFrameTimeline,
  subtitleTimeForFrame,
  updateTimingCompensation
} from '../src/ts/timing'

describe('subtitle timing compensation', () => {
  test('learns bounded positive presentation lag', () => {
    expect(updateTimingCompensation(0, 1030, 1000)).toBeCloseTo(0.015)
    expect(updateTimingCompensation(0.09, 1200, 1000)).toBeCloseTo(0.095)
  })

  test('ignores throttling outliers and decays when frames meet their deadline', () => {
    expect(updateTimingCompensation(0.02, 1500, 1000)).toBe(0.02)
    expect(updateTimingCompensation(0.02, 990, 1000)).toBeCloseTo(0.018)
  })

  test('scales configured and adaptive lead by playback rate', () => {
    expect(compensatedMediaTime(10, 2, 0.01, 0.02, false)).toBeCloseTo(10.06)
    expect(compensatedMediaTime(10, 2, 0.01, 0.02, true)).toBe(10)
  })

  test('includes per-frame queue delay when predicting the painted frame', () => {
    expect(presentationLeadSeconds(110, 100, 0.02)).toBeCloseTo(0.03)
    expect(presentationLeadSeconds(80, 100, 0.01)).toBe(0)
  })

  test('uses the pipeline estimate when no RVFC deadline is available', () => {
    expect(presentationLeadSeconds(110, undefined, 0.02)).toBeCloseTo(0.02)
  })

  test('measures the physical refresh interval without counting skipped refreshes', () => {
    expect(estimateRefreshIntervalMs([6.94, 6.95, 13.89, 6.93, 20.8, 6.94])).toBeCloseTo(6.94, 2)
    expect(estimateRefreshIntervalMs([16.67, 33.33, 16.66, 16.68, 50, 16.67])).toBeCloseTo(16.67, 2)
  })

  test('predicts the next 23.976 fps compositor slot across 60 Hz cadence conversion', () => {
    const offsets = [-2002.844, -1994.655, -2003.066, -1994.677, -2003.077, -1994.788]
    expect(predictFrameDisplayTimeMs(3.9633, 1, offsets, 1710.2, 1000 / 60)).toBeCloseTo(1960.2, 1)
  })

  test('predicts the exact six-refresh boundary on a 144 Hz display', () => {
    expect(predictFrameDisplayTimeMs(3.9633, 1, [-2921.588, -2921.588], 1000, 1000 / 144)).toBeCloseTo(1041.667, 2)
  })

  test('normalizes backend frame timestamps for reusable frame sync', () => {
    expect([...normalizeFrameTimeline([0.04, Number.NaN, 0, 0.04, -1, 0.02])]).toEqual([0, 0.02, 0.04])
  })

  test('snaps predicted presentation time to the encoded frame still being presented', () => {
    const timeline = new Float64Array([0, 0.041708, 0.083417])
    expect(frameIndexAtOrAfter(timeline, 0.02)).toBe(1)
    expect(snapToFrameTimeline(timeline, 0.005)).toBe(0)
    expect(snapToFrameTimeline(timeline, 0.02)).toBe(0)
    expect(snapToFrameTimeline(timeline, 0.041707)).toBe(0)
    expect(snapToFrameTimeline(timeline, 0.041708)).toBeCloseTo(0.041708)
    expect(snapToFrameTimeline(timeline, 1)).toBeCloseTo(0.083417)
    expect(nearestFrameIndex(timeline, 0.039)).toBe(1)
    expect(nearestFrameIndex(timeline, 0.06)).toBe(1)
    expect(presentedFrameIndex(timeline, 0.02)).toBe(0)
    expect(presentedFrameIndex(timeline, 0.041707)).toBe(0)
  })

  test('does not extrapolate an exact timeline callback into future frames', () => {
    const timeline = new Float64Array([0, 0.041708, 0.083417, 0.125125, 0.166833])
    expect(selectRenderMediaTime(timeline, 0.041708, 0.166833, false)).toBeCloseTo(0.041708)
    expect(selectRenderMediaTime(timeline, 0.041708, 0.166833, true)).toBeCloseTo(0.041708)
  })

  test('maps a DTS-normalized browser frame back to the PTS-normalized subtitle clock', () => {
    const timeline = Object.assign(new Float64Array([0.083422, 0.125133, 0.166844]), {
      mediaTimeOrigin: 1.4,
      subtitleTimeOffset: 0.083422
    })

    expect(snapToSubtitleTimeline(timeline, 0.083422)).toBe(0)
    expect(snapToSubtitleTimeline(timeline, 0.125133)).toBeCloseTo(0.041711)
    expect(subtitleTimeForFrame(timeline, 2)).toBeCloseTo(0.083422)
    expect(selectRenderMediaTime(timeline, 0.166844, 0.2, false)).toBeCloseTo(0.083422)

    const normalized = normalizeFrameTimeline(timeline)
    expect(normalized.mediaTimeOrigin).toBe(1.4)
    expect(normalized.subtitleTimeOffset).toBe(0.083422)
  })

  test('rejects only paints superseded by a newer presentation', () => {
    expect(isStalePresentation(7, 8)).toBe(true)
    expect(isStalePresentation(8, 8)).toBe(false)
    expect(isStalePresentation(undefined, 8)).toBe(false)
  })

  test('uses the normalized video clock for exact timelines instead of a transport PTS', () => {
    expect(resolvePresentationMediaTime(4.375, 2.875, true)).toBe(2.875)
    expect(resolvePresentationMediaTime(4.375, 2.875, false)).toBe(4.375)
    expect(resolvePresentationMediaTime(4.375, Number.NaN, true)).toBe(4.375)
  })

  test('maps RVFC transport PTS into the exact normalized frame timeline when its origin is known', () => {
    expect(resolvePresentationMediaTime(4.375, 2.8, true, 1.5)).toBe(2.875)
    expect(resolvePresentationMediaTime(5.971, 5.89, true, 0.007)).toBeCloseTo(5.964)

    const source = Object.assign(new Float64Array([0, 0.041708]), { mediaTimeOrigin: 1.5 })
    expect(normalizeFrameTimeline(source).mediaTimeOrigin).toBe(1.5)
  })

  test('does not subtract the transport origin from Shaka-normalized RVFC timestamps', () => {
    const timeline = new Float64Array([2.837166, 2.878877, 2.920588, 2.962288])
    expect(resolvePresentationMediaTime(2.920588, 2.922556, true, 1.4, timeline)).toBe(2.920588)
  })

  test('subtracts the origin when RVFC retains the container timestamp clock', () => {
    const timeline = new Float64Array([2.878, 2.92, 2.962])
    expect(resolvePresentationMediaTime(2.927, 2.91, true, 0.007, timeline)).toBeCloseTo(2.92)
  })

  test('uses Shaka RVFC timestamps when they fit a v1 frame map better than currentTime', () => {
    const timeline = new Float64Array([3.837167, 3.878878, 3.920589, 3.962289])
    expect(resolvePresentationMediaTime(3.879877, 3.91105, true, undefined, timeline)).toBe(3.879877)
  })

  test('uses currentTime for a v1 transport timestamp that does not fit the frame map', () => {
    const timeline = new Float64Array([2.837166, 2.878877, 2.920588, 2.962288])
    expect(resolvePresentationMediaTime(4.320588, 2.922556, true, undefined, timeline)).toBe(2.922556)
  })

  test('forces each prepared snapshot after demand rendering may change the shared libass baseline', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    Object.assign(renderer, {
      _prepareRequests: new Map([[1, { index: 1, renderEpoch: 3 }]]),
      _preparedFrames: new Map(),
      _frameTimeline: new Float64Array([0, 1]),
      _video: { currentTime: 0 },
      _renderEpoch: 3,
      _prepareForce: false,
      _canvasctrl: { width: 1920, height: 1080 },
      _finishWorkerSlot: () => {}
    })

    renderer._preparedFrame({
      prepareId: 1,
      renderEpoch: 3,
      time: 1,
      width: 1920,
      height: 1080,
      bitmap: { close: () => {} }
    })

    expect(renderer._prepareForce).toBe(true)
  })

  test('renders an unprepared exact presentation into a worker snapshot before its display deadline', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const messages: Array<{ target: string; data: Record<string, unknown> }> = []
    Object.assign(renderer, {
      _video: { paused: false, ended: false, playbackRate: 1 },
      _playstate: false,
      _videoWidth: 1920,
      _videoHeight: 1080,
      _frameTimeline: new Float64Array([0, 1, 2]),
      framePrefetch: 2,
      _nextPresentationId: 4,
      _nextPrepareId: 9,
      _prepareRequests: new Map(),
      _renderEpoch: 3,
      timeOffset: 0,
      _postWorkerMessage: (target: string, data: Record<string, unknown>) => messages.push({ target, data })
    })

    renderer._demandRender({
      mediaTime: 1.2,
      width: 1920,
      height: 1080,
      expectedDisplayTime: performance.now() + 10
    })

    expect(messages).toEqual([
      {
        target: 'prepare',
        data: { time: 1, prepareId: 9, renderEpoch: 3, force: true }
      }
    ])
    expect(renderer._prepareRequests.get(9).presentation.presentationId).toBe(4)
  })

  test('presents a completed exact snapshot and releases the worker immediately', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const bitmap = { close: () => {} }
    const presentations: Array<{ frame: unknown; presentationId: number; expectedDisplayTime?: number }> = []
    let finished = 0
    Object.assign(renderer, {
      _prepareRequests: new Map([
        [
          2,
          {
            index: 5,
            renderEpoch: 7,
            presentation: { mediaTime: 5, width: 1920, height: 1080, presentationId: 12, expectedDisplayTime: 140 }
          }
        ]
      ]),
      _renderEpoch: 7,
      _prepareForce: false,
      _canvasctrl: { width: 1920, height: 1080 },
      _presentPreparedFrame: (frame: unknown, presentationId: number, expectedDisplayTime?: number) =>
        presentations.push({ frame, presentationId, expectedDisplayTime }),
      _finishWorkerSlot: () => finished++
    })

    renderer._preparedFrame({
      prepareId: 2,
      renderEpoch: 7,
      time: 5,
      width: 1920,
      height: 1080,
      bitmap
    })

    expect(presentations).toEqual([
      { frame: { width: 1920, height: 1080, bitmap }, presentationId: 12, expectedDisplayTime: 140 }
    ])
    expect(renderer._prepareForce).toBe(true)
    expect(finished).toBe(1)
  })

  test('commits a cached exact snapshot during the RVFC rendering phase without a timer guard', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    const bitmap = { close: () => calls.push('close') }
    Object.assign(renderer, {
      _gpuRenderer: null,
      _ctx: {
        clearRect: () => calls.push('clear'),
        drawImage: () => calls.push('draw')
      },
      _activatePresentation: () => true
    })

    renderer._presentPreparedFrame({ width: 1920, height: 1080, bitmap }, 12, performance.now() + 100)

    expect(calls).toEqual(['clear', 'draw', 'close'])
  })

  test('stages exact snapshots on WebGPU without opening a 2D context', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    const stage = {
      width: 0,
      height: 0,
      style: {},
      getContext: (type: string) => {
        calls.push(`context:${type}`)
        return null
      }
    }
    const gpu = new WebGPURenderer()
    ;(gpu as any).renderBitmapToCanvas = (canvas: unknown) => {
      expect(canvas).toBe(stage)
      calls.push('webgpu')
      return true
    }
    const bitmap = { close: () => calls.push('close') }
    const originalDocument = globalThis.document

    try {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { createElement: () => stage }
      })
      Object.assign(renderer, {
        _canvas: { style: {} },
        _canvasParent: { appendChild: () => calls.push('append') },
        _destroyed: false,
        _rendererType: 'webgpu',
        _gpuRenderer: gpu,
        _stagedCanvases: new Set(),
        _stageFrameIndices: new Map(),
        _stageDisplayTimes: new Map(),
        _predictedDisplayTimes: new Map()
      })

      const frame = { width: 1920, height: 1080, bitmap }
      renderer._stagePreparedFrame(4, frame)

      expect(calls).toEqual(['webgpu', 'close', 'append'])
      expect(frame.stage).toBe(stage)
      expect(renderer._stagedCanvases).toEqual(new Set([stage]))
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document')
      } else {
        Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
      }
    }
  })

  test('reveals a demand-rendered base canvas and retires every staged layer', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    const base = { style: { opacity: '0' }, getAnimations: () => [] }
    const stage = {
      getAnimations: () => [],
      remove: () => calls.push('remove')
    }
    const gpu = {
      renderBitmaps: () => calls.push('render'),
      releaseCanvas: () => calls.push('release')
    }
    const bitmap = { close: () => calls.push('close') }
    Object.assign(renderer, {
      _canvas: base,
      _gpuRenderer: gpu,
      _rendererType: 'webgpu',
      _ctx: null,
      _activatePresentation: () => true,
      _preparedFrames: new Map(),
      _stagedCanvases: new Set([stage]),
      _stageFrameIndices: new Map([[stage, 3]]),
      _stageDisplayTimes: new Map([[stage, 100]])
    })

    renderer._presentPreparedFrame({ width: 1920, height: 1080, bitmap }, 12, 100)

    expect(calls).toEqual(['render', 'release', 'remove', 'close'])
    expect(base.style.opacity).toBe('1')
    expect(renderer._stagedCanvases.size).toBe(0)
  })

  test('does not rerasterize a compositor-scheduled exact snapshot in its RVFC', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    Object.assign(renderer, {
      _activatePresentation: (presentationId: number) => {
        calls.push(`activate:${presentationId}`)
        return true
      },
      _ctx: {
        clearRect: () => calls.push('clear'),
        drawImage: () => calls.push('draw')
      }
    })

    renderer._presentPreparedFrame(
      {
        width: 1920,
        height: 1080,
        stage: { getAnimations: () => [] },
        scheduled: true
      },
      14,
      performance.now() + 10
    )

    expect(calls).toEqual(['activate:14'])
  })

  test('does not remove an already scheduled stage from a stale RVFC', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    const stage = {
      getAnimations: () => [{ cancel: () => calls.push('cancel') }],
      remove: () => calls.push('remove')
    }
    Object.assign(renderer, {
      _activatePresentation: () => false,
      _stagedCanvases: new Set([stage]),
      _stageFrameIndices: new Map([[stage, 12]]),
      _stageDisplayTimes: new Map([[stage, performance.now()]])
    })

    renderer._presentPreparedFrame({ width: 1920, height: 1080, stage, scheduled: true }, 13, performance.now())

    expect(calls).toEqual([])
    expect(renderer._stagedCanvases.has(stage)).toBe(true)
  })

  test('starts both compositor swap halves at one absolute timeline instant', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const animations: Array<{
      startTime: number | null
      finished: Promise<void>
      cancel: () => void
    }> = []
    const animationOptions: KeyframeAnimationOptions[] = []
    const createAnimation = (_frames: Keyframe[], options: KeyframeAnimationOptions) => {
      animationOptions.push(options)
      const animation = {
        startTime: null,
        finished: new Promise<void>(() => {}),
        cancel: () => {}
      }
      animations.push(animation)
      return animation
    }
    const stage = {
      animate: createAnimation,
      isConnected: true,
      style: { opacity: '0' }
    }
    const previous = {
      animate: createAnimation,
      style: { opacity: '1' }
    }
    const originalDocument = globalThis.document

    try {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { timeline: { currentTime: 500 } }
      })
      Object.assign(renderer, {
        _canvas: previous,
        _stagedCanvases: new Set([stage]),
        _stageFrameIndices: new Map([[stage, 12]]),
        _stageDisplayTimes: new Map(),
        _destroyed: false
      })

      const frame = { stage }
      renderer._schedulePreparedFrame(frame, performance.now() + 100)

      expect(frame.scheduled).toBe(true)
      expect(animations).toHaveLength(2)
      expect(animations[0].startTime).toBe(animations[1].startTime)
      expect(animationOptions.map((options) => options.delay)).toEqual([0, 0])
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document')
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument
        })
      }
    }
  })

  test('retires every older layer when an intermediate prefetched stage is canceled', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    let finishShow!: () => void

    const makeLayer = (name: string) => {
      const animations: any[] = []
      return {
        style: { opacity: name === 'next' ? '0' : '1' },
        animate: () => {
          const animation = {
            startTime: null,
            finished:
              name === 'next'
                ? new Promise<void>((resolve) => {
                    finishShow = resolve
                  })
                : new Promise<void>(() => {}),
            cancel: () => calls.push(`cancel:${name}`)
          }
          animations.push(animation)
          return animation
        },
        getAnimations: () => animations,
        remove: () => calls.push(`remove:${name}`)
      }
    }

    const base = makeLayer('base')
    const oldest = makeLayer('oldest')
    const intermediate = makeLayer('intermediate')
    const lateOlder = makeLayer('late-older')
    const next = makeLayer('next')
    const now = performance.now()
    const frame = { stage: next }
    const originalDocument = globalThis.document

    try {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { timeline: { currentTime: 500 } }
      })
      Object.assign(renderer, {
        _canvas: base,
        _stagedCanvases: new Set([oldest, intermediate, next]),
        _stageFrameIndices: new Map([
          [oldest, 10],
          [intermediate, 11],
          [next, 12]
        ]),
        _stageDisplayTimes: new Map(),
        _destroyed: false
      })

      renderer._schedulePreparedFrame(frame, now + 100)
      renderer._disposePreparedFrame({ stage: intermediate })
      renderer._stagedCanvases.add(lateOlder)
      renderer._stageFrameIndices.set(lateOlder, 9)
      renderer._stageDisplayTimes.set(lateOlder, now + 5)
      finishShow()
      await Promise.resolve()
      await Promise.resolve()

      expect(calls).toContain('remove:oldest')
      expect(calls).toContain('remove:late-older')
      expect(renderer._stagedCanvases).toEqual(new Set([next]))
      expect(renderer._stageFrameIndices.has(oldest)).toBe(false)
      expect(renderer._stageDisplayTimes.has(oldest)).toBe(false)
      expect(next.style.opacity).toBe('1')
      expect(base.style.opacity).toBe('0')
      expect(frame.animations).toBeUndefined()
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document')
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument
        })
      }
    }
  })

  test('releases sibling hide animations when a scheduled show is canceled', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const canceled: string[] = []
    let rejectShow!: (reason: Error) => void
    const animation = (name: string, finished: Promise<void>) => ({
      startTime: null,
      finished,
      cancel: () => canceled.push(name)
    })
    const stage = {
      animate: () =>
        animation(
          'show',
          new Promise<void>((_resolve, reject) => {
            rejectShow = reject
          })
        ),
      style: { opacity: '0' }
    }
    const previous = {
      animate: () => animation('previous-hide', new Promise<void>(() => {})),
      getAnimations: () => [],
      style: { opacity: '1' }
    }
    const base = {
      animate: () => animation('base-hide', new Promise<void>(() => {})),
      style: { opacity: '1' }
    }
    const frame = { stage }
    const originalDocument = globalThis.document

    try {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { timeline: { currentTime: 500 } }
      })
      Object.assign(renderer, {
        _canvas: base,
        _stagedCanvases: new Set([previous, stage]),
        _stageFrameIndices: new Map([
          [previous, 10],
          [stage, 11]
        ]),
        _stageDisplayTimes: new Map(),
        _destroyed: false
      })

      renderer._schedulePreparedFrame(frame, performance.now() + 100)
      rejectShow(new Error('superseded'))
      await Promise.resolve()
      await Promise.resolve()

      expect(canceled.sort()).toEqual(['base-hide', 'previous-hide', 'show'])
      expect(frame.animations).toBeUndefined()
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document')
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument
        })
      }
    }
  })

  test('does not replay stale video canvas dimensions after worker initialization', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const messages: string[] = []
    Object.assign(renderer, {
      _workerReady: false,
      _loaded: Promise.resolve(),
      _video: {},
      _postWorkerMessage: (target: string) => messages.push(target)
    })

    await renderer.sendMessage('canvas', { width: 0, height: 0 })
    await renderer.sendMessage('video', { currentTime: 0 })
    await renderer.sendMessage('setAsyncRender', { value: false })

    expect(messages).toEqual(['setAsyncRender'])
  })

  test('does not invalidate an in-flight paint for an RVFC that is only queued', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const demands: Array<{ presentationId: number }> = []
    const workerMessages: Array<{ target: string; presentationId: number }> = []

    Object.assign(renderer, {
      _destroyed: false,
      _nextPresentationId: 1,
      _latestPresentationId: 0,
      _workerReady: true,
      _frameTimeline: new Float64Array([0, 1, 2]),
      _video: { paused: false, ended: false, currentTime: 1, playbackRate: 1 },
      _playstate: false,
      framePrefetch: 0,
      _requestDemandRender: (demand: { presentationId: number }) => demands.push(demand),
      _dispatchNextPreparation: () => {},
      _scheduleRVFC: () => {},
      _postWorkerMessage: (target: string, data: { presentationId: number }) =>
        workerMessages.push({ target, presentationId: data.presentationId })
    })

    renderer._handleRVFC(100, {
      mediaTime: 4.5,
      expectedDisplayTime: 100,
      presentationTime: 100,
      width: 1920,
      height: 1080
    })

    expect(demands).toHaveLength(1)
    expect(demands[0].presentationId).toBe(1)
    expect(renderer._latestPresentationId).toBe(0)
    expect(workerMessages).toEqual([])

    renderer._activatePresentation(demands[0].presentationId)
    expect(renderer._latestPresentationId).toBe(1)
    expect(workerMessages).toEqual([{ target: 'presentation', presentationId: 1 }])
  })
})
