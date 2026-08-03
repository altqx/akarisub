import { describe, expect, test } from 'bun:test'
import AkariSub from '../src/ts/akarisub'
import {
  compensatedMediaTime,
  frameIndexAtOrAfter,
  nearestFrameIndex,
  normalizeFrameTimeline,
  presentationLeadSeconds,
  presentedFrameIndex,
  isStalePresentation,
  resolvePresentationMediaTime,
  selectRenderMediaTime,
  snapToFrameTimeline,
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
    expect(selectRenderMediaTime(timeline, 0.041708, 0.166833, true)).toBeCloseTo(0.166833)
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
