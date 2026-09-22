import { describe, expect, test } from 'bun:test'
import { TrackLifecycle, type TrackLoader } from '../src/ts/track-lifecycle'
import type { EncryptedSubtitleContent } from '../src/ts/types'

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const encrypted = {} as EncryptedSubtitleContent
function harness(overrides: Partial<TrackLoader> = {}) {
  const calls: string[] = []
  const installed: { content: string | Uint8Array; encrypted: boolean; requestId?: number }[] = []
  const loader: TrackLoader = {
    load: async () => ({ content: 'track', emittedPartialReady: false }),
    decrypt: async () => new Uint8Array([1, 2, 3]),
    prepare: (content) =>
      typeof content === 'string' || content instanceof Uint8Array ? content : new Uint8Array(content),
    scanFonts: () => {
      calls.push('scan')
    },
    waitFonts: async () => {
      calls.push('fonts')
    },
    flushFonts: () => {
      calls.push('flush')
    },
    changed: () => {
      calls.push('changed')
    },
    protect: () => {
      calls.push('protect')
    },
    install: (content, encrypted, requestId) => {
      calls.push('install')
      installed.push({ content: typeof content === 'string' ? content : content.slice(), encrypted, requestId })
    },
    partial: () => {
      calls.push('partial')
      return true
    },
    removePartial: () => {
      calls.push('remove-partial')
    },
    ...overrides
  }
  return { tracks: new TrackLifecycle(loader), calls, installed }
}

describe('track lifecycle', () => {
  test('preloads fonts without replacing the active track, then tags activation readiness', async () => {
    const h = harness()
    h.tracks.set('current')
    const id = await h.tracks.preload({ kind: 'content', content: 'next' })
    expect(h.installed.map((x) => x.content)).toEqual(['current'])
    expect(h.calls.slice(-3)).toEqual(['scan', 'fonts', 'flush'])
    expect(h.tracks.activate(id, 37)).toBe(id)
    expect(h.installed[1]).toEqual({ content: 'next', encrypted: false, requestId: 37 })
    expect(() => h.tracks.activate(id, 38)).toThrow('No preloaded track')
  })

  test('supersedes a URL fetch and prevents late partial or final installation', async () => {
    const fetched = deferred<{ content: string; emittedPartialReady: boolean }>()
    let partial!: (text: string) => void, signal!: AbortSignal
    const h = harness({
      load: (_url, s, _current, publish) => {
        signal = s
        partial = publish!
        return fetched.promise
      }
    })
    const pending = h.tracks.setUrl('/old.ass')
    h.tracks.set('new')
    partial('old partial')
    fetched.resolve({ content: 'old', emittedPartialReady: false })
    await pending
    expect(signal.aborted).toBe(true)
    expect(h.calls).not.toContain('partial')
    expect(h.installed.map((x) => x.content)).toEqual(['new'])
  })

  test('removes a published partial track after a current fetch fails', async () => {
    const h = harness({
      load: async (_url, _signal, _current, partial) => {
        partial!('prefix')
        throw new Error('network')
      }
    })
    await expect(h.tracks.setUrl('/broken.ass')).rejects.toThrow('network')
    expect(h.calls).toContain('remove-partial')
    expect(h.installed).toEqual([])
  })

  test('a superseded fetch failure cannot remove the new track', async () => {
    const fetched = deferred<{ content: string; emittedPartialReady: boolean }>()
    const h = harness({
      load: (_url, _signal, _current, partial) => {
        partial!('prefix')
        return fetched.promise
      }
    })
    const pending = h.tracks.setUrl('/old.ass')
    h.tracks.set('new')
    fetched.reject(new Error('late failure'))
    await pending
    expect(h.calls).not.toContain('remove-partial')
  })

  test('late decryption cannot overwrite a replacement and always wipes plaintext', async () => {
    const decoded = deferred<Uint8Array>(),
      bytes = new Uint8Array([1, 2, 3])
    const h = harness({ decrypt: () => decoded.promise })
    const pending = h.tracks.setEncrypted(encrypted)
    h.tracks.set('new')
    decoded.resolve(bytes)
    await pending
    expect(h.installed.map((x) => x.content)).toEqual(['new'])
    expect([...bytes]).toEqual([0, 0, 0])
  })

  test('canceling an encrypted preload during font wait wipes bytes without waiting for fonts', async () => {
    const fonts = deferred<void>(),
      bytes = new Uint8Array([1, 2, 3])
    const h = harness({ decrypt: async () => bytes, waitFonts: () => fonts.promise })
    const pending = h.tracks.preload({ kind: 'encrypted', content: encrypted })
    void pending.catch(() => {})
    await Promise.resolve()
    h.tracks.destroy()
    await expect(pending).rejects.toThrow('cancelled')
    expect([...bytes]).toEqual([0, 0, 0])
    expect(h.installed).toEqual([])
    fonts.resolve()
  })

  test('preload supersession during decryption wipes the obsolete result without clearing the newer preload', async () => {
    const decoded = deferred<Uint8Array>(),
      bytes = new Uint8Array([7])
    const h = harness({ decrypt: () => decoded.promise })
    const old = h.tracks.preload({ kind: 'encrypted', content: encrypted })
    void old.catch(() => {})
    const id = await h.tracks.preload({ kind: 'content', content: 'new' })
    decoded.resolve(bytes)
    await expect(old).rejects.toThrow('cancelled')
    expect(bytes[0]).toBe(0)
    h.tracks.activate(id, 42)
    expect(h.installed[0].content).toBe('new')
  })

  test('activation releases encrypted bytes even when native installation throws', async () => {
    const bytes = new Uint8Array([4, 5])
    const h = harness({
      decrypt: async () => bytes,
      install: () => {
        throw new Error('native load failed')
      }
    })
    const id = await h.tracks.preload({ kind: 'encrypted', content: encrypted })
    expect([...bytes]).toEqual([4, 5])
    expect(() => h.tracks.activate(id, 4)).toThrow('native load failed')
    expect([...bytes]).toEqual([0, 0])
    expect(() => h.tracks.activate(id, 5)).toThrow('No preloaded track')
  })

  test('font failure wipes local decrypted content and rejects preload', async () => {
    const bytes = new Uint8Array([9])
    const h = harness({
      decrypt: async () => bytes,
      waitFonts: async () => {
        throw new Error('font failure')
      }
    })
    await expect(h.tracks.preload({ kind: 'encrypted', content: encrypted })).rejects.toThrow('font failure')
    expect(bytes[0]).toBe(0)
    expect(h.calls).not.toContain('install')
  })

  test('destroy wipes the stored encrypted track and rejects future use', async () => {
    const bytes = new Uint8Array([5])
    const h = harness({ decrypt: async () => bytes })
    const id = await h.tracks.preload({ kind: 'encrypted', content: encrypted })
    h.tracks.destroy()
    expect(bytes[0]).toBe(0)
    expect(() => h.tracks.activate(id, 4)).toThrow('destroyed')
    expect(() => h.tracks.set('orphan')).toThrow('destroyed')
  })
})
