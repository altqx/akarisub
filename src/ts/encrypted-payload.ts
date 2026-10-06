import {
  DECRYPT_CONCURRENCY,
  ENCRYPTED_CHUNK_AAD_SIZE,
  ENCRYPTED_CHUNK_HEADER_SIZE,
  ENCRYPTED_CHUNK_INDEX_SIZE,
  ENCRYPTED_KEY_ID_SIZE,
  ENCRYPTED_RESOURCE_DIGEST_SIZE,
  ENCRYPTED_TAG_SIZE,
  ENCRYPTED_VERSION,
  assertEncryptedBudget
} from './subtitle-budget'
import type { EncryptedSubtitleContent } from './types'

export const decryptV3 = async (
  encrypted: ArrayBuffer,
  contentKey: CryptoKey,
  resourceDigest: Uint8Array,
  expectIndex: number,
  expectCount: number,
  keyId: { value: string | null }
): Promise<Uint8Array> => {
  const data = new Uint8Array(encrypted)
  if (data.length < ENCRYPTED_CHUNK_HEADER_SIZE + ENCRYPTED_TAG_SIZE) {
    throw new Error('Ciphertext too short for encrypted subtitle payload')
  }
  if (data[0] !== ENCRYPTED_VERSION) {
    throw new Error('Unsupported encrypted subtitle version')
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const index = view.getUint32(1 + ENCRYPTED_KEY_ID_SIZE)
  const count = view.getUint32(1 + ENCRYPTED_KEY_ID_SIZE + ENCRYPTED_CHUNK_INDEX_SIZE)
  if (index !== expectIndex || count !== expectCount) {
    throw new Error('Encrypted subtitle chunk is out of sequence')
  }

  const id = Array.from(data.subarray(1, 1 + ENCRYPTED_KEY_ID_SIZE), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  if (keyId.value === null) keyId.value = id
  else if (keyId.value !== id) throw new Error('Encrypted subtitle chunks use different keys')

  const aad = new Uint8Array(ENCRYPTED_CHUNK_AAD_SIZE + ENCRYPTED_RESOURCE_DIGEST_SIZE)
  aad.set(data.subarray(0, ENCRYPTED_CHUNK_AAD_SIZE))
  aad.set(resourceDigest, ENCRYPTED_CHUNK_AAD_SIZE)
  const nonce = data.slice(ENCRYPTED_CHUNK_AAD_SIZE, ENCRYPTED_CHUNK_HEADER_SIZE)
  const ciphertext = data.slice(ENCRYPTED_CHUNK_HEADER_SIZE)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
    contentKey,
    ciphertext
  )
  return new Uint8Array(decrypted)
}

export const decryptEncryptedContent = async (
  content: EncryptedSubtitleContent,
  maxSubtitleBytes: number
): Promise<Uint8Array> => {
  assertEncryptedBudget(content, maxSubtitleBytes)
  // Copy so views with a byte offset work and later mutation by the host cannot change the AAD.
  const d = content.resourceDigest
  const resourceDigest = new Uint8Array(d.buffer, d.byteOffset, ENCRYPTED_RESOURCE_DIGEST_SIZE).slice()

  if (content.encrypted) {
    const plain = await decryptV3(content.encrypted, content.contentKey, resourceDigest, 0, 1, { value: null })
    if (plain.byteLength > maxSubtitleBytes) {
      plain.fill(0)
      throw new Error('Decrypted subtitle exceeds the size limit')
    }
    return plain
  }

  const chunks = content.encryptedChunks || []
  if (chunks.length === 0) {
    throw new Error('Encrypted subtitle content is empty')
  }

  const totalChunks = content.chunkCount ?? chunks.length
  const decryptedChunks: Uint8Array[] = new Array(chunks.length)
  const keyId = { value: null as string | null }
  let next = 0
  let total = 0
  let failure: unknown = null

  const worker = async (): Promise<void> => {
    while (failure === null) {
      const index = next++
      if (index >= chunks.length) return
      try {
        const plain = await decryptV3(chunks[index], content.contentKey, resourceDigest, index, totalChunks, keyId)
        decryptedChunks[index] = plain
        total += plain.byteLength
        if (total > maxSubtitleBytes) throw new Error('Decrypted subtitle exceeds the size limit')
      } catch (error) {
        failure ??= error
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(DECRYPT_CONCURRENCY, chunks.length) }, worker))
    if (failure !== null) throw failure

    const result = new Uint8Array(total)
    let offset = 0
    for (const chunk of decryptedChunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  } finally {
    for (const chunk of decryptedChunks) chunk?.fill(0)
  }
}
