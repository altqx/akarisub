import { describe, expect, test } from 'bun:test'
import AkariSub from '../src/ts/akarisub'
import {
  VIDEO_FRAME_TIMESTAMP_SECONDS,
  frameTimelineFromTimestamps,
  frameTimelineFromVideoFrames,
  isVideoFrameLike,
  isWebCodecsVideoFrameSupported,
  videoFrameCallbackMetadata,
  videoFrameColorSpace,
  videoFrameMediaTime
} from '../src/ts/video-frame'

const frame = (overrides: Record<string, unknown> = {}) => ({
  timestamp: 41_708,
  displayWidth: 1920,
  displayHeight: 1080,
  colorSpace: { matrix: 'bt709' },
  ...overrides
})

describe('WebCodecs VideoFrame helpers', () => {
  test('converts microsecond timestamps to media seconds', () => {
    expect(VIDEO_FRAME_TIMESTAMP_SECONDS).toBe(1e-6)
    expect(videoFrameMediaTime(1_000_000)).toBe(1)
    expect(videoFrameMediaTime(41_708)).toBeCloseTo(0.041708)
    expect(videoFrameMediaTime(Number.NaN)).toBeNaN()
  })

  test('accepts duck-typed frames and rejects incomplete objects', () => {
    expect(isVideoFrameLike(frame())).toBe(true)
    expect(isVideoFrameLike({ timestamp: 0, displayWidth: 1, displayHeight: 1 })).toBe(true)
    expect(isVideoFrameLike({ timestamp: 0, displayWidth: 1 })).toBe(false)
    expect(isVideoFrameLike(null)).toBe(false)
    expect(isWebCodecsVideoFrameSupported()).toBe(
      typeof (globalThis as { VideoFrame?: unknown }).VideoFrame === 'function'
    )
  })

  test('maps VideoFrame color matrices onto subtitle conversion tables', () => {
    expect(videoFrameColorSpace(frame())).toBe('BT709')
    expect(videoFrameColorSpace(frame({ colorSpace: { matrix: 'bt601' } }))).toBe('BT601')
    expect(videoFrameColorSpace(frame({ colorSpace: { matrix: 'smpte170m' } }))).toBe('BT601')
    expect(videoFrameColorSpace(frame({ colorSpace: { matrix: 'bt2020-ncl' } }))).toBeNull()
    expect(videoFrameColorSpace(frame({ colorSpace: null }))).toBeNull()
  })

  test('builds RVFC metadata from a VideoFrame timestamp', () => {
    const metadata = videoFrameCallbackMetadata(frame(), {
      now: 100,
      expectedDisplayTime: 116,
      presentationTime: 100
    })
    expect(metadata.mediaTime).toBeCloseTo(0.041708)
    expect(metadata.width).toBe(1920)
    expect(metadata.height).toBe(1080)
    expect(metadata.expectedDisplayTime).toBe(116)
    expect(metadata.presentationTime).toBe(100)
    expect(videoFrameCallbackMetadata(frame(), { mediaTime: 1.5, now: 8 }).mediaTime).toBe(1.5)
  })

  test('builds a frame timeline from WebCodecs timestamps', () => {
    const timeline = frameTimelineFromTimestamps([0, 41_708, 83_417, 41_708, -1])
    expect(timeline.length).toBe(3)
    expect(timeline[0]).toBe(0)
    expect(timeline[1]).toBeCloseTo(0.041708)
    expect(timeline[2]).toBeCloseTo(0.083417)

    const seconds = frameTimelineFromTimestamps([0, 0.041708, 0.083417], {
      unit: 'seconds',
      mediaTimeOrigin: 1.4,
      subtitleTimeOffset: 0.041708
    })
    expect([...seconds]).toEqual([0, 0.041708, 0.083417])
    expect(seconds.mediaTimeOrigin).toBe(1.4)
    expect(seconds.subtitleTimeOffset).toBe(0.041708)
  })

  test('builds a frame timeline from decoded frames', () => {
    const timeline = frameTimelineFromVideoFrames([
      frame({ timestamp: 83_417 }),
      frame({ timestamp: 0 }),
      frame({ timestamp: 41_708 })
    ])
    expect(timeline.length).toBe(3)
    expect(timeline[0]).toBe(0)
    expect(timeline[1]).toBeCloseTo(0.041708)
    expect(timeline[2]).toBeCloseTo(0.083417)
  })
})

describe('presentVideoFrame', () => {
  test('drives the RVFC presentation path without an HTMLVideoElement', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const demands: Array<{ mediaTime: number; width: number; height: number; presentationId: number }> = []
    const clock: Array<{ isPaused?: boolean; currentTime?: number; rate?: number; colorSpace: string | null }> = []
    let closed = 0

    Object.assign(renderer, {
      _destroyed: false,
      _onDemandRender: true,
      _video: undefined,
      _videoFrameClock: null,
      _videoColorSpace: null,
      _playstate: true,
      timeOffset: 0,
      renderAhead: 0,
      _nextPresentationId: 1,
      _latestPresentationId: 0,
      _frameTimeline: new Float64Array([0, 0.041708, 0.083417]),
      framePrefetch: 0,
      _requestDemandRender: (demand: { mediaTime: number; width: number; height: number; presentationId: number }) =>
        demands.push(demand),
      _dispatchNextPreparation: () => {},
      _scheduleRVFC: () => {},
      sendMessage: (
        target: string,
        data: { isPaused?: boolean; currentTime?: number; rate?: number; colorSpace: string | null }
      ) => {
        if (target === 'video') clock.push(data)
      }
    })

    const presented = frame({
      close() {
        closed++
      }
    })
    renderer.presentVideoFrame(presented, {
      now: 100,
      expectedDisplayTime: 116,
      isPaused: false,
      rate: 1
    })

    expect(closed).toBe(0)
    expect(renderer._videoFrameClock.paused).toBe(false)
    expect(renderer._videoFrameClock.rate).toBe(1)
    expect(renderer._videoFrameClock.width).toBe(1920)
    expect(renderer._videoFrameClock.height).toBe(1080)
    expect(renderer._videoFrameClock.currentTime).toBeCloseTo(0.041708)
    expect(renderer._videoColorSpace).toBe('BT709')
    expect(clock[0]).toMatchObject({
      isPaused: false,
      rate: 1,
      colorSpace: 'BT709'
    })
    expect(clock[0].currentTime).toBeCloseTo(0.041708)
    expect(demands).toHaveLength(1)
    expect(demands[0].mediaTime).toBeCloseTo(0.041708)
    expect(demands[0].width).toBe(1920)
    expect(demands[0].height).toBe(1080)
    expect(demands[0].presentationId).toBe(1)
    expect(renderer._currentExactFrameIndex()).toBe(1)
  })

  test('samples the exact timestamp when the decoder clock is paused', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const demands: Array<{ mediaTime: number; expectedDisplayTime?: number }> = []

    Object.assign(renderer, {
      _destroyed: false,
      _onDemandRender: true,
      _video: undefined,
      _videoFrameClock: null,
      _videoColorSpace: null,
      _playstate: true,
      timeOffset: 0,
      renderAhead: 0,
      _nextPresentationId: 1,
      _latestPresentationId: 0,
      _frameTimeline: null,
      framePrefetch: 0,
      _requestDemandRender: (demand: { mediaTime: number; expectedDisplayTime?: number }) => demands.push(demand),
      _dispatchNextPreparation: () => {},
      _scheduleRVFC: () => {},
      sendMessage: () => {}
    })

    renderer.presentVideoFrame(frame({ timestamp: 1_500_000 }), {
      now: 50,
      expectedDisplayTime: 66,
      isPaused: true
    })

    expect(renderer._isVideoPausedForWorker()).toBe(true)
    expect(demands).toHaveLength(1)
    expect(demands[0].mediaTime).toBe(1.5)
    expect(demands[0].expectedDisplayTime).toBeUndefined()
  })

  test('keeps the worker RAF clock when on-demand rendering is disabled', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const messages: string[] = []
    let handled = 0

    Object.assign(renderer, {
      _destroyed: false,
      _onDemandRender: false,
      _video: undefined,
      _videoFrameClock: null,
      _videoColorSpace: null,
      _playstate: true,
      timeOffset: 2,
      renderAhead: 0,
      sendMessage: (target: string) => {
        messages.push(target)
      },
      _handleRVFC: () => {
        handled++
      }
    })

    renderer.presentVideoFrame(frame({ timestamp: 1_000_000 }), { isPaused: false, rate: 1.25 })

    expect(handled).toBe(0)
    expect(messages).toEqual(['getColorSpace', 'video'])
    expect(renderer._videoFrameClock.currentTime).toBe(1)
    expect(renderer._videoFrameClock.rate).toBe(1.25)
    expect(renderer._currentVideoTimeWithOffset()).toBe(3)
  })

  test('rejects incomplete frames', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const errors: Error[] = []

    Object.assign(renderer, {
      _destroyed: false,
      _videoFrameClock: null,
      _error: (error: Error) => {
        errors.push(error)
        return error
      }
    })

    renderer.presentVideoFrame({ timestamp: 1 } as any)
    expect(errors[0]?.message).toBe('VideoFrame invalid!')
    expect(renderer._videoFrameClock).toBeNull()
  })

  test('setVideoColorSpace accepts WebCodecs matrices and branded names', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    const spaces: Array<string | null> = []

    Object.assign(renderer, {
      _videoColorSpace: null,
      sendMessage: () => {
        spaces.push(renderer._videoColorSpace)
      }
    })

    renderer.setVideoColorSpace({ matrix: 'bt709' })
    renderer.setVideoColorSpace('smpte170m')
    renderer.setVideoColorSpace('BT709')
    renderer.setVideoColorSpace(null)

    expect(spaces).toEqual(['BT709', 'BT601', 'BT709', null])
  })

  test('an attached video element wins the clock over a presented frame', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    Object.assign(renderer, {
      _destroyed: false,
      _onDemandRender: false,
      _video: undefined,
      _videoFrameClock: null,
      _videoColorSpace: null,
      _playstate: true,
      timeOffset: 0,
      renderAhead: 0,
      sendMessage: () => {}
    })

    renderer.presentVideoFrame(frame({ timestamp: 1_000_000 }), { isPaused: false, rate: 1 })
    expect(renderer._clockCurrentTime()).toBe(1)

    renderer._video = { paused: false, ended: false, currentTime: 8.5, playbackRate: 2 }
    expect(renderer._clockCurrentTime()).toBe(8.5)
    expect(renderer._videoPlaybackRateForWorker()).toBe(2)
    expect(renderer._isVideoPausedForWorker()).toBe(false)
  })
})
