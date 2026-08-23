import { describe, expect, test } from 'bun:test'
import AkariSub from '../src/ts/akarisub'
import {
  classifyPerformanceWarnings,
  diffActiveCues,
  isCueActiveAt,
  parsePreloadTrackSource,
  SLOW_FRAME_MS,
  toLibassTimestampMs
} from '../src/ts/cue-events'
import { parseStreamingTrackOptions } from '../src/ts/streaming'
import type { CueEvent } from '../src/ts/types'

const cue = (index: number, start = 1, duration = 2): CueEvent => ({
  index,
  start,
  duration,
  style: 'Default',
  name: 'Char',
  text: `line ${index}`,
  layer: 0
})

describe('libass cue timestamps', () => {
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

  test('activatePreloadedTrack bumps the render epoch and keeps the last frame until the new track paints', async () => {
    const renderer = Object.create(AkariSub.prototype) as AkariSub & {
      _destroyed: boolean
      _workerReady: boolean
      _loaded: Promise<void>
      _destroyedSignal: Promise<void>
      _nextTrackRequestId: number
      _preloadedTrackId: number | null
      _ctx: { filter: string } | null
      _bumpRenderEpoch: () => void
      _reAttachOffscreen: () => void
      _syncVideoClock: () => void
      _fetchFromWorker: (message: Record<string, unknown>) => Promise<Record<string, unknown>>
    }
    const calls: string[] = []

    Object.assign(renderer, {
      _destroyed: false,
      _workerReady: true,
      _loaded: Promise.resolve(),
      _destroyedSignal: new Promise<void>(() => {}),
      _nextTrackRequestId: 3,
      _preloadedTrackId: 4,
      _ctx: { filter: 'url("#f")' },
      _bumpRenderEpoch: () => calls.push('bump'),
      _reAttachOffscreen: () => calls.push('reattach'),
      _syncVideoClock: () => calls.push('sync'),
      _fetchFromWorker: async (message: Record<string, unknown>) => {
        calls.push(`activate:${String(message.id)}`)
        return { success: true, id: message.id }
      }
    })

    await expect(renderer.activatePreloadedTrack()).resolves.toEqual({ id: 4 })
    expect(calls).toEqual(['bump', 'activate:4', 'reattach', 'sync'])
    expect(renderer._preloadedTrackId).toBe(null)
    expect(renderer._ctx?.filter).toBe('none')
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

  test('fires onRendererChange only when the compositor actually changes', () => {
    const changes: Array<{ previous: string; rendererType: string }> = []
    const renderer = Object.create(AkariSub.prototype) as AkariSub & {
      _destroyed: boolean
      _rendererType: string
      _onRendererChange: (event: { previous: string; rendererType: string }) => void
      _setRendererType: (next: string) => void
    }

    Object.assign(renderer, {
      _destroyed: false,
      _rendererType: 'canvas2d',
      _onRendererChange: (event: { previous: string; rendererType: string }) => changes.push(event),
      dispatchEvent: () => true
    })

    renderer._setRendererType('canvas2d')
    renderer._setRendererType('webgpu')
    renderer._setRendererType('webgpu')

    expect(changes).toEqual([{ rendererType: 'webgpu', previous: 'canvas2d' }])
  })
})
