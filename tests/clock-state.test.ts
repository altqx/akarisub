import { describe, expect, test } from 'bun:test'
import AkariSub from '../src/ts/akarisub'

const frame = () => ({ width: 1920, height: 1080, bitmap: { close: () => {} } }) as any

const playingVideo = (overrides: Record<string, unknown> = {}) => ({
  paused: false,
  ended: false,
  seeking: false,
  currentTime: 1,
  playbackRate: 1,
  ...overrides
})

const clockRenderer = (video: any, overrides: Record<string, unknown> = {}) => {
  const renderer = Object.create(AkariSub.prototype) as any
  const clockCalls: Array<{ isPaused: boolean; time: number }> = []
  Object.assign(renderer, {
    _video: video,
    _playstate: false,
    _timeOffset: 0,
    _onDemandRender: false,
    _destroyed: false,
    setCurrentTime: (isPaused: boolean, time: number) => clockCalls.push({ isPaused, time }),
    ...overrides
  })
  return { renderer, clockCalls }
}

describe('video play-state latch', () => {
  test('stalled does not latch the clock as paused', () => {
    const { renderer } = clockRenderer(playingVideo())
    renderer._syncVideoClock({ type: 'stalled' })
    expect(renderer._isVideoPausedForWorker()).toBe(false)
  })

  test('waiting latches until playing clears it', () => {
    const { renderer } = clockRenderer(playingVideo())
    renderer._syncVideoClock({ type: 'waiting' })
    expect(renderer._isVideoPausedForWorker()).toBe(true)
    renderer._syncVideoClock({ type: 'playing' })
    expect(renderer._isVideoPausedForWorker()).toBe(false)
  })
})

describe('RVFC play-state backstop', () => {
  const drive = (video: any, firstTime: number, secondTime: number) => {
    const callbacks: Array<(now: number, metadata: any) => void> = []
    Object.assign(video, {
      requestVideoFrameCallback: (callback: (now: number, metadata: any) => void) => callbacks.push(callback)
    })
    const { renderer, clockCalls } = clockRenderer(video, {
      _onDemandRender: true,
      _rvfcGeneration: 0,
      _lastRvfcMediaTime: null,
      _handleRVFC: () => {}
    })
    renderer._scheduleRVFC(video)
    callbacks.shift()!(0, { mediaTime: firstTime })
    renderer._playstate = true
    renderer._scheduleRVFC(video)
    callbacks.shift()!(16, { mediaTime: secondTime })
    return { renderer, clockCalls }
  }

  test('an advancing frame clears a stale latch and resyncs the worker clock', () => {
    const { renderer, clockCalls } = drive(playingVideo(), 1, 1.04)
    expect(renderer._playstate).toBe(false)
    expect(clockCalls.at(-1)?.isPaused).toBe(false)
  })

  test('seeking or non-advancing frames leave the latch alone', () => {
    const seeking = drive(playingVideo({ seeking: true }), 1, 1.04)
    expect(seeking.renderer._playstate).toBe(true)
    expect(seeking.clockCalls).toHaveLength(0)

    const frozen = drive(playingVideo(), 1, 1)
    expect(frozen.renderer._playstate).toBe(true)
    expect(frozen.clockCalls).toHaveLength(0)
  })
})

describe('timeOffset accessor', () => {
  const initialised = () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const messages: Array<{ target: string; data: any }> = []
    Object.assign(renderer, {
      _timeOffset: 0,
      _destroyed: false,
      _workerReady: true,
      busy: false,
      _frameTimeline: new Float64Array([0, 1, 2, 3]),
      framePrefetch: 2,
      _renderEpoch: 5,
      _nextPrepareId: 1,
      _prepareRequests: new Map(),
      _prepareQueue: [],
      _prepareFailureEpoch: -1,
      _pendingDemandTimes: [],
      _demandTimings: new Map(),
      _predictedDisplayTimes: new Map(),
      _displayClockOffsets: [],
      _postWorkerMessage: (target: string, data: any) => messages.push({ target, data })
    })
    renderer._presentation.store(2, frame())
    renderer._presentation.store(3, frame())
    return { renderer, messages }
  }

  test('assigning a new offset discards prepared frames and re-primes with the offset', () => {
    const { renderer, messages } = initialised()
    expect(renderer._presentation.has(2)).toBe(true)

    renderer.timeOffset = 0.5

    expect(renderer.timeOffset).toBe(0.5)
    expect(renderer._renderEpoch).toBe(6)
    expect(renderer._presentation.has(2)).toBe(false)
    expect(renderer._presentation.has(3)).toBe(false)
    const prepare = messages.find(message => message.target === 'prepare')
    expect(prepare?.data.time).toBeCloseTo(1.5)
    expect(prepare?.data.renderEpoch).toBe(6)
  })

  test('same-value and non-finite assignments are no-ops', () => {
    const { renderer } = initialised()
    renderer.timeOffset = 0
    renderer.timeOffset = Number.NaN
    renderer.timeOffset = Infinity
    expect(renderer._renderEpoch).toBe(5)
    expect(renderer.timeOffset).toBe(0)
    expect(renderer._presentation.has(2)).toBe(true)
  })

  test('half-initialised fixtures can assign timeOffset without flushing', () => {
    const renderer = Object.assign(Object.create(AkariSub.prototype), { timeOffset: 2 }) as any
    expect(renderer.timeOffset).toBe(2)
  })
})
