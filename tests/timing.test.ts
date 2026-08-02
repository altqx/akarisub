import { describe, expect, test } from 'bun:test'
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
})
