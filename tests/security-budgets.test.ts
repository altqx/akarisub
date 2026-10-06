import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { MAX_SUBTITLE_BYTES } from '../src/ts/asset-loader'
import { MAX_GPU_TEXTURE_ARRAY_BYTES, textureArrayLayerCap } from '../src/ts/gpu-budget'
import {
  MAX_ENCRYPTED_CHUNKS,
  MAX_STREAM_EVENT_BATCH,
  MAX_STREAM_PACKET_BYTES,
  assertEncryptedBudget,
  assertStreamingEventBatch,
  assertStreamingPacket,
  assertSubtitleBudget,
  resolveSubtitleLimit
} from '../src/ts/subtitle-budget'
import { fixPlayRes } from '../src/ts/utils'

const key = {} as CryptoKey
const digest = new Uint8Array(32)

describe('subtitle admission budget', () => {
  test('accepts content at the limit and rejects one byte over', () => {
    expect(() => assertSubtitleBudget(new Uint8Array(MAX_SUBTITLE_BYTES))).not.toThrow()
    expect(() => assertSubtitleBudget(new Uint8Array(MAX_SUBTITLE_BYTES + 1))).toThrow()
    expect(() => assertSubtitleBudget(new ArrayBuffer(MAX_SUBTITLE_BYTES + 1))).toThrow()
  })

  test('honors a caller-supplied limit', () => {
    const big = new Uint8Array(MAX_SUBTITLE_BYTES + 1)
    expect(() => assertSubtitleBudget(big, MAX_SUBTITLE_BYTES * 2)).not.toThrow()
    expect(() => assertSubtitleBudget(new Uint8Array(11), 10)).toThrow()
    expect(resolveSubtitleLimit(undefined)).toBe(MAX_SUBTITLE_BYTES)
    expect(resolveSubtitleLimit(64 * 1024 * 1024)).toBe(64 * 1024 * 1024)
    expect(() => resolveSubtitleLimit(0)).toThrow()
    expect(() => resolveSubtitleLimit(1.5)).toThrow()
  })

  test('measures strings by encoded bytes', () => {
    expect(() => assertSubtitleBudget('a'.repeat(1024))).not.toThrow()
    // Three UTF-8 bytes per character pushes this just over the limit.
    expect(() => assertSubtitleBudget('あ'.repeat(Math.floor(MAX_SUBTITLE_BYTES / 3) + 1))).toThrow()
  })
})

describe('encrypted container budget', () => {
  test('rejects too many chunks before any crypto work', () => {
    const chunks = Array.from({ length: MAX_ENCRYPTED_CHUNKS + 1 }, () => new ArrayBuffer(1))
    expect(() => assertEncryptedBudget({ contentKey: key, resourceDigest: digest, encryptedChunks: chunks })).toThrow()
  })

  test('rejects oversized chunks and aggregates', () => {
    expect(() =>
      assertEncryptedBudget({
        contentKey: key,
        resourceDigest: digest,
        encrypted: new ArrayBuffer(MAX_SUBTITLE_BYTES + 1024)
      })
    ).toThrow()
    const big = new ArrayBuffer(MAX_SUBTITLE_BYTES)
    expect(() =>
      assertEncryptedBudget({
        contentKey: key,
        resourceDigest: digest,
        encryptedChunks: [big, big, new ArrayBuffer(64)]
      })
    ).toThrow()
  })

  test('rejects ambiguous containers', () => {
    expect(() =>
      assertEncryptedBudget({
        contentKey: key,
        resourceDigest: digest,
        encrypted: new ArrayBuffer(1),
        encryptedChunks: []
      })
    ).toThrow()
  })
})

describe('streaming budgets', () => {
  test('bounds packets and event batches', () => {
    expect(() => assertStreamingPacket(new Uint8Array(MAX_STREAM_PACKET_BYTES))).not.toThrow()
    expect(() => assertStreamingPacket(new Uint8Array(MAX_STREAM_PACKET_BYTES + 1))).toThrow()
    expect(() => assertStreamingEventBatch(new Array(MAX_STREAM_EVENT_BATCH))).not.toThrow()
    expect(() => assertStreamingEventBatch(new Array(MAX_STREAM_EVENT_BATCH + 1))).toThrow()
  })
})

describe('GPU texture budget', () => {
  test('orthogonal plane maxima cannot exceed the byte budget', () => {
    const layers = textureArrayLayerCap(8192, 8192, 4, 256)
    expect(layers * 8192 * 8192 * 4).toBeLessThanOrEqual(MAX_GPU_TEXTURE_ARRAY_BYTES)
    expect(layers).toBeLessThan(256)
  })

  test('refuses a single layer larger than the budget', () => {
    expect(textureArrayLayerCap(16384, 16384, 4, 256)).toBe(0)
  })

  test('small planes keep the full layer limit', () => {
    expect(textureArrayLayerCap(256, 256, 4, 256)).toBe(256)
  })
})

describe('vector clip scaling', () => {
  const header = '[Script Info]\nPlayResX: 640\nPlayResY: 360\n[Events]\n'

  test('scales valid clip and drawing coordinates', () => {
    const out = fixPlayRes(
      `${header}Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\pos(1920,1080)\\clip(m 0 0 l 1920 1080)}x`
    )
    expect(out).toContain('\\clip(m 0 0 l 640 360)')
  })

  test('unterminated clips scale near-linearly', () => {
    const time = (n: number): number => {
      const text = `${header}Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\pos(1920,1080)\\clip(${'m'.repeat(n)}`
      const start = performance.now()
      fixPlayRes(text)
      return performance.now() - start
    }
    time(2000)
    const small = Math.max(time(20_000), 1)
    const large = time(80_000)
    expect(large / small).toBeLessThan(12)
  })
})

describe('release workflow', () => {
  const workflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8')

  test('pins every action to a full commit SHA', () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/)
  })

  test('grants no workflow-wide write or OIDC authority', () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m)
    const publish = workflow.slice(workflow.indexOf('\n  publish:'))
    expect(publish).toContain('id-token: write')
    expect(workflow.slice(0, workflow.indexOf('\n  publish:'))).not.toContain('id-token: write')
  })

  test('never interpolates step outputs into shell source', () => {
    for (const block of workflow.split(/\n\s+- /)) {
      const run = block.match(/\brun: \|?\n?([\s\S]*)/)?.[1]
      if (run) expect(run).not.toMatch(/\$\{\{\s*steps\./)
    }
  })
})
