import { expect, test } from 'bun:test'

import { presentedFrameIndex, snapToFrameTimeline } from '../src/ts/timing'

test('treats sub-0.05 ms RVFC/probe skew as the same encoded frame', () => {
  const timeline = new Float64Array([6.25, 6.292, 6.333, 6.375])

  // Browser timestamp is 0.0003 ms below the probed frame PTS. Native players
  // sample libass at the current video frame PTS (6.333 s), not the prior frame.
  const rvfcMediaTime = 6.3329997

  expect(presentedFrameIndex(timeline, rvfcMediaTime)).toBe(2)
  expect(snapToFrameTimeline(timeline, rvfcMediaTime)).toBeCloseTo(6.333, 9)
})

test('does not advance to a future frame outside the numerical-skew tolerance', () => {
  const timeline = new Float64Array([6.25, 6.292, 6.333, 6.375])

  // 0.1 ms before the frame boundary is a real pre-boundary sample, not
  // floating-point noise, so retain the previous-frame semantics.
  expect(presentedFrameIndex(timeline, 6.3329)).toBe(1)
  expect(snapToFrameTimeline(timeline, 6.3329)).toBeCloseTo(6.292, 9)
})
