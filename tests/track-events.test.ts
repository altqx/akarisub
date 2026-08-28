import { describe, expect, test } from 'bun:test'
import AkariSub from '../src/ts/akarisub'
import {
  classifyPerformanceWarnings,
  diffActiveCues,
  isCueActiveAt,
  parsePreloadTrackSource,
  resolveCueTracking,
  SLOW_FRAME_MS,
  toLibassTimestampMs
} from '../src/ts/cue-events'
import { parseStreamingTrackOptions } from '../src/ts/streaming'
import type { CueEvent } from '../src/ts/types'
import { WebGPURenderer } from '../src/ts/webgpu-renderer'
import { WebGL2Renderer } from '../src/ts/webgl2-renderer'

const cue = (index: number, start = 1, duration = 2): CueEvent => ({
  index,
  start,
  duration,
  style: 'Default',
  name: 'Char',
  text: `line ${index}`,
  layer: 0
})

const installEventTargetMock = (renderer: any) => {
  const listeners = new Map<string, Set<(event: any) => void>>()
  renderer.addEventListener = (type: string, listener: (event: any) => void) => {
    let handlers = listeners.get(type)
    if (!handlers) listeners.set(type, (handlers = new Set()))
    handlers.add(listener)
  }
  renderer.removeEventListener = (type: string, listener: (event: any) => void) => {
    listeners.get(type)?.delete(listener)
  }
  renderer.dispatchEvent = (event: any) => {
    for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event)
    return true
  }

  return {
    dispatch(type: string, event: Record<string, unknown> = {}) {
      renderer.dispatchEvent({ type, ...event })
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0
    }
  }
}

describe('libass cue timestamps', () => {
  test('keeps cue tracking enabled unless explicitly disabled', () => {
    expect(resolveCueTracking(undefined)).toBe(true)
    expect(resolveCueTracking(true)).toBe(true)
    expect(resolveCueTracking(false)).toBe(false)
  })

  test('floors fractional milliseconds and snaps exact millisecond round-off', () => {
    expect(toLibassTimestampMs(1.001)).toBe(1001)
    expect(toLibassTimestampMs(1.0016)).toBe(1001)
    expect(toLibassTimestampMs(0)).toBe(0)
  })

  test('uses libass Start <= now < Start + Duration boundaries', () => {
    expect(isCueActiveAt(1000, 500, 1000)).toBe(true)
    expect(isCueActiveAt(1000, 500, 1499)).toBe(true)
    expect(isCueActiveAt(1000, 500, 1500)).toBe(false)
    expect(isCueActiveAt(1000, 500, 999)).toBe(false)
  })
})

describe('cue enter/exit diff', () => {
  test('reports only newly active and newly inactive cues', () => {
    const previous = new Map<number, CueEvent>([
      [0, cue(0)],
      [1, cue(1)]
    ])
    const next = new Map<number, CueEvent>([
      [1, cue(1)],
      [2, cue(2)]
    ])

    expect(diffActiveCues(previous, next)).toEqual({
      entered: [cue(2)],
      exited: [cue(0)]
    })
  })

  test('is silent when the active set is unchanged', () => {
    const active = new Map<number, CueEvent>([[4, cue(4)]])
    expect(diffActiveCues(active, new Map(active))).toEqual({ entered: [], exited: [] })
  })
})

describe('performance warnings', () => {
  test('classifies slow frames, drops, and a full demand queue', () => {
    expect(classifyPerformanceWarnings({ renderTimeMs: SLOW_FRAME_MS })).toEqual([])
    expect(classifyPerformanceWarnings({ renderTimeMs: SLOW_FRAME_MS + 0.5 })).toEqual([
      { kind: 'slow-frame', renderTimeMs: SLOW_FRAME_MS + 0.5 }
    ])
    expect(classifyPerformanceWarnings({ droppedDelta: 2 })).toEqual([{ kind: 'dropped-frames', droppedFrames: 2 }])
    expect(classifyPerformanceWarnings({ pendingRenders: 3, maxPendingRenders: 3 })).toEqual([
      { kind: 'queue-backlog', pendingRenders: 3 }
    ])
  })
})

describe('preload track source parsing', () => {
  test('accepts raw ASS text as content and tagged sources', () => {
    expect(parsePreloadTrackSource('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,hi')).toEqual({
      kind: 'content',
      content: 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,hi'
    })
    expect(parsePreloadTrackSource({ kind: 'url', url: '/subs/ja.ass' })).toEqual({
      kind: 'url',
      url: '/subs/ja.ass'
    })
  })

  test('rejects empty or contradictory sources', () => {
    expect(() => parsePreloadTrackSource({ kind: 'url', url: '' })).toThrow('Invalid preload track source')
    expect(() => parsePreloadTrackSource({ kind: 'content' })).toThrow('Invalid preload track source')
    expect(() => parsePreloadTrackSource(null)).toThrow('Invalid preload track source')
  })
})

describe('streaming track options', () => {
  test('treats raw ASS text as an ASS header', () => {
    expect(parseStreamingTrackOptions('[Script Info]\nTitle: live')).toEqual({
      header: '[Script Info]\nTitle: live',
      format: 'ass'
    })
  })

  test('accepts Matroska CodecPrivate and a prune window', () => {
    expect(
      parseStreamingTrackOptions({
        header: 'codec-private',
        format: 'matroska',
        pruneDelay: 15,
        checkReadOrder: false
      })
    ).toEqual({
      header: 'codec-private',
      format: 'matroska',
      pruneDelay: 15,
      checkReadOrder: false
    })
  })
})

describe('AkariSub track swap and callbacks', () => {
  test('preloadTrack waits for the worker handle before swapping', async () => {
    const renderer = Object.create(AkariSub.prototype) as AkariSub & {
      _destroyed: boolean
      _workerReady: boolean
      _loaded: Promise<void>
      _destroyedSignal: Promise<void>
      _nextTrackRequestId: number
      _preloadedTrackId: number | null
      _fetchFromWorker: (message: Record<string, unknown>) => Promise<Record<string, unknown>>
    }
    const posted: Record<string, unknown>[] = []

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _nextTrackRequestId: 1,
      _preloadedTrackId: null,
      _fetchFromWorker: async (message: Record<string, unknown>) => {
        posted.push(message)
        return { success: true, id: 7 }
      }
    })

    await expect(renderer.preloadTrack({ kind: 'url', url: '/subs/en.ass' })).resolves.toEqual({ id: 7 })
    expect(renderer._preloadedTrackId).toBe(7)
    expect(posted[0]?.target).toBe('preloadTrack')
    expect(posted[0]?.source).toEqual({ kind: 'url', url: '/subs/en.ass' })
  })

  test('activatePreloadedTrack waits for its tagged readiness after the worker response', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    const events = installEventTargetMock(renderer)
    let resolveResponse!: (response: Record<string, unknown>) => void
    const response = new Promise<Record<string, unknown>>((resolve) => {
      resolveResponse = resolve
    })

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _pendingWorkerRejectors: new Set(),
      _pendingTrackReadyWaiters: new Map(),
      _nextTrackRequestId: 3,
      _preloadedTrackId: 4,
      _ctx: { filter: 'url("#f")' },
      _bumpRenderEpoch: () => calls.push('bump'),
      _reAttachOffscreen: () => calls.push('reattach'),
      _syncVideoClock: () => calls.push('sync'),
      _fetchFromWorker: async (message: Record<string, unknown>) => {
        calls.push(`activate:${String(message.id)}`)
        renderer._trackReady({ requestId: message.requestId })
        return response
      }
    })

    let settled = false
    const activation = renderer.activatePreloadedTrack().then((value: unknown) => {
      settled = true
      return value
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(calls).toEqual(['bump', 'activate:4', 'sync'])

    resolveResponse({ success: true, id: 4 })
    await expect(activation).resolves.toEqual({ id: 4 })
    expect(calls).toEqual(['bump', 'activate:4', 'sync', 'reattach'])
    expect(renderer._preloadedTrackId).toBe(null)
    expect(renderer._ctx?.filter).toBe('none')
    expect(events.count('trackReady')).toBe(0)
    expect(renderer._pendingWorkerRejectors.size).toBe(0)
    expect(renderer._pendingTrackReadyWaiters.size).toBe(0)
  })

  test('activatePreloadedTrack resynchronizes only when offscreen reattachment replaces the canvas', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    installEventTargetMock(renderer)

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _pendingWorkerRejectors: new Set(),
      _pendingTrackReadyWaiters: new Map(),
      _nextTrackRequestId: 5,
      _preloadedTrackId: 6,
      _offscreenRender: true,
      _ctx: { filter: 'url("#f")' },
      _onDemandRender: false,
      _bumpRenderEpoch: () => calls.push('bump'),
      _reAttachOffscreen: () => {
        calls.push('reattach')
        renderer._ctx = false
      },
      _syncVideoClock: () => calls.push('sync'),
      _fetchFromWorker: async (message: Record<string, unknown>) => {
        calls.push(`activate:${String(message.id)}`)
        renderer._trackReady({ requestId: message.requestId })
        return { success: true, id: message.id }
      }
    })

    await expect(renderer.activatePreloadedTrack()).resolves.toEqual({ id: 6 })
    expect(calls).toEqual(['bump', 'activate:6', 'sync', 'reattach', 'sync'])
    expect(renderer._pendingWorkerRejectors.size).toBe(0)
    expect(renderer._pendingTrackReadyWaiters.size).toBe(0)
  })

  test('activatePreloadedTrack preserves color conversion verified before the worker response', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const calls: string[] = []
    installEventTargetMock(renderer)

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _pendingWorkerRejectors: new Set(),
      _pendingTrackReadyWaiters: new Map(),
      _nextTrackRequestId: 7,
      _preloadedTrackId: 8,
      _offscreenRender: true,
      _ctx: false,
      _gpuRenderer: null,
      _lastSubtitleColorSpace: null,
      _videoColorSpace: 'BT601',
      _videoColorProfile: { matrix: 'BT601' },
      _onDemandRender: false,
      _bumpRenderEpoch: () => calls.push('bump'),
      _applyGpuColorManagement: () => calls.push('color'),
      _detachOffscreen: () => {
        calls.push('detach')
        renderer._ctx = { filter: 'none' }
      },
      _reAttachOffscreen: () => calls.push('reattach'),
      _syncVideoClock: () => calls.push('sync'),
      _fetchFromWorker: async (message: Record<string, unknown>) => {
        renderer._verifyColorSpace({ subtitleColorSpace: 'BT709', videoColorSpace: 'BT601' })
        renderer._trackReady({ requestId: message.requestId })
        return { success: true, id: message.id }
      }
    })

    await expect(renderer.activatePreloadedTrack()).resolves.toEqual({ id: 8 })
    expect(calls).toEqual(['bump', 'color', 'detach', 'sync'])
    expect(renderer._ctx).toBeTruthy()
    expect(renderer._ctx.filter).not.toBe('none')
    expect(renderer._lastSubtitleColorSpace).toBe('BT709')
  })

  test('a later track change rejects a paused exact activation instead of stranding its runway wait', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const events = installEventTargetMock(renderer)

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _pendingWorkerRejectors: new Set(),
      _pendingTrackReadyWaiters: new Map(),
      _frameBufferReadyEvent: null,
      _nextTrackRequestId: 30,
      _preloadedTrackId: 31,
      _ctx: null,
      _onDemandRender: true,
      _frameTimeline: new Float64Array([0, 0.04, 0.08]),
      framePrefetch: 2,
      _bumpRenderEpoch: () => {},
      _reAttachOffscreen: () => {},
      _syncVideoClock: () => {},
      _currentExactFrameMediaTime: () => 0,
      _primePreparedFrames: () => {},
      _dispatchNextPreparation: () => {},
      _fetchFromWorker: async (message: Record<string, unknown>) => {
        renderer._trackReady({ requestId: message.requestId })
        return { success: true, id: message.id }
      }
    })

    const activation = renderer.activatePreloadedTrack()
    await Promise.resolve()
    await Promise.resolve()

    expect(renderer._frameBufferReadyEvent).toEqual({ type: 'trackReady', requestId: 30 })
    expect(renderer._pendingTrackReadyWaiters.size).toBe(1)

    renderer._trackReady()

    await expect(activation).rejects.toThrow('superseded by a newer track change')
    expect(renderer._frameBufferReadyEvent).toEqual({ type: 'trackReady', requestId: undefined })
    expect(events.count('trackReady')).toBe(0)
    expect(events.count('error')).toBe(0)
    expect(renderer._pendingWorkerRejectors.size).toBe(0)
    expect(renderer._pendingTrackReadyWaiters.size).toBe(0)
  })

  test('freeTrack immediately supersedes a paused exact activation runway', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const events = installEventTargetMock(renderer)
    const posted: string[] = []
    let resolveActivation: (() => void) | undefined

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _pendingWorkerRejectors: new Set(),
      _pendingTrackReadyWaiters: new Map(),
      _frameBufferReadyEvent: null,
      _nextTrackRequestId: 40,
      _preloadedTrackId: 41,
      _ctx: null,
      _onDemandRender: true,
      _frameTimeline: new Float64Array([0, 0.04, 0.08]),
      framePrefetch: 2,
      _bumpRenderEpoch: () => {},
      _reAttachOffscreen: () => {},
      _syncVideoClock: () => {},
      _currentExactFrameMediaTime: () => 0,
      _primePreparedFrames: () => {},
      _dispatchNextPreparation: () => {},
      sendMessage: async (target: string) => {
        posted.push(target)
      },
      _fetchFromWorker: (message: Record<string, unknown>) =>
        new Promise((resolve) => {
          resolveActivation = () => resolve({ success: true, id: message.id })
        })
    })

    const activation = renderer.activatePreloadedTrack()
    expect(renderer._frameBufferReadyEvent).toBe(null)
    expect(renderer._pendingTrackReadyWaiters.size).toBe(1)
    renderer.freeTrack()
    expect(renderer._pendingTrackReadyWaiters.size).toBe(0)
    resolveActivation?.()

    await expect(activation).rejects.toThrow('superseded by a newer track change')
    expect(posted).toEqual(['freeTrack'])
    expect(renderer._frameBufferReadyEvent).toBe(null)
    expect(events.count('trackReady')).toBe(0)
    expect(events.count('error')).toBe(0)
    expect(renderer._pendingWorkerRejectors.size).toBe(0)
    expect(renderer._pendingTrackReadyWaiters.size).toBe(0)
  })

  test('activatePreloadedTrack ignores stale readiness and rejects cleanly on renderer error', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const events = installEventTargetMock(renderer)
    let requestId = -1

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _pendingWorkerRejectors: new Set(),
      _pendingTrackReadyWaiters: new Map(),
      _nextTrackRequestId: 8,
      _preloadedTrackId: 12,
      _ctx: null,
      _bumpRenderEpoch: () => {},
      _reAttachOffscreen: () => {},
      _syncVideoClock: () => {},
      _fetchFromWorker: async (message: Record<string, unknown>) => {
        requestId = Number(message.requestId)
        return { success: true, id: message.id }
      }
    })

    let settled = false
    const activation = renderer.activatePreloadedTrack().finally(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()

    events.dispatch('trackReady', { detail: { requestId: requestId - 1 } })
    await Promise.resolve()
    expect(settled).toBe(false)

    const originalError = new Error('render pipeline failed')
    events.dispatch('error', { error: originalError, message: originalError.message })
    await expect(activation).rejects.toBe(originalError)
    expect(events.count('trackReady')).toBe(0)
    expect(events.count('error')).toBe(0)
    expect(renderer._pendingWorkerRejectors.size).toBe(0)
  })

  test('activatePreloadedTrack cleans its readiness waiter when activation is rejected', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const events = installEventTargetMock(renderer)

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _pendingWorkerRejectors: new Set(),
      _pendingTrackReadyWaiters: new Map(),
      _nextTrackRequestId: 14,
      _preloadedTrackId: 20,
      _bumpRenderEpoch: () => {},
      _fetchFromWorker: async () => ({ success: false, error: 'activation rejected' })
    })

    await expect(renderer.activatePreloadedTrack()).rejects.toThrow('activation rejected')
    expect(events.count('trackReady')).toBe(0)
    expect(events.count('error')).toBe(0)
    expect(renderer._pendingWorkerRejectors.size).toBe(0)
  })

  test('activatePreloadedTrack rejects and cleans readiness when the renderer is destroyed', async () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const events = installEventTargetMock(renderer)

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _pendingWorkerRejectors: new Set<(error: Error) => void>(),
      _pendingTrackReadyWaiters: new Map(),
      _nextTrackRequestId: 21,
      _preloadedTrackId: 22,
      _ctx: null,
      _bumpRenderEpoch: () => {},
      _reAttachOffscreen: () => {},
      _syncVideoClock: () => {},
      _fetchFromWorker: async (message: Record<string, unknown>) => ({ success: true, id: message.id })
    })

    const activation = renderer.activatePreloadedTrack()
    await Promise.resolve()
    await Promise.resolve()

    const destroyedError = new Error('renderer destroyed')
    for (const rejectPending of [...renderer._pendingWorkerRejectors]) rejectPending(destroyedError)
    await expect(activation).rejects.toBe(destroyedError)
    expect(events.count('trackReady')).toBe(0)
    expect(events.count('error')).toBe(0)
    expect(renderer._pendingWorkerRejectors.size).toBe(0)
  })

  test('initStreamingTrack posts a parsed header without replacing via setTrack', () => {
    const posted: Array<{ target: string; options?: unknown }> = []
    const renderer = Object.create(AkariSub.prototype) as AkariSub & {
      _bumpRenderEpoch: () => void
      _reAttachOffscreen: () => void
      _ctx: { filter: string } | null
      sendMessage: (target: string, data?: Record<string, unknown>) => Promise<void>
    }

    Object.assign(renderer, {
      _ctx: { filter: 'url("#f")' },
      _bumpRenderEpoch: () => {},
      _reAttachOffscreen: () => {},
      sendMessage: async (target: string, data?: Record<string, unknown>) => {
        posted.push({ target, options: data?.options })
      }
    })

    renderer.initStreamingTrack({ header: '[Script Info]', format: 'ass', pruneDelay: 20 })
    expect(posted).toEqual([
      {
        target: 'initStreamingTrack',
        options: { header: '[Script Info]', format: 'ass', pruneDelay: 20 }
      }
    ])
    expect(renderer._ctx?.filter).toBe('none')
  })

  test('dispatches cue, render, and performance callbacks without getEvents polling', () => {
    const entered: CueEvent[] = []
    const exited: CueEvent[] = []
    const renders: Array<{ time: number; cached: boolean }> = []
    const warnings: Array<{ kind: string }> = []
    const renderer = Object.create(AkariSub.prototype) as AkariSub & {
      _rendererType: string
      _pendingDemandTimes: unknown[]
      _onCueEnter: (cue: CueEvent) => void
      _onCueExit: (cue: CueEvent) => void
      _onRender: (event: { time: number; cached: boolean }) => void
      _onPerformanceWarning: (warning: { kind: string }) => void
      _cues: (data: { time: number; entered: CueEvent[]; exited: CueEvent[] }) => void
      _renderInfo: (data: {
        time: number
        cached: boolean
        renderTimeMs: number
        imageCount: number
        framesDropped: number
        pendingRenders: number
      }) => void
    }

    Object.assign(renderer, {
      _rendererType: 'canvas2d',
      _pendingDemandTimes: [],
      _onCueEnter: (cue: CueEvent) => entered.push(cue),
      _onCueExit: (cue: CueEvent) => exited.push(cue),
      _onRender: (event: { time: number; cached: boolean }) => renders.push(event),
      _onPerformanceWarning: (warning: { kind: string }) => warnings.push(warning),
      dispatchEvent: () => true
    })

    renderer._cues({ time: 12, exited: [cue(1)], entered: [cue(2)] })
    renderer._renderInfo({
      time: 12,
      cached: false,
      renderTimeMs: 24,
      imageCount: 2,
      framesDropped: 1,
      pendingRenders: 0
    })

    expect(exited.map((item) => item.index)).toEqual([1])
    expect(entered.map((item) => item.index)).toEqual([2])
    expect(renders).toEqual([{ time: 12, cached: false, imageCount: 2, renderTimeMs: 24, rendererType: 'canvas2d' }])
    expect(warnings.map((item) => item.kind)).toEqual(['slow-frame', 'dropped-frames'])
  })

  test('reports an opaque worker event as a useful error', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const events: ErrorEvent[] = []
    const originalError = console.error
    Object.assign(renderer, {
      dispatchEvent: (event: ErrorEvent) => {
        events.push(event)
        return true
      }
    })

    try {
      console.error = () => undefined
      const error = renderer._error(new Event('error'))
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Worker error')
      expect(events[0]?.error).toBe(error)
    } finally {
      console.error = originalError
    }
  })

  test('fires onRendererChange for backend changes and same-backend recovery', () => {
    const changes: Array<{ previous: string; rendererType: string; reason?: string }> = []
    const renderer = Object.create(AkariSub.prototype) as AkariSub & {
      _destroyed: boolean
      _rendererType: string
      _onRendererChange: (event: { previous: string; rendererType: string; reason?: string }) => void
      _setRendererType: (next: string, reason?: 'device-lost' | 'context-lost') => void
    }

    Object.assign(renderer, {
      _destroyed: false,
      _rendererType: 'canvas2d',
      _onRendererChange: (event: { previous: string; rendererType: string; reason?: string }) => changes.push(event),
      dispatchEvent: () => true
    })

    renderer._setRendererType('canvas2d')
    renderer._setRendererType('webgpu')
    renderer._setRendererType('webgpu')
    renderer._setRendererType('webgpu', 'device-lost')

    expect(changes).toEqual([
      { rendererType: 'webgpu', previous: 'canvas2d' },
      { rendererType: 'webgpu', previous: 'webgpu', reason: 'device-lost' }
    ])
  })

  test('warns immediately when GPU recovery starts and keeps the last successful snapshot', () => {
    const warnings: unknown[] = []
    const gpu = new WebGPURenderer()
    const renderer = Object.create(AkariSub.prototype) as any
    const retained = { canvas: { id: 'retained' }, sequence: 1, colorManaged: false }
    const rejected = { canvas: { id: 'rejected' }, sequence: 2, colorManaged: false }
    const recovered = { canvas: { id: 'recovered' }, sequence: 3, colorManaged: false }
    Object.assign(renderer, {
      _destroyed: false,
      _gpuRenderer: gpu,
      _gpuRecovering: null,
      _gpuRecoveryGeneration: 0,
      _rendererType: 'webgpu',
      _renderEpoch: 4,
      _pendingDemandTimes: [{}],
      _demandTimings: new Map([[1, {}]]),
      _lastGPUFrame: retained,
      _gpuSnapshotPool: [],
      _onPerformanceWarning: (warning: unknown) => warnings.push(warning),
      _clearPreparedFrames: () => undefined,
      _showGPURecoveryFrame: () => undefined,
      dispatchEvent: () => true
    })

    expect(renderer._beginGPURecovery(gpu, 'device-lost')).toBe(true)
    expect(warnings).toEqual([{ kind: 'renderer-recovery', reason: 'device-lost', rendererType: 'webgpu' }])
    expect(renderer._pendingDemandTimes).toEqual([])
    expect(renderer._demandTimings.size).toBe(0)

    expect(renderer._retainGPUFrameAfter(false, rejected)).toBe(false)
    expect(renderer._lastGPUFrame).toBe(retained)
    expect(renderer._retainGPUFrameAfter(true, recovered)).toBe(true)
    expect(renderer._lastGPUFrame).toBe(recovered)
  })

  test('downgrades to Canvas2D with the loss reason when recovery fails', () => {
    const changes: unknown[] = []
    const gpu = new WebGL2Renderer()
    const renderer = Object.create(AkariSub.prototype) as any
    const originalWarn = console.warn
    Object.assign(renderer, {
      _destroyed: false,
      _gpuRenderer: gpu,
      _gpuRecovering: gpu,
      _gpuRecoveryTimer: null,
      _gpuRecoveryGeneration: 2,
      _rendererType: 'webgl2',
      _prepareForce: false,
      _onRendererChange: (event: unknown) => changes.push(event),
      _adoptGPURecoveryCanvas: () => undefined,
      _syncVideoClock: () => undefined,
      sendMessage: async () => undefined,
      dispatchEvent: () => true
    })

    try {
      console.warn = () => undefined
      renderer._fallbackFromGPU(gpu, 'context-lost', new Error('restore failed'))
    } finally {
      console.warn = originalWarn
    }

    expect(renderer._gpuRenderer).toBeNull()
    expect(renderer._rendererType).toBe('canvas2d')
    expect(renderer._prepareForce).toBe(true)
    expect(changes).toEqual([{ rendererType: 'canvas2d', previous: 'webgl2', reason: 'context-lost' }])
  })
})
