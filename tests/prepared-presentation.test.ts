import { describe, expect, test } from 'bun:test'
import { PreparedPresentation, type PreparedFrame } from '../src/ts/prepared-presentation'

function harness() {
  let now = 100
  const removed: string[] = [],
    released: string[] = [],
    committed: PreparedFrame[] = []
  const animations: any[] = []
  const canvas = (name: string) =>
    ({
      style: { opacity: '0' },
      isConnected: true,
      getAnimations: () => [],
      remove: () => removed.push(name),
      animate: (_frames: unknown, options: KeyframeAnimationOptions) => {
        let finish!: () => void, reject!: () => void
        const a = {
          name,
          options,
          startTime: null,
          canceled: false,
          finished: new Promise<void>((resolve, fail) => {
            finish = resolve
            reject = fail
          }),
          finish: () => finish(),
          reject: () => reject(),
          cancel: () => {
            a.canceled = true
          }
        }
        animations.push(a)
        return a
      }
    }) as unknown as HTMLCanvasElement
  const base = canvas('base')
  const owner = new PreparedPresentation({
    canvas: () => base,
    release: (stage) => released.push(stage === base ? 'base' : 'stage'),
    committed: (frame) => committed.push(frame),
    refreshInterval: () => 1000 / 60,
    now: () => now,
    documentTime: () => 500
  })
  const frame = (index: number, targetDisplayTime?: number) => {
    const stage = canvas(String(index))
    const frame: PreparedFrame = { width: 1920, height: 1080, stage, index, ready: true, targetDisplayTime }
    owner.register(stage, index)
    owner.store(index, frame)
    return frame
  }
  return {
    owner,
    frame,
    base,
    removed,
    released,
    committed,
    animations,
    time: (value: number) => {
      now = value
    }
  }
}

describe('prepared presentation lifetime', () => {
  test('preserves the visible frame across an epoch replacement, then releases it on destruction', () => {
    const h = harness(),
      current = h.frame(11)
    h.owner.present(current)
    h.frame(12)
    h.owner.clear()
    expect(h.removed).toEqual(['12'])
    expect(current.stage!.style.opacity).toBe('1')
    expect(h.base.style.opacity).toBe('0')
    expect(h.owner.has(11)).toBe(false)
    h.owner.destroy()
    expect(h.removed).toEqual(['12', '11'])
    expect(h.released).toHaveLength(2)
    expect(h.base.style.opacity).toBe('1')
  })

  test('rejects a late demand handoff but retains future prefetch on a current handoff', () => {
    const h = harness(),
      current = h.frame(12)
    h.owner.present(current)
    const future = h.frame(14)
    h.owner.activateBase(11)
    expect(h.removed).toEqual([])
    expect(h.base.style.opacity).toBe('0')
    h.owner.activateBase(12)
    expect(h.removed).toEqual(['12'])
    expect(h.owner.get(14)).toBe(future)
    expect(future.stage!.style.opacity).toBe('0')
    expect(h.base.style.opacity).toBe('1')
  })

  test('schedules one swap at a shared absolute instant and transfers ownership after completion', async () => {
    const h = harness(),
      first = h.frame(1, 200),
      second = h.frame(2, 300)
    expect(first.scheduled).toBe(true)
    expect(second.scheduled).toBeUndefined()
    expect(h.animations).toHaveLength(2)
    expect(h.animations[0].startTime).toBe(h.animations[1].startTime)
    expect(h.animations.map((a) => a.options.delay)).toEqual([0, 0])
    h.animations[0].finish()
    await Promise.resolve()
    expect(first.committed).toBe(true)
    expect(second.scheduled).toBe(true)
    expect(h.committed).toEqual([first])
  })

  test('RVFC commits immediately and repeated validation does not rerasterize', () => {
    const h = harness(),
      frame = h.frame(1, 200)
    h.owner.present(frame, 200)
    h.owner.present(frame, 200)
    expect(h.committed).toEqual([frame])
    expect(frame.stage!.style.opacity).toBe('1')
    expect(h.animations.every((a) => a.canceled)).toBe(true)
  })

  test('stale callbacks and cache pruning preserve scheduled visibility until a successor commits', () => {
    const h = harness(),
      frame = h.frame(1, 200)
    h.time(201)
    h.owner.reject(frame)
    h.owner.prune(2, 5)
    expect(h.removed).toEqual([])
    expect(h.owner.has(1)).toBe(false)
    h.owner.activateBase(0)
    expect(h.base.style.opacity).toBe('0')
    const successor = h.frame(2)
    h.owner.present(successor)
    expect(h.removed).toEqual(['1'])
  })

  test('removing an intermediate stage does not prevent a later swap retiring all older stages', async () => {
    const h = harness(),
      first = h.frame(1),
      middle = h.frame(2)
    h.owner.present(first)
    const next = h.frame(3, 200)
    h.owner.dispose(middle)
    h.frame(0)
    h.animations[0].finish()
    await Promise.resolve()
    expect(h.removed.sort()).toEqual(['0', '1', '2'])
    expect(next.stage!.style.opacity).toBe('1')
  })

  test('failed compositor setup still permits immediate presentation', () => {
    const h = harness(),
      frame = h.frame(1)
    frame.stage!.animate = () => {
      throw new Error('unavailable')
    }
    h.owner.schedule(frame, 200)
    expect(frame.scheduled).toBeUndefined()
    h.owner.present(frame)
    expect(frame.stage!.style.opacity).toBe('1')
  })

  test('canceled shows release sibling animations without committing stale work', async () => {
    const h = harness(),
      frame = h.frame(1, 200)
    h.owner.take(1)
    h.animations[0].reject()
    await Promise.resolve()
    expect(h.animations.every((a) => a.canceled)).toBe(true)
    expect(h.committed).toEqual([])
    expect(frame.scheduled).toBe(false)
  })

  test('destruction cancels an in-flight swap and late completion cannot commit', async () => {
    const h = harness()
    h.frame(1, 200)
    h.owner.destroy()
    h.animations[0].finish()
    await Promise.resolve()
    expect(h.committed).toEqual([])
    expect(h.removed).toEqual(['1'])
  })

  test('replacing and pruning unstaged snapshots closes each discarded bitmap', () => {
    const h = harness(),
      closed: number[] = []
    const snapshot = (id: number): PreparedFrame => ({
      width: 1,
      height: 1,
      bitmap: { close: () => closed.push(id) } as ImageBitmap
    })
    h.owner.store(1, snapshot(1))
    h.owner.store(1, snapshot(2))
    h.owner.prune(2, 4)
    expect(closed).toEqual([1, 2])
    expect(h.owner.take(1)).toBeUndefined()
  })
})
