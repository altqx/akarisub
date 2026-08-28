import { describe, expect, test } from 'bun:test'
import { bitmapFailureAction, collectSettledBitmaps } from '../src/ts/bitmap-settlements'

interface TestBitmap {
  id: number
  close: () => void
}

const bitmap = (id: number, closed: number[]): TestBitmap => ({
  id,
  close: () => closed.push(id)
})

describe('bitmap settlements', () => {
  test('fails a prepared frame instead of snapshotting stale canvas content', () => {
    expect(bitmapFailureAction(false, 17)).toEqual({ kind: 'failPreparedFrame', prepareId: 17 })
    expect(bitmapFailureAction(false, undefined)).toEqual({ kind: 'finishDemand' })
    expect(bitmapFailureAction(true, 17)).toEqual({ kind: 'retryWithoutOptions' })
  })

  test('preserves fulfilled bitmaps in their original order', () => {
    const closed: number[] = []
    const first = bitmap(1, closed)
    const second = bitmap(2, closed)

    expect(
      collectSettledBitmaps([
        { status: 'fulfilled', value: first },
        { status: 'fulfilled', value: second }
      ])
    ).toEqual([first, second])
    expect(closed).toEqual([])
  })

  test('closes every fulfilled bitmap when any creation fails', () => {
    const closed: number[] = []

    expect(
      collectSettledBitmaps([
        { status: 'fulfilled', value: bitmap(1, closed) },
        { status: 'rejected', reason: new Error('bitmap creation failed') },
        { status: 'fulfilled', value: bitmap(3, closed) }
      ])
    ).toBeNull()
    expect(closed).toEqual([1, 3])
  })
})
