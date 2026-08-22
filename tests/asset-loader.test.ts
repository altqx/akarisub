import { describe, expect, test } from 'bun:test'
import {
  AssStreamDecoder,
  LARGE_SUBTITLE_BYTES,
  collectAssFontNames,
  concatBytes,
  fetchBoundedAsset,
  hasRenderableAssPrefix,
  parseContentRange,
  splitByteRanges
} from '../src/ts/asset-loader'

const encoder = new TextEncoder()

const rangeFromHeaders = (headers?: HeadersInit): { start: number; end: number } | null => {
  const value = new Headers(headers).get('range')
  if (!value) return null
  const match = /^\s*bytes\s*=\s*(\d+)-(\d+)\s*$/i.exec(value)
  if (!match) return null
  return { start: Number(match[1]), end: Number(match[2]) }
}

const bytesOf = (size: number, fill = 7): Uint8Array => new Uint8Array(size).fill(fill)

const rangedFetch = (file: Uint8Array): typeof fetch => {
  return async (_input, init) => {
    const range = rangeFromHeaders(init?.headers)
    if (!range) {
      return new Response(file, {
        status: 200,
        headers: { 'content-length': String(file.byteLength) }
      })
    }

    if (range.start >= file.byteLength) {
      return new Response(null, { status: 416 })
    }

    const end = Math.min(range.end, file.byteLength - 1)
    const slice = file.subarray(range.start, end + 1)
    return new Response(slice, {
      status: 206,
      headers: {
        'content-length': String(slice.byteLength),
        'content-range': `bytes ${range.start}-${end}/${file.byteLength}`
      }
    })
  }
}

describe('content-range parsing', () => {
  test('reads a closed range and total size', () => {
    expect(parseContentRange('bytes 0-255999/1000000')).toEqual({ start: 0, end: 255999, total: 1000000 })
  })

  test('allows an unknown total', () => {
    expect(parseContentRange('bytes 256000-511999/*')).toEqual({ start: 256000, end: 511999, total: null })
  })

  test('rejects unsatisfiable and inverted ranges', () => {
    expect(parseContentRange('bytes */1000')).toBeNull()
    expect(parseContentRange('bytes 10-5/20')).toBeNull()
    expect(parseContentRange('bytes 0-999/500')).toBeNull()
  })
})

describe('byte range splitting', () => {
  test('splits inclusive remaining bytes into chunks', () => {
    expect(splitByteRanges(256, 1023, 256)).toEqual([
      { start: 256, end: 511 },
      { start: 512, end: 767 },
      { start: 768, end: 1023 }
    ])
  })

  test('returns nothing when the remaining window is empty', () => {
    expect(splitByteRanges(100, 99, 256)).toEqual([])
  })
})

describe('ASS stream decoder', () => {
  test('holds a trailing incomplete line and UTF-8 code point', () => {
    const decoder = new AssStreamDecoder()
    const first = decoder.push(encoder.encode('Dialogue: 0,hello\nDialogue: 1,'))
    expect(first.newComplete).toBe('Dialogue: 0,hello\n')
    expect(first.completeText).toBe('Dialogue: 0,hello\n')

    const euro = encoder.encode('café')
    const split = decoder.push(euro.subarray(0, euro.byteLength - 1))
    expect(split.newComplete).toBe('')

    const rest = decoder.push(euro.subarray(euro.byteLength - 1))
    expect(rest.newComplete).toBe('')
    expect(decoder.finish()).toBe('Dialogue: 0,hello\nDialogue: 1,café')
  })

  test('detects a prefix that libass can start rendering', () => {
    const prefix = `[Script Info]\nTitle: test\n[V4+ Styles]\nFormat: Name,Fontname\nStyle: Default,Arial\n[Events]\nFormat: Layer,Start,End,Style,Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,Hi\n`
    expect(hasRenderableAssPrefix(prefix)).toBe(true)
    expect(hasRenderableAssPrefix('[Script Info]\nTitle: test\n')).toBe(false)
  })

  test('collects style and override font names from a fragment', () => {
    expect(collectAssFontNames('Style: Default,Arial,20\nDialogue: 0,0,0,Default,,0,0,0,,{\\fnRoboto}Hi}')).toEqual([
      'Arial',
      'Roboto'
    ])
  })
})

describe('fetchBoundedAsset', () => {
  test('streams a full 200 response when the server ignores Range', async () => {
    const file = encoder.encode('hello subtitle')
    const chunks: Uint8Array[] = []
    const bytes = await fetchBoundedAsset('https://cdn.example/sub.ass', {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: async () =>
        new Response(file, {
          status: 200,
          headers: { 'content-length': String(file.byteLength) }
        }),
      onChunk: (chunk) => {
        chunks.push(chunk)
      }
    })

    expect(new TextDecoder().decode(bytes)).toBe('hello subtitle')
    expect(concatBytes(chunks)).toEqual(bytes)
  })

  test('probes with Range and fetches the rest in order', async () => {
    const file = bytesOf(1000, 9)
    const requests: string[] = []
    const chunkOffsets: number[] = []

    const bytes = await fetchBoundedAsset('https://cdn.example/sub.ass', {
      maxBytes: 4096,
      timeoutMs: 1000,
      rangeChunkBytes: 256,
      rangeConcurrency: 4,
      fetchImpl: async (input, init) => {
        requests.push(new Headers(init?.headers).get('range') || 'GET')
        return rangedFetch(file)(input, init)
      },
      onChunk: (_chunk, info) => {
        chunkOffsets.push(info.offset)
      }
    })

    expect(bytes).toEqual(file)
    expect(requests[0]).toBe('bytes=0-255')
    expect(requests.slice(1).sort()).toEqual(['bytes=256-511', 'bytes=512-767', 'bytes=768-999'].sort())
    expect(chunkOffsets[0]).toBe(0)
    expect([...chunkOffsets].sort((a, b) => a - b)).toEqual(chunkOffsets)
  })

  test('falls back to GET when Range is rejected', async () => {
    const file = encoder.encode('[Script Info]\n')
    const bytes = await fetchBoundedAsset('https://cdn.example/sub.ass', {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: async (_input, init) => {
        if (new Headers(init?.headers).has('range')) {
          return new Response(null, { status: 416 })
        }
        return new Response(file, { status: 200 })
      }
    })
    expect(new TextDecoder().decode(bytes)).toBe('[Script Info]\n')
  })

  test('falls back to GET when a Range probe is blocked', async () => {
    const file = encoder.encode('[Events]\n')
    const bytes = await fetchBoundedAsset('https://cdn.example/sub.ass', {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: async (_input, init) => {
        if (new Headers(init?.headers).has('range')) {
          throw new TypeError('Failed to fetch')
        }
        return new Response(file, { status: 200 })
      }
    })
    expect(new TextDecoder().decode(bytes)).toBe('[Events]\n')
  })

  test('falls back to GET when a 206 body is compressed', async () => {
    const file = encoder.encode('full file')
    const bytes = await fetchBoundedAsset('https://cdn.example/sub.ass', {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: async (_input, init) => {
        if (new Headers(init?.headers).has('range')) {
          return new Response(file.subarray(0, 4), {
            status: 206,
            headers: {
              'content-encoding': 'gzip',
              'content-range': 'bytes 0-3/9'
            }
          })
        }
        return new Response(file, { status: 200 })
      }
    })
    expect(new TextDecoder().decode(bytes)).toBe('full file')
  })

  test('rejects a declared length above the byte cap', async () => {
    await expect(
      fetchBoundedAsset('https://cdn.example/sub.ass', {
        maxBytes: 32,
        timeoutMs: 1000,
        label: 'Subtitle',
        fetchImpl: async () =>
          new Response(bytesOf(8), {
            status: 200,
            headers: { 'content-length': String(LARGE_SUBTITLE_BYTES) }
          })
      })
    ).rejects.toThrow('Subtitle files are limited to 32 MiB')
  })

  test('cancels a stream that grows past the byte cap', async () => {
    const file = bytesOf(64)
    await expect(
      fetchBoundedAsset('https://cdn.example/sub.ass', {
        maxBytes: 16,
        timeoutMs: 1000,
        label: 'Subtitle',
        fetchImpl: async () => new Response(file, { status: 200 })
      })
    ).rejects.toThrow('Subtitle files are limited to 32 MiB')
  })

  test('rejects a ranged file whose total exceeds the cap', async () => {
    await expect(
      fetchBoundedAsset('https://cdn.example/sub.ass', {
        maxBytes: 32,
        timeoutMs: 1000,
        label: 'Subtitle',
        fetchImpl: async () =>
          new Response(bytesOf(8), {
            status: 206,
            headers: { 'content-range': 'bytes 0-7/64' }
          })
      })
    ).rejects.toThrow('Subtitle files are limited to 32 MiB')
  })

  test('times out a hanging request', async () => {
    await expect(
      fetchBoundedAsset('https://cdn.example/sub.ass', {
        maxBytes: 1024,
        timeoutMs: 20,
        label: 'Subtitle',
        fetchImpl: async (_input, init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            })
          })
      })
    ).rejects.toThrow('Subtitle request timed out')
  })

  test('propagates an external abort', async () => {
    const controller = new AbortController()
    const pending = fetchBoundedAsset('https://cdn.example/sub.ass', {
      maxBytes: 1024,
      timeoutMs: 1000,
      signal: controller.signal,
      fetchImpl: async (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('continues unknown-total ranges until the server returns 416', async () => {
    const file = bytesOf(300, 3)
    const bytes = await fetchBoundedAsset('https://cdn.example/sub.ass', {
      maxBytes: 1024,
      timeoutMs: 1000,
      rangeChunkBytes: 128,
      fetchImpl: async (_input, init) => {
        const range = rangeFromHeaders(init?.headers)
        if (!range) return new Response(file, { status: 200 })
        if (range.start >= file.byteLength) return new Response(null, { status: 416 })
        const end = Math.min(range.end, file.byteLength - 1)
        const slice = file.subarray(range.start, end + 1)
        return new Response(slice, {
          status: 206,
          headers: { 'content-range': `bytes ${range.start}-${end}/*` }
        })
      }
    })
    expect(bytes).toEqual(file)
  })
})
