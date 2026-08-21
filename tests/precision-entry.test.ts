import { expect, test } from 'bun:test'
import AkariSub from '../precision.js'

test('keeps a compositor swap armed when it is early or within 0.05 ms of RVFC', () => {
  const renderer = Object.create(AkariSub.prototype) as any
  const calls: string[] = []
  const expectedDisplayTime = performance.now() + 100
  const animation = { cancel: () => calls.push('cancel') }
  const stage = { style: { opacity: '0' } }
  const frame = {
    stage,
    scheduled: true,
    committed: false,
    targetDisplayTime: expectedDisplayTime + 0.04,
    animations: [animation]
  }

  Object.assign(renderer, {
    _activatePresentation: () => true,
    _committedStage: null,
    _scheduledPreparedFrame: frame,
    _stageDisplayTimes: new Map(),
    _schedulePreparedFrame: () => calls.push('schedule'),
    _commitPreparedStage: () => calls.push('commit')
  })

  renderer._presentPreparedFrame(frame, 1, expectedDisplayTime)

  expect(calls).toEqual([])
  expect(frame.scheduled).toBe(true)
  expect(renderer._stageDisplayTimes.get(stage)).toBe(expectedDisplayTime)
})

test('retimes only a compositor swap that would be more than 0.05 ms late', () => {
  const renderer = Object.create(AkariSub.prototype) as any
  const calls: string[] = []
  const expectedDisplayTime = performance.now() + 100
  const animation = { cancel: () => calls.push('cancel') }
  const stage = { style: { opacity: '0' } }
  const frame = {
    stage,
    scheduled: true,
    committed: false,
    targetDisplayTime: expectedDisplayTime + 0.06,
    animations: [animation]
  }

  Object.assign(renderer, {
    _activatePresentation: () => true,
    _committedStage: null,
    _scheduledPreparedFrame: frame,
    _stageDisplayTimes: new Map(),
    _schedulePreparedFrame: (_frame: unknown, target: number) => {
      calls.push(`schedule:${target}`)
      frame.scheduled = true
    },
    _commitPreparedStage: () => calls.push('commit')
  })

  renderer._presentPreparedFrame(frame, 1, expectedDisplayTime)

  expect(calls[0]).toBe('cancel')
  expect(calls[1]).toBe(`schedule:${expectedDisplayTime}`)
  expect(frame.scheduled).toBe(true)
})
