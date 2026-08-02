import { describe, expect, test } from 'bun:test'
import {
  MAX_FRAME_TIMELINE_ENTRIES,
  compensatedMediaTime,
  frameIndexAtOrAfter,
  nearestFrameIndex,
  normalizeFrameTimeline,
  presentationLeadSeconds,
  snapToFrameTimeline,
  updateTimingCompensation
} from '../src/ts/timing'
import AkariSub from '../src/ts/akarisub'

const oversizedTimeline = () => {
  let indexedReads = 0
  const timeline = new Proxy({ length: MAX_FRAME_TIMELINE_ENTRIES + 1 } as ArrayLike<number>, {
    get(target, property, receiver) {
      if (property !== 'length') {
        indexedReads += 1
        throw new Error('timeline entry must not be read')
      }
      return Reflect.get(target, property, receiver)
    }
  })
  return { timeline, indexedReads: () => indexedReads }
}

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

  test('rejects an oversized normalized timeline before reading any indexed entry', () => {
    const oversized = oversizedTimeline()
    expect(() => normalizeFrameTimeline(oversized.timeline)).toThrow(/resource limit.*250000|250000.*resource limit/i)
    expect(oversized.indexedReads()).toBe(0)
  })

  test('rejects an oversized constructor timeline before browser feature work or indexed reads', () => {
    const oversized = oversizedTimeline()
    expect(() => new AkariSub({ frameTimeline: oversized.timeline })).toThrow(/resource limit.*250000|250000.*resource limit/i)
    expect(oversized.indexedReads()).toBe(0)
  })

  test('rejects an oversized runtime timeline before mutating the renderer or reading entries', () => {
    const oversized = oversizedTimeline()
    expect(() => AkariSub.prototype.setFrameTimeline.call({}, oversized.timeline)).toThrow(
      /resource limit.*250000|250000.*resource limit/i
    )
    expect(oversized.indexedReads()).toBe(0)
  })

  test('snaps predicted presentation time to the encoded frame still being presented', () => {
    const timeline = new Float64Array([0, 0.041708, 0.083417])
    expect(frameIndexAtOrAfter(timeline, 0.02)).toBe(1)
    expect(snapToFrameTimeline(timeline, 0.005)).toBe(0)
    expect(snapToFrameTimeline(timeline, 0.02)).toBe(0)
    expect(snapToFrameTimeline(timeline, 0.041708)).toBeCloseTo(0.041708)
    expect(snapToFrameTimeline(timeline, 1)).toBeCloseTo(0.083417)
    expect(nearestFrameIndex(timeline, 0.039)).toBe(1)
    expect(nearestFrameIndex(timeline, 0.06)).toBe(1)
  })
})
