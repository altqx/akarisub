import type { StreamingTrackFormat, StreamingTrackOptions } from './types'

const isSubtitleBytes = (value: unknown): value is string | Uint8Array | ArrayBuffer => {
  return typeof value === 'string' || value instanceof Uint8Array || value instanceof ArrayBuffer
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value != null && typeof value === 'object'
}

/** Normalize {@linkcode AkariSub.initStreamingTrack} arguments. */
export const parseStreamingTrackOptions = (input: unknown): StreamingTrackOptions => {
  if (input == null) return { format: 'ass' }
  if (isSubtitleBytes(input)) return { header: input, format: 'ass' }
  if (!isRecord(input)) throw new Error('Invalid streaming track options')

  const format: StreamingTrackFormat = input.format === 'matroska' ? 'matroska' : 'ass'
  const header = input.header
  if (header != null && !isSubtitleBytes(header)) {
    throw new Error('Invalid streaming track options')
  }

  let pruneDelay: number | null | undefined
  if (input.pruneDelay === null) pruneDelay = null
  else if (input.pruneDelay != null) {
    const value = Number(input.pruneDelay)
    if (!Number.isFinite(value)) throw new Error('Invalid streaming track options')
    pruneDelay = value
  }

  let checkReadOrder: boolean | undefined
  if (input.checkReadOrder != null) checkReadOrder = Boolean(input.checkReadOrder)

  return {
    header: header as StreamingTrackOptions['header'],
    format,
    pruneDelay,
    checkReadOrder
  }
}
