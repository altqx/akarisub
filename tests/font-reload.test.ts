import { describe, expect, test } from 'bun:test'
import { createFontReloadScheduler } from '../src/ts/font-reload'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('createFontReloadScheduler', () => {
  test('flush with nothing pending does not reload', () => {
    let reloads = 0
    const scheduler = createFontReloadScheduler(() => reloads++, 5)
    scheduler.flush()
    expect(reloads).toBe(0)
  })

  test('coalesces repeated schedules into one reload', async () => {
    let reloads = 0
    const scheduler = createFontReloadScheduler(() => reloads++, 5)
    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()
    expect(reloads).toBe(0)
    await wait(30)
    expect(reloads).toBe(1)
  })

  test('flush runs the pending reload synchronously and cancels the timer', async () => {
    let reloads = 0
    const scheduler = createFontReloadScheduler(() => reloads++, 5)
    scheduler.schedule()
    scheduler.flush()
    expect(reloads).toBe(1)
    await wait(30)
    expect(reloads).toBe(1)
  })

  test('schedules again after a flush', async () => {
    let reloads = 0
    const scheduler = createFontReloadScheduler(() => reloads++, 5)
    scheduler.schedule()
    scheduler.flush()
    scheduler.schedule()
    await wait(30)
    expect(reloads).toBe(2)
  })
})
