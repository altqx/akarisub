export const MAX_SUBTITLE_BYTES = 32 * 1024 * 1024
export const SUBTITLE_FETCH_TIMEOUT_MS = 30_000
export const RANGE_CHUNK_BYTES = 256 * 1024
export const RANGE_CONCURRENCY = 4
export const LARGE_SUBTITLE_BYTES = 500_000

export type ByteRange = {
  start: number
  end: number
}

export type AssetChunkInfo = {
  offset: number
  total: number | null
}

export type FetchBoundedAssetOptions = {
  maxBytes: number
  timeoutMs: number
  signal?: AbortSignal
  rangeChunkBytes?: number
  rangeConcurrency?: number
  label?: string
  fetchImpl?: typeof fetch
  onChunk?: (chunk: Uint8Array, info: AssetChunkInfo) => void | Promise<void>
}

export const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && error.name === 'AbortError'
}

const mergeAbortSignals = (signals: readonly (AbortSignal | undefined)[]): AbortSignal => {
  const controller = new AbortController()
  const abortWith = (signal: AbortSignal): void => {
    controller.abort(signal.reason)
  }

  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      abortWith(signal)
      return controller.signal
    }
    signal.addEventListener('abort', () => abortWith(signal), { once: true })
  }

  return controller.signal
}

export const parseContentRange = (header: string): { start: number; end: number; total: number | null } | null => {
  const match = /^\s*bytes\s+(?:\*|(\d+)-(\d+))\s*\/\s*(\d+|\*)\s*$/i.exec(header)
  if (!match || match[1] === undefined) return null

  const start = Number(match[1])
  const end = Number(match[2])
  const total = match[3] === '*' ? null : Number(match[3])
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return null
  if (total !== null && (!Number.isInteger(total) || total <= end)) return null
  return { start, end, total }
}

export const splitByteRanges = (start: number, lastInclusive: number, chunkBytes: number): ByteRange[] => {
  if (chunkBytes <= 0 || start < 0 || start > lastInclusive) return []

  const ranges: ByteRange[] = []
  for (let offset = start; offset <= lastInclusive; offset += chunkBytes) {
    ranges.push({ start: offset, end: Math.min(offset + chunkBytes - 1, lastInclusive) })
  }
  return ranges
}

export const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

const isIdentityEncoding = (value: string | null): boolean => {
  if (!value) return true
  return value.split(',').every((part) => {
    const encoding = part.trim().toLowerCase()
    return encoding === '' || encoding === 'identity'
  })
}

const limitError = (label: string): Error => new Error(`${label} files are limited to 32 MiB`)

const requestError = (label: string, status: number): Error => new Error(`${label} request failed with HTTP ${status}`)

const readResponseBytes = async (
  response: Response,
  options: {
    maxBytes: number
    label: string
    onChunk?: (chunk: Uint8Array) => void | Promise<void>
  }
): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    await response.body?.cancel()
    throw limitError(options.label)
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > options.maxBytes) throw limitError(options.label)
    if (bytes.byteLength > 0) await options.onChunk?.(bytes)
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > options.maxBytes) {
      await reader.cancel()
      throw limitError(options.label)
    }
    chunks.push(value)
    await options.onChunk?.(value)
  }
  return concatBytes(chunks)
}

const mapPool = async <T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  const count = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: count }, () => worker()))
  return results
}

export class AssStreamDecoder {
  private readonly decoder = new TextDecoder('utf-8')
  private leftover = ''
  private complete = ''

  push(chunk: Uint8Array): { completeText: string; newComplete: string } {
    const combined = this.leftover + this.decoder.decode(chunk, { stream: true })
    const lastNewline = Math.max(combined.lastIndexOf('\n'), combined.lastIndexOf('\r'))
    if (lastNewline === -1) {
      this.leftover = combined
      return { completeText: this.complete, newComplete: '' }
    }

    const newComplete = combined.slice(0, lastNewline + 1)
    this.leftover = combined.slice(lastNewline + 1)
    this.complete += newComplete
    return { completeText: this.complete, newComplete }
  }

  finish(): string {
    const tail = this.leftover + this.decoder.decode()
    this.leftover = ''
    this.complete += tail
    return this.complete
  }
}

export const hasRenderableAssPrefix = (text: string): boolean => {
  return /\[v4\+?\s*styles\]/i.test(text) && /\[events\]/i.test(text) && /^(dialogue|comment)\s*:/im.test(text)
}

export const collectAssFontNames = (fragment: string): string[] => {
  const names: string[] = []
  const styleMatches = fragment.matchAll(/^Style:[^,]*,([^,]+)/gm)
  for (const match of styleMatches) {
    const name = match[1].trim()
    if (name) names.push(name)
  }

  const fnMatches = fragment.matchAll(/\\fn([^\\}]*?)[\\}]/g)
  for (const match of fnMatches) {
    const name = match[1].trim()
    if (name) names.push(name)
  }
  return names
}

export const fetchBoundedAsset = async (url: string, options: FetchBoundedAssetOptions): Promise<Uint8Array> => {
  const label = options.label || 'Asset'
  const rangeChunkBytes = options.rangeChunkBytes ?? RANGE_CHUNK_BYTES
  const rangeConcurrency = options.rangeConcurrency ?? RANGE_CONCURRENCY
  const fetchImpl = options.fetchImpl ?? fetch
  const timeout = new AbortController()
  const run = new AbortController()
  const timeoutId = setTimeout(() => timeout.abort(), options.timeoutMs)
  const signal = mergeAbortSignals([options.signal, timeout.signal, run.signal])

  let offset = 0
  const emit = async (chunk: Uint8Array, total: number | null): Promise<void> => {
    if (chunk.byteLength === 0) return
    const chunkOffset = offset
    offset += chunk.byteLength
    if (offset > options.maxBytes) throw limitError(label)
    await options.onChunk?.(chunk, { offset: chunkOffset, total })
  }

  const get = (headers?: HeadersInit): Promise<Response> => fetchImpl(url, { signal, headers })

  const declaredTotal = (response: Response): number | null => {
    const total = Number(response.headers.get('content-length'))
    return Number.isFinite(total) ? total : null
  }

  const readFull = async (response: Response): Promise<Uint8Array> => {
    if (!response.ok) throw requestError(label, response.status)
    return readResponseBytes(response, {
      maxBytes: options.maxBytes,
      label,
      onChunk: (chunk) => emit(chunk, declaredTotal(response))
    })
  }

  try {
    let probe: Response
    try {
      probe = await get({ Range: `bytes=0-${Math.max(0, rangeChunkBytes - 1)}` })
    } catch (error) {
      if (timeout.signal.aborted || options.signal?.aborted || isAbortError(error)) throw error
      return readFull(await get())
    }
    const rangeIsUsable = probe.status === 206 && isIdentityEncoding(probe.headers.get('content-encoding'))

    if (!probe.ok && probe.status !== 206) {
      await probe.body?.cancel()
      if (probe.status === 400 || probe.status === 405 || probe.status === 416 || probe.status === 501) {
        return readFull(await get())
      }
      throw requestError(label, probe.status)
    }

    if (probe.status === 206 && !rangeIsUsable) {
      await probe.body?.cancel()
      return readFull(await get())
    }

    if (probe.status !== 206) {
      return readFull(probe)
    }

    const contentRange = parseContentRange(probe.headers.get('content-range') || '')
    if (contentRange?.total != null && contentRange.total > options.maxBytes) {
      await probe.body?.cancel()
      throw limitError(label)
    }

    const first = await readResponseBytes(probe, {
      maxBytes: options.maxBytes,
      label,
      onChunk: (chunk) => emit(chunk, contentRange?.total ?? null)
    })
    const pieces = [first]
    const knownTotal = contentRange?.total ?? null

    if (knownTotal != null && first.byteLength >= knownTotal) return first

    if (knownTotal != null) {
      const remaining = splitByteRanges(first.byteLength, knownTotal - 1, rangeChunkBytes)
      if (remaining.length === 0) return first

      const fetched = await mapPool(remaining, rangeConcurrency, async (range) => {
        const response = await get({ Range: `bytes=${range.start}-${range.end}` })
        if (response.status !== 206) {
          await response.body?.cancel()
          throw requestError(label, response.status)
        }
        const bytes = await readResponseBytes(response, {
          maxBytes: range.end - range.start + 1,
          label
        })
        return { range, bytes }
      })

      fetched.sort((a, b) => a.range.start - b.range.start)
      for (const part of fetched) {
        pieces.push(part.bytes)
        await emit(part.bytes, knownTotal)
      }
      return concatBytes(pieces)
    }

    while (offset < options.maxBytes) {
      const end = offset + rangeChunkBytes - 1
      const response = await get({ Range: `bytes=${offset}-${end}` })
      if (response.status === 416) {
        await response.body?.cancel()
        break
      }
      if (response.status !== 206) {
        await response.body?.cancel()
        throw requestError(label, response.status)
      }

      const nextRange = parseContentRange(response.headers.get('content-range') || '')
      if (nextRange?.total != null && nextRange.total > options.maxBytes) {
        await response.body?.cancel()
        throw limitError(label)
      }

      const chunk = await readResponseBytes(response, {
        maxBytes: options.maxBytes - offset,
        label,
        onChunk: (part) => emit(part, nextRange?.total ?? null)
      })
      if (chunk.byteLength === 0) break
      pieces.push(chunk)
      if (nextRange?.total != null && offset >= nextRange.total) break
    }

    return concatBytes(pieces)
  } catch (error) {
    run.abort()
    if (timeout.signal.aborted && !options.signal?.aborted) {
      throw new Error(`${label} request timed out`)
    }
    if (isAbortError(error)) throw error
    if (options.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
