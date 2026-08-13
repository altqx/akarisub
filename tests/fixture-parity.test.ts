import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { subtitleTimeForFrame } from '../src/ts/timing'

const fixtureDir = resolve(import.meta.dir, 'akarisub-test')
const videoPath = resolve(fixtureDir, 'KumoDesuGaNaniKa-ED1.webm')
const subtitlePath = resolve(fixtureDir, 'ED.ass')
const hasFixture = existsSync(videoPath) && existsSync(subtitlePath)

test.skipIf(!hasFixture)('samples the supplied Kumo cue boundary on the same frame as mpv', async () => {
  const cue = (await Bun.file(subtitlePath).text())
    .split(/\r?\n/)
    .find((line) => line.startsWith('Dialogue:') && line.includes(',0:00:07.30,Main,'))
  expect(cue).toBeDefined()

  const probe = Bun.spawnSync([
    'ffprobe',
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'format=start_time:packet=pts_time,dts_time',
    '-show_packets',
    '-of',
    'json',
    videoPath
  ])
  expect(probe.exitCode).toBe(0)

  const payload = JSON.parse(probe.stdout.toString()) as {
    format: { start_time: string }
    packets: Array<{ pts_time?: string; dts_time?: string }>
  }
  const framePts = [
    ...new Set(payload.packets.map((packet) => Number(packet.pts_time)).filter(Number.isFinite))
  ].sort((a, b) => a - b)
  const decodeOrigin = Math.min(
    ...payload.packets.map((packet) => Number(packet.dts_time)).filter(Number.isFinite)
  )
  const containerOrigin = Number(payload.format.start_time)
  const boundaryFrame = framePts.findIndex((pts) => Math.floor(pts * 1000 + 1e-7) >= 7_300)

  expect(containerOrigin).toBe(0)
  expect(decodeOrigin).toBeCloseTo(0.007)
  expect(framePts[boundaryFrame]).toBeCloseTo(7.306)

  const timeline = Object.assign(Float64Array.from(framePts, (pts) => pts - decodeOrigin), {
    mediaTimeOrigin: decodeOrigin,
    subtitleTimeOffset: containerOrigin - decodeOrigin
  })

  expect(Math.floor(timeline[boundaryFrame] * 1000 + 1e-7)).toBe(7_299)
  expect(subtitleTimeForFrame(timeline, boundaryFrame)).toBeCloseTo(7.306)
})
