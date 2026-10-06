import { MAX_SUBTITLE_BYTES } from './asset-loader'
import type { EncryptedSubtitleContent } from './types'

/** Version byte of chunked payloads whose AAD binds key ID, chunk index and chunk count. */
export const ENCRYPTED_CHUNK_VERSION = 3
export const ENCRYPTED_KEY_ID_SIZE = 8
export const ENCRYPTED_NONCE_SIZE = 12
export const ENCRYPTED_TAG_SIZE = 16
export const ENCRYPTED_CHUNK_INDEX_SIZE = 4
export const ENCRYPTED_CHUNK_AAD_SIZE = 1 + ENCRYPTED_KEY_ID_SIZE + 2 * ENCRYPTED_CHUNK_INDEX_SIZE
export const ENCRYPTED_CHUNK_HEADER_SIZE = ENCRYPTED_CHUNK_AAD_SIZE + ENCRYPTED_NONCE_SIZE
export const ENCRYPTED_V2_HEADER_SIZE = 1 + ENCRYPTED_KEY_ID_SIZE + ENCRYPTED_NONCE_SIZE
export const MAX_ENCRYPTED_CHUNKS = 1024
export const MAX_ENCRYPTED_CHUNK_BYTES = MAX_SUBTITLE_BYTES + ENCRYPTED_CHUNK_HEADER_SIZE + ENCRYPTED_TAG_SIZE
export const MAX_ENCRYPTED_TOTAL_BYTES =
  MAX_SUBTITLE_BYTES + MAX_ENCRYPTED_CHUNKS * (ENCRYPTED_CHUNK_HEADER_SIZE + ENCRYPTED_TAG_SIZE)
export const DECRYPT_CONCURRENCY = 4

const TEXT_ENCODER = new TextEncoder()

const tooLarge = (): Error => new Error(`Subtitle content exceeds the ${MAX_SUBTITLE_BYTES} byte limit`)

/** Encoded-byte length of caller-supplied subtitle content, without allocating for small strings. */
export const encodedLength = (content: string | Uint8Array | ArrayBuffer): number => {
  if (typeof content !== 'string') return content.byteLength
  // UTF-8 needs at most 3 bytes per UTF-16 code unit.
  if (content.length * 3 <= MAX_SUBTITLE_BYTES) return content.length * 3
  return TEXT_ENCODER.encode(content).byteLength
}

/** Reject over-budget subtitle bytes before any scan, copy, or native parse. */
export const assertSubtitleBudget = (content: string | Uint8Array | ArrayBuffer): void => {
  if (encodedLength(content) > MAX_SUBTITLE_BYTES) throw tooLarge()
}

/** Reject over-budget encrypted containers before any WebCrypto work. */
export const assertEncryptedBudget = (content: EncryptedSubtitleContent): void => {
  const { encrypted, encryptedChunks } = content
  if (encrypted && encryptedChunks) throw new Error('Provide either encrypted or encryptedChunks, not both')
  if (encrypted) {
    if (encrypted.byteLength > MAX_ENCRYPTED_CHUNK_BYTES) throw tooLarge()
    return
  }
  const chunks = encryptedChunks ?? []
  if (chunks.length > MAX_ENCRYPTED_CHUNKS) throw new Error('Encrypted subtitle has too many chunks')
  let total = 0
  for (const chunk of chunks) {
    if (chunk.byteLength > MAX_ENCRYPTED_CHUNK_BYTES) throw tooLarge()
    total += chunk.byteLength
    if (total > MAX_ENCRYPTED_TOTAL_BYTES) throw tooLarge()
  }
}

/** Live-track budgets. */
export const MAX_STREAM_PACKET_BYTES = 4 * 1024 * 1024
export const MAX_STREAM_EVENT_BATCH = 10_000
export const MAX_STREAM_EVENTS = 250_000
export const MAX_STREAM_PENDING_MESSAGES = 256
export const MAX_STREAM_PENDING_BYTES = 16 * 1024 * 1024
/** Seconds of already-ended cues kept when the caller does not choose a prune delay. */
export const DEFAULT_STREAM_PRUNE_SECONDS = 600

/** Approximate retained size of a message's payload, for backpressure accounting. */
export const streamingPayloadBytes = (content: string | Uint8Array | ArrayBuffer): number =>
  typeof content === 'string' ? content.length * 2 : content.byteLength

export const assertStreamingPacket = (content: string | Uint8Array | ArrayBuffer): void => {
  if (encodedLength(content) > MAX_STREAM_PACKET_BYTES) {
    throw new Error(`Streaming packet exceeds the ${MAX_STREAM_PACKET_BYTES} byte limit`)
  }
}

export const assertStreamingEventBatch = (events: readonly unknown[]): void => {
  if (events.length > MAX_STREAM_EVENT_BATCH) {
    throw new Error(`Streaming event batch exceeds ${MAX_STREAM_EVENT_BATCH} events`)
  }
}
