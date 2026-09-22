import { describe, expect, test } from 'bun:test'
import { GPURecovery, type GPURenderer, type GPUFrameSnapshot } from '../src/ts/gpu-recovery'

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function harness(replay: () => Promise<void> = async () => {}) {
  const events: string[] = [],
    discarded: GPUFrameSnapshot[] = []
  const renderer = (name: string) => ({ destroy: () => events.push(`destroy:${name}`) }) as GPURenderer
  const original = renderer('original')
  let current: GPURenderer | null = original
  const recovery = new GPURecovery({
    current: () => current,
    use: (next) => {
      current = next
    },
    begin: (reason) => {
      events.push(`show:${reason}`)
    },
    replay: async () => {
      events.push('replay')
      await replay()
      events.push('replayed')
    },
    recovered: (reason) => {
      events.push(`hide:${reason}`)
    },
    fallback: (reason) => {
      events.push(`fallback:${reason}`)
    },
    discard: (snapshot) => {
      discarded.push(snapshot)
    }
  })
  const snapshot = (): GPUFrameSnapshot => ({
    sequence: recovery.sequence(),
    images: [],
    width: 1,
    height: 1,
    colorManaged: false
  })
  return { recovery, original, renderer, events, discarded, snapshot, current: () => current }
}

describe('GPU recovery lifetime', () => {
  test('retains only successful frames and ignores out-of-order completion', async () => {
    const h = harness(),
      earlier = h.snapshot(),
      later = h.snapshot(),
      failed = h.snapshot()
    const work = deferred<boolean>()
    const pending = h.recovery.retainAfter(work.promise, earlier)
    h.recovery.retainAfter(true, later)
    h.recovery.retainAfter(false, failed)
    work.resolve(true)
    await pending
    expect(h.recovery.snapshot).toBe(later)
    expect(h.discarded).toEqual([failed, earlier])
  })

  test('rejected GPU work releases its snapshot while preserving the last successful frame', async () => {
    const h = harness(),
      retained = h.snapshot(),
      rejected = h.snapshot()
    h.recovery.commit(retained)
    await expect(h.recovery.retainAfter(Promise.reject(new Error('queue failed')), rejected)).rejects.toThrow(
      'queue failed'
    )
    expect(h.recovery.snapshot).toBe(retained)
    expect(h.discarded).toEqual([rejected])
  })

  test('materializes a retained raw frame without changing its presentation sequence', () => {
    const h = harness(),
      raw = h.snapshot()
    h.recovery.commit(raw)
    const materialized = { canvas: {} as HTMLCanvasElement, sequence: raw.sequence, colorManaged: false }
    h.recovery.materialize(raw, materialized)
    expect(h.recovery.snapshot).toBe(materialized)
    const stale = { ...materialized, canvas: {} as HTMLCanvasElement }
    h.recovery.materialize(raw, stale)
    expect(h.recovery.snapshot).toBe(materialized)
    expect(h.discarded).toContain(stale)
  })

  test('WebGPU replacement keeps retained visibility until replay finishes', async () => {
    const replay = deferred<void>(),
      h = harness(() => replay.promise),
      retained = h.snapshot()
    h.recovery.commit(retained)
    const replacement = h.renderer('replacement')
    const pending = h.recovery.replace(
      h.original,
      () => replacement,
      async () => {}
    )
    await Promise.resolve()
    expect(h.events).toEqual(['show:device-lost', 'destroy:original', 'replay'])
    expect(h.recovery.snapshot).toBe(retained)
    expect(h.current()).toBe(replacement)
    replay.resolve()
    await pending
    expect(h.events.slice(-2)).toEqual(['replayed', 'hide:device-lost'])
  })

  test('WebGL restoration replays the retained frame before removing its overlay', async () => {
    const h = harness()
    h.recovery.waitForRestore(h.original)
    await h.recovery.restore(h.original)
    expect(h.events).toEqual(['show:context-lost', 'replay', 'replayed', 'hide:context-lost'])
    h.recovery.destroy()
  })

  test('WebGL timeout adopts fallback once and ignores late restoration', async () => {
    const h = harness()
    h.recovery.waitForRestore(h.original, 0)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await h.recovery.restore(h.original)
    expect(h.events).toEqual(['show:context-lost', 'destroy:original', 'fallback:context-lost'])
    expect(h.current()).toBeNull()
  })

  test('failed replacement initialization cleans up the replacement and falls back with the retained frame', async () => {
    const h = harness(),
      retained = h.snapshot(),
      replacement = h.renderer('replacement')
    h.recovery.commit(retained)
    await h.recovery.replace(
      h.original,
      () => replacement,
      async () => {
        throw new Error('device lost')
      }
    )
    expect(h.events).toContain('destroy:replacement')
    expect(h.events.at(-1)).toBe('fallback:device-lost')
    expect(h.current()).toBeNull()
    expect(h.recovery.snapshot).toBe(retained)
  })

  test('failed replay disposes the adopted replacement before fallback', async () => {
    const h = harness(async () => {
        throw new Error('queue lost')
      }),
      replacement = h.renderer('replacement')
    await h.recovery.replace(
      h.original,
      () => replacement,
      async () => {}
    )
    expect(h.events.slice(-2)).toEqual(['destroy:replacement', 'fallback:device-lost'])
    expect(h.events).not.toContain('hide:device-lost')
  })

  test('destroy during replacement initialization disposes late resources without adopting them', async () => {
    const init = deferred<void>(),
      h = harness(),
      replacement = h.renderer('replacement')
    const pending = h.recovery.replace(
      h.original,
      () => replacement,
      () => init.promise
    )
    h.recovery.destroy()
    init.resolve()
    await pending
    expect(h.current()).toBe(h.original)
    expect(h.events).toEqual(['show:device-lost', 'destroy:original', 'destroy:replacement'])
  })

  test('destroy during replay prevents late reveal and notification', async () => {
    const replay = deferred<void>(),
      h = harness(() => replay.promise)
    h.recovery.waitForRestore(h.original)
    const pending = h.recovery.restore(h.original)
    h.recovery.destroy()
    replay.resolve()
    await pending
    expect(h.events).not.toContain('hide:context-lost')
    expect(h.events).not.toContain('fallback:context-lost')
  })

  test('duplicate loss and restoration do not start multiple recovery sequences', async () => {
    const replay = deferred<void>(),
      h = harness(() => replay.promise)
    h.recovery.waitForRestore(h.original)
    h.recovery.waitForRestore(h.original)
    const pending = h.recovery.restore(h.original)
    await h.recovery.restore(h.original)
    replay.resolve()
    await pending
    expect(h.events).toEqual(['show:context-lost', 'replay', 'replayed', 'hide:context-lost'])
  })

  test('destroy releases retained and late-completing snapshots without resurrecting them', async () => {
    const h = harness(),
      first = h.snapshot(),
      late = h.snapshot(),
      work = deferred<boolean>()
    h.recovery.commit(first)
    const pending = h.recovery.retainAfter(work.promise, late)
    h.recovery.destroy()
    work.resolve(true)
    await pending
    expect(h.discarded).toEqual([first, late])
    expect(h.recovery.snapshot).toBeNull()
  })
})
