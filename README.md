<h1 align="center">
  AkariSub
</h1>
<p align="center">
  JavaScript SSA/ASS Subtitle Renderer.
</p>

> **Note:** This is a fork of [ThaUnknown's JASSUB](https://github.com/ThaUnknown/jassub) legacy version with hyper optimizations, intelligent caching, and many quality-of-life improvements.

AkariSub is a JS wrapper for <a href="https://github.com/libass/libass">libass</a>, which renders <a href="https://en.wikipedia.org/wiki/SubStation_Alpha">SSA/ASS subtitles</a> directly in your browser. It uses Emscripten to compile libass' C++ code to WASM.

## Features

- Supports most SSA/ASS features (everything libass supports)
- Supports all OpenType, TrueType and WOFF fonts, as well as embedded fonts
- Supports anamorphic videos [(on browsers which support it)](https://caniuse.com/mdn-api_htmlvideoelement_requestvideoframecallback)
- Supports different video color spaces, including HDR / wide-gamut overlay [(on browsers which support it)](https://caniuse.com/mdn-api_videocolorspace)
- Capable of using local fonts [(on browsers which support it)](https://caniuse.com/mdn-api_window_querylocalfonts)
- Works fast (all the heavy lifting is done by WebAssembly)
- Is fully threaded (worker plus optional WASM pthreads on isolated pages)
- Is asynchronous (renders when available, not in order of execution)
- Benefits from hardware acceleration (uses hardware accelerated canvas API's)
- Doesn't manipulate the DOM to render subtitles
- Easy to use - just connect it to video element
- Optional WebCodecs `VideoFrame` clock for custom players and editors

### Fork Enhancements

- **GPU Rendering** - Hardware-accelerated rendering with an automatic fallback chain: WebGPU [(on browsers which support it)](https://caniuse.com/webgpu) → WebGL2 → Canvas2D
- **Hyper Optimizations** - Performance improvements and intelligent caching for smoother playback
- **Proper Fontconfig Implementation** - add Fontconfig support with multiple fallback fonts supported
- **Encrypted Subtitles** - optionally load AES-GCM encrypted subtitle payloads that are decrypted inside the worker, so plaintext never touches the main thread
- **Statistics Reporting** - Built-in statistics and performance metrics for debugging and monitoring
- **Atomic Track Switching** - `preloadTrack()` / `activatePreloadedTrack()` load a second language track and its fonts before swapping, so the last frame stays visible
- **Cue Callbacks** - `onCueEnter`, `onCueExit`, `onRender`, `onRendererChange`, and `onPerformanceWarning` for overlays and analytics without polling `getEvents()`
- **TypeScript Support** - Full TypeScript definitions and type safety
- **HDR / Wide Color Gamut** - Matches Display P3 / Rec.2020 canvases and PQ/HLG video, and converts BT.2020 YCbCr matrices
- **WASM SIMD + pthreads** - SIMD libass kernels in the default binary; optional `akarisub-mt.wasm` blends independent regions on isolated pages
- **Updated Dependencies** - All dependencies updated to their latest versions, including libass

## Installation

```bash
npm install akarisub
# or
bun add akarisub
```

For JSR:

```bash
deno add jsr:@altq/akarisub
```

## Usage

In most bundler-based projects, no manual worker setup is required. AkariSub resolves the WASM glue and binary relative to the package module URL, so bundlers such as Vite, webpack, and Rollup can emit the assets automatically.

```js
import AkariSub from 'akarisub'

const renderer = new AkariSub({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass'
})
```

If your app serves package files in a way that does not expose those emitted assets to the browser, you can still provide the public fallback by copying the WASM file and its JS glue to `/akarisub/`:

```bash
mkdir -p public/akarisub
cp node_modules/akarisub/pkg/akarisub.wasm node_modules/akarisub/pkg/akarisub.js public/akarisub/
```

The worker is created from the package module URL. `workerUrl`, `wasmUrl`, and `glueUrl` remain in the option type for overrides and do not need to be set in bundler-based apps.

## Using only with canvas

You're also able to use it without any video. However, that requires you to set the time the subtitles should render at yourself. Disable `onDemandRender` (it relies on video frame callbacks) and drive the clock manually:

```js
import AkariSub from 'akarisub'

const renderer = new AkariSub({
  canvas: document.querySelector('canvas'),
  subUrl: './tracks/sub.ass',
  onDemandRender: false
})

// setCurrentTime(isPaused?, currentTime?, rate?)
renderer.setCurrentTime(true, 15)
```

Custom canvases stay on the main thread by default. Set both `offscreenRender: true` and `rawAssImageGpu: true` to opt into worker WebGL2 raw-mask composition when dense overlays benefit from it.

### Timing semantics

AkariSub sends libass an integer millisecond timestamp. Fractional media times are floored to the current millisecond, matching libass's `Start <= now < Start + Duration` event boundaries. `timeOffset` and `renderAhead` are measured in seconds.

By default, `adaptiveTiming` predicts the media time at which a completed canvas paint will become visible, compensating bounded rendering and delivery latency. Pause and seek frames always use the exact media timestamp. Set `adaptiveTiming: false` when deterministic frame sampling is more important than compensating live presentation latency.

For frame-locked VOD playback, provide the encoded video's presentation timestamps in seconds. AkariSub prepares a small window of full subtitle bitmaps and commits the matching bitmap inside `requestVideoFrameCallback`, which keeps fast `\t` and `\move` animation sampling aligned with libass:

```js
const frameTimeline = new Float64Array([0, 0.041708, 0.083417])
const renderer = new AkariSub({
  video,
  subContent,
  frameTimeline,
  framePrefetch: 2
})

// Timelines can also arrive after renderer construction.
renderer.setFrameTimeline(frameTimeline)
renderer.setFrameTimeline(null) // return to adaptive continuous-time rendering
```

Use timestamps from the encoded rendition the browser plays, normalized to the browser media clock. Passing a timeline remains optional; cache misses and unsupported paths automatically use normal adaptive rendering.

If the browser timeline is normalized from decode time rather than the first display PTS, preserve that initial B-frame reorder gap in the array and set `frameTimeline.subtitleTimeOffset` to the first frame timestamp. AkariSub uses the unmodified array to locate the visible video frame, then removes the offset only when sampling libass.

`subtitleTimeOffset` is signed. When the source video starts after the container subtitle clock, subtract that source lead from the reorder offset. For example, an encoded reorder gap of `0.083422` seconds and a source video start of `0.007` seconds use `subtitleTimeOffset = 0.076422`, so the first displayed frame is sampled by libass at `0.007` just like mpv.

## Using with WebCodecs

Apps that decode with `VideoDecoder` instead of `HTMLVideoElement` can drive the same on-demand and frame-timeline path with each output `VideoFrame`. Pass a canvas, keep `onDemandRender` enabled, and present frames as they leave the decoder. AkariSub reads `timestamp` (microseconds), `displayWidth` / `displayHeight`, and `colorSpace` (`matrix`, `primaries`, `transfer`). HDR frames pick a Display P3 or Rec.2020 canvas when the browser can create one. It does not take ownership of the frame.

```js
import AkariSub, { frameTimelineFromTimestamps } from 'akarisub'

const renderer = new AkariSub({
  canvas: document.querySelector('canvas'),
  subUrl: './tracks/sub.ass',
  frameTimeline: frameTimelineFromTimestamps(packetTimestampsUs),
  onDemandRender: true
})

const decoder = new VideoDecoder({
  output(frame) {
    renderer.presentVideoFrame(frame, {
      expectedDisplayTime: performance.now(),
      isPaused: false,
      rate: 1
    })
    frame.close()
  },
  error(err) {
    console.error(err)
  }
})
```

Paused editor and offline-preview frames pass `isPaused: true` so libass samples that exact timestamp. `setVideoColorSpace()` can apply a matrix without presenting a frame. `frameTimelineFromVideoFrames()` builds a timeline from already-decoded frames.

In browsers without `requestVideoFrameCallback`, set `onDemandRender: true` explicitly so `presentVideoFrame` uses the demand path instead of the worker RAF loop.

## Changing subtitles

You're not limited to only display the subtitle file you referenced in your options. You're able to dynamically change subtitles on the fly. There's four methods that you can use for this specifically:

- `setTrackByUrl(url):` works the same as the `subUrl` option. It will set the subtitle to display by its URL.
- `setTrack(content):` works the same as the `subContent` option. It will set the subtitle to display by its content (string, `Uint8Array` or `ArrayBuffer`).
- `setEncryptedTrack(content):` works the same as the `encryptedSubContent` option. The payload is decrypted inside the worker, so plaintext subtitles are never materialized on the main thread.
- `freeTrack():` this simply removes the subtitles. You can use the methods above to set a new subtitle file to be displayed.

```js
renderer.setTrackByUrl('/newsub.ass')
```

For streaming players with multiple language tracks, preload the next file so the swap does not drop a frame or hitch on font load. The last painted frame stays on screen until the new track's first frame is ready:

```js
const ja = await renderer.preloadTrack({ kind: 'url', url: '/subs/ja.ass' })
await renderer.activatePreloadedTrack(ja.id)
```

`preloadTrack()` also accepts ASS text or bytes, `{ kind: 'content', content }`, or `{ kind: 'encrypted', content }`. `activatePreloadedTrack()` without an id uses the most recently preloaded track.

## Cleaning up the object

After you're finished with rendering the subtitles. You need to call the `destroy()` method to correctly destroy the object.

```js
const renderer = new AkariSub(options)
// After you've finished using it...
renderer.destroy()
```

## Performance Statistics

Get real-time performance metrics for debugging and monitoring:

```typescript
// Get performance statistics (Promise-based)
const stats = await renderer.getStats()
console.log(stats)
// Output:
// {
//   framesRendered: 120,
//   framesDropped: 2,
//   avgRenderTime: 1.45,
//   maxRenderTime: 8.32,
//   minRenderTime: 0.12,
//   lastRenderTime: 1.23,
//   timingCompensationMs: 4.8,
//   renderFps: 60,
//   usingWorker: true,
//   offscreenRender: true,
//   onDemandRender: true,
//   pendingRenders: 0,
//   totalEvents: 847,
//   cacheHits: 500,
//   cacheMisses: 120
// }

// Reset statistics counters
await renderer.resetStats()
console.log('Stats reset!')

// Get lightweight counts (doesn't fetch full event/style data)
const eventCount = await renderer.getEventCount()
const styleCount = await renderer.getStyleCount()
console.log(`Events: ${eventCount}, Styles: ${styleCount}`)
```

**Stats Reference:**

| Property               | Type    | Description                                                             |
| ---------------------- | ------- | ----------------------------------------------------------------------- |
| `framesRendered`       | number  | Total frames rendered since reset                                       |
| `framesDropped`        | number  | Frames dropped due to slow rendering                                    |
| `avgRenderTime`        | number  | Average render time in milliseconds                                     |
| `maxRenderTime`        | number  | Maximum render time in milliseconds                                     |
| `minRenderTime`        | number  | Minimum render time in milliseconds                                     |
| `lastRenderTime`       | number  | Most recent render time in milliseconds                                 |
| `timingCompensationMs` | number  | Automatically learned presentation-latency compensation in milliseconds |
| `renderFps`            | number  | Estimated render FPS based on timing                                    |
| `usingWorker`          | boolean | Whether using Web Worker                                                |
| `offscreenRender`      | boolean | Whether offscreen rendering is enabled                                  |
| `onDemandRender`       | boolean | Whether on-demand rendering is enabled                                  |
| `pendingRenders`       | number  | Number of pending render operations                                     |
| `totalEvents`          | number  | Total subtitle events in current track                                  |
| `cacheHits`            | number  | Number of cache hits (unchanged frames)                                 |
| `cacheMisses`          | number  | Number of cache misses (rendered frames)                                |

## GPU Rendering

AkariSub automatically picks the fastest available renderer: WebGPU → WebGL2 → Canvas2D. GPU renderers are used when no custom canvas is given and the browser supports them:

```typescript
import AkariSub from 'akarisub'

const renderer = new AkariSub({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass',
  onCanvasFallback: () => {
    console.log('No GPU renderer available, using Canvas2D fallback')
  }
})

console.log(renderer.rendererType) // 'webgpu' | 'webgl2' | 'canvas2d'

if (renderer.isUsingGPURenderer) {
  console.log('GPU-accelerated rendering enabled!')
}
```

## Options

The default options are best, and automatically fallback to the next fastest options in line, when the API's they use are unsupported. You can however forcefully change this behavior by specifying options.

| Option                 | Type                                 | Default                             | Description                                                                                                                                                |
| ---------------------- | ------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `video`                | HTMLVideoElement                     | -                                   | Video to use as target for rendering and event listeners. WebCodecs players pass `canvas` and call `presentVideoFrame` instead                             |
| `canvas`               | HTMLCanvasElement                    | -                                   | Canvas to use for manual handling (optional if video is provided)                                                                                          |
| `blendMode`            | `'js'` \| `'wasm'`                   | `'wasm'`                            | Image blending mode. WASM is better for low-end devices, JS for hardware acceleration                                                                      |
| `asyncRender`          | boolean                              | auto                                | Render via ImageBitmap. Defaults to `true` on Canvas2D paths and `false` when a GPU renderer is active (raw buffers upload with fewer copies) or on WebKit |
| `offscreenRender`      | boolean                              | automatic                           | Render fully on the worker; enabled for video-managed canvases and disabled for custom canvases                                                            |
| `rawAssImageGpu`       | boolean                              | `false`                             | Compose raw libass masks with worker WebGL2 when offscreen rendering is active                                                                             |
| `onDemandRender`       | boolean                              | `true`                              | Render subtitles as the video player or `presentVideoFrame` presents frames                                                                                |
| `adaptiveTiming`       | boolean                              | `true`                              | Compensate measured queue, worker, bitmap, IPC, and paint latency while video is playing; pause and seek renders remain frame-exact                        |
| `frameTimeline`        | FrameTimeline                        | -                                   | Encoded browser-frame timestamps plus optional media/subtitle clock offsets; enables frame-locked libass sampling                                          |
| `framePrefetch`        | number                               | `2`                                 | Number of exact subtitle-frame bitmaps to prepare ahead (`0` disables preparation, maximum `24`)                                                           |
| `targetFps`            | number                               | `24`                                | Target FPS when not using onDemandRender                                                                                                                   |
| `timeOffset`           | number                               | `0`                                 | Subtitle time offset in seconds                                                                                                                            |
| `debug`                | boolean                              | `false`                             | Enable debug logging                                                                                                                                       |
| `prescaleFactor`       | number                               | `1.0`                               | Scale factor for subtitles canvas                                                                                                                          |
| `prescaleHeightLimit`  | number                               | `1080`                              | Height limit for prescaling in pixels                                                                                                                      |
| `maxRenderHeight`      | number                               | `0`                                 | Maximum render height (0 = no limit)                                                                                                                       |
| `dropAllAnimations`    | boolean                              | `false`                             | Discard all animated tags for performance                                                                                                                  |
| `dropAllBlur`          | boolean                              | `false`                             | Drop all blur effects (~10x performance gain)                                                                                                              |
| `clampPos`             | boolean                              | `false`                             | Clamp `\pos` values to script resolution                                                                                                                   |
| `renderAhead`          | number                               | `0`                                 | Optional extra seconds to render ahead, in addition to adaptive timing; also applies when `onDemandRender` is disabled                                     |
| `workerUrl`            | string                               | package worker URL                  | Optional worker script URL. Defaults to the package worker module URL                                                                                      |
| `wasmUrl`              | string                               | package WASM URL                    | Optional WASM binary URL. Defaults to the URL resolved from `import.meta.url`                                                                              |
| `glueUrl`              | string                               | package glue URL                    | Optional WASM glue script URL. Defaults to the URL resolved from `import.meta.url`                                                                         |
| `modernWasmUrl`        | string                               | -                                   | Optional SIMD WASM URL used when the engine validates `v128`                                                                                               |
| `mtWasmUrl`            | string                               | package `akarisub-mt.wasm`          | Optional pthread SIMD WASM URL. Requires COOP/COEP (`crossOriginIsolated`)                                                                                 |
| `canvasColorSpace`     | `'srgb'` \| `'display-p3'` \| `'rec2020'` \| `'auto'` | `'auto'`               | Overlay canvas color space. `auto` follows the video primaries                                                                                             |
| `hdr`                  | boolean \| `'auto'`                  | `'auto'`                            | Request an HDR canvas when the video transfer is PQ or HLG                                                                                                 |
| `subUrl`               | string                               | -                                   | URL of the subtitle file to play                                                                                                                           |
| `subContent`           | string \| Uint8Array \| ArrayBuffer  | -                                   | Content of the subtitle file to play                                                                                                                       |
| `encryptedSubContent`  | EncryptedSubtitleContent             | -                                   | AES-GCM encrypted subtitle payload, decrypted inside the worker                                                                                            |
| `fonts`                | (string \| Uint8Array)[]             | -                                   | Array of font URLs or Uint8Arrays to force load                                                                                                            |
| `availableFonts`       | Record<string, string \| Uint8Array> | liberation sans from package assets | Available fonts map (lowercase name → URL/data)                                                                                                            |
| `fallbackFonts`        | string[]                             | `['liberation sans']`               | Fallback font families in order, used for the fontconfig cascade                                                                                           |
| `useLocalFonts`        | boolean                              | `true`                              | Use Local Font Access API if available                                                                                                                     |
| `libassMemoryLimit`    | number                               | `128`                               | libass bitmap cache memory limit in MiB                                                                                                                    |
| `libassGlyphLimit`     | number                               | `2048`                              | libass glyph cache limit                                                                                                                                   |
| `fullTrackWarmup`      | boolean                              | `false`                             | Pre-render early track windows after load to warm libass caches                                                                                            |
| `onCanvasFallback`     | function                             | -                                   | Callback when no GPU renderer is available (Canvas2D fallback)                                                                                             |
| `onCueEnter`           | `(cue) => void`                      | -                                   | Dialogue event became active at the sampled media time                                                                                                     |
| `onCueExit`            | `(cue) => void`                      | -                                   | Dialogue event is no longer active                                                                                                                         |
| `onRender`             | `(event) => void`                    | -                                   | Demand-frame render finished                                                                                                                               |
| `onRendererChange`     | `(event) => void`                    | -                                   | Compositor backend changed after construction                                                                                                              |
| `onPerformanceWarning` | `(warning) => void`                  | -                                   | Slow frame, dropped frames, or a full demand queue                                                                                                         |

## Methods

### Track Management

| Method                        | Parameters                                     | Description                                                                      |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `setTrackByUrl(url)`          | `url: string`                                  | Load subtitle from URL                                                           |
| `setTrack(content)`           | `content: string \| Uint8Array \| ArrayBuffer` | Set subtitle from content                                                        |
| `setEncryptedTrack(content)`  | `content: EncryptedSubtitleContent`            | Set subtitle from an encrypted payload (decrypted in the worker)                 |
| `freeTrack()`                 | -                                              | Remove current subtitles                                                         |
| `preloadTrack(source)`        | `PreloadTrackSource \| string \| bytes`        | Parse a track and load its fonts without replacing the visible one               |
| `activatePreloadedTrack(id?)` | `id?: number`                                  | Atomically swap to a preloaded track; last frame stays until the first new paint |

### Playback Control

| Method                                           | Parameters                                                  | Description                                   |
| ------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| `setIsPaused(isPaused)`                          | `isPaused: boolean`                                         | Set playback pause state                      |
| `setRate(rate)`                                  | `rate: number`                                              | Set playback rate (speed multiplier)          |
| `setCurrentTime(isPaused?, currentTime?, rate?)` | `isPaused?: boolean, currentTime?: number, rate?: number`   | Set current time, playback state and rate     |
| `setFrameTimeline(frameTimes)`                   | `ArrayLike<number> \| null`                                 | Replace or disable the encoded-frame timeline |
| `presentVideoFrame(frame, options?)`             | `frame: VideoFrame, options?: PresentVideoFrameOptions`     | Present a WebCodecs frame as the video clock  |
| `setVideoColorSpace(colorSpace)`                 | `BT709` \| `BT601` \| `BT2020` \| matrix name \| `colorSpace` \| `null` | Set the video YCbCr matrix and optional HDR primaries/transfer |

### Video & Canvas

| Method                                         | Parameters                                                                      | Description                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `setVideo(video)`                              | `video: HTMLVideoElement`                                                       | Change target video element. Clears a WebCodecs frame clock |
| `resize(width?, height?, top?, left?, force?)` | `width?: number, height?: number, top?: number, left?: number, force?: boolean` | Resize the canvas                                           |

### Cue and render callbacks

Option callbacks and matching `EventTarget` events (`cueEnter`, `cueExit`, `render`, `rendererChange`, `performanceWarning`) fire from the worker clock. Use them for chapter markers, character overlays, or analytics instead of polling `getEvents()`:

```ts
const renderer = new AkariSub({
  video,
  subUrl: '/subs/en.ass',
  onCueEnter: (cue) => showCharacter(cue.name, cue.text),
  onCueExit: (cue) => hideCharacter(cue.index),
  onRender: (event) => recordSubtitleFrame(event.time, event.renderTimeMs),
  onPerformanceWarning: (warning) => {
    if (warning.kind === 'slow-frame') console.warn('slow subtitle frame', warning.renderTimeMs)
  }
})

renderer.addEventListener('rendererChange', (event) => {
  console.log('compositor', event.detail.rendererType)
})
```

`CueEvent.start` and `CueEvent.duration` are seconds on the subtitle clock, matching `video.currentTime` plus `timeOffset`. Encrypted tracks omit `name` and `text`.

### Event Management

| Method                   | Parameters                                | Returns               | Description                   |
| ------------------------ | ----------------------------------------- | --------------------- | ----------------------------- |
| `createEvent(event)`     | `event: Partial<ASSEvent>`                | `void`                | Create a new ASS event        |
| `setEvent(event, index)` | `event: Partial<ASSEvent>, index: number` | `void`                | Overwrite event at index      |
| `removeEvent(index)`     | `index: number`                           | `void`                | Remove event at index         |
| `getEvents()`            | -                                         | `Promise<ASSEvent[]>` | Get all ASS events            |
| `getEventCount()`        | -                                         | `Promise<number>`     | Get event count (lightweight) |

### Style Management

| Method                   | Parameters                                | Returns               | Description                   |
| ------------------------ | ----------------------------------------- | --------------------- | ----------------------------- |
| `createStyle(style)`     | `style: Partial<ASSStyle>`                | `void`                | Create a new ASS style        |
| `setStyle(style, index)` | `style: Partial<ASSStyle>, index: number` | `void`                | Overwrite style at index      |
| `removeStyle(index)`     | `index: number`                           | `void`                | Remove style at index         |
| `getStyles()`            | -                                         | `Promise<ASSStyle[]>` | Get all ASS styles            |
| `getStyleCount()`        | -                                         | `Promise<number>`     | Get style count (lightweight) |
| `styleOverride(style)`   | `style: Partial<ASSStyle>`                | `void`                | Set a style override          |
| `disableStyleOverride()` | -                                         | `void`                | Disable style override        |

### Font Management

| Method                 | Parameters                   | Description                    |
| ---------------------- | ---------------------------- | ------------------------------ |
| `addFont(font)`        | `font: string \| Uint8Array` | Add a font to the renderer     |
| `setDefaultFont(font)` | `font: string`               | Change the default font family |

### Statistics & Debugging

| Method            | Parameters | Returns                     | Description                   |
| ----------------- | ---------- | --------------------------- | ----------------------------- |
| `getStats()`      | -          | `Promise<PerformanceStats>` | Get performance statistics    |
| `resetStats()`    | -          | `Promise<void>`             | Reset statistics counters     |
| `getEventCount()` | -          | `Promise<number>`           | Get event count (lightweight) |
| `getStyleCount()` | -          | `Promise<number>`           | Get style count (lightweight) |

### Lifecycle

| Method                                      | Parameters                                                                  | Description                      |
| ------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| `destroy(err?)`                             | `err?: Error \| string`                                                     | Destroy the renderer and cleanup |
| `sendMessage(target, data?, transferable?)` | `target: string, data?: Record<string, any>, transferable?: Transferable[]` | Send data to worker              |

## Properties

| Property              | Type                                     | Description                                                   |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `debug`               | boolean                                  | Enable/disable debug logging                                  |
| `prescaleFactor`      | number                                   | Scale factor for subtitles                                    |
| `prescaleHeightLimit` | number                                   | Height limit for prescaling                                   |
| `maxRenderHeight`     | number                                   | Maximum render height                                         |
| `timeOffset`          | number                                   | Subtitle time offset in seconds                               |
| `renderAhead`         | number                                   | Optional extra seconds to render ahead of the video clock     |
| `framePrefetch`       | number                                   | Number of exact subtitle frames prepared ahead                |
| `busy`                | boolean                                  | Whether the renderer is currently busy                        |
| `rendererType`        | `'webgpu'` \| `'webgl2'` \| `'canvas2d'` | Active renderer backend (read-only)                           |
| `isUsingGPURenderer`  | boolean                                  | Whether a hardware-accelerated renderer is active (read-only) |
| `isUsingWebGPU`       | boolean                                  | _Deprecated_ - use `rendererType === 'webgpu'`                |

## Type Definitions

### ASSEvent

| Property    | Type   | Description                      |
| ----------- | ------ | -------------------------------- |
| `Start`     | number | Start time in milliseconds       |
| `Duration`  | number | Duration in milliseconds         |
| `Style`     | string | Style name                       |
| `Name`      | string | Character name (informational)   |
| `MarginL`   | number | Left margin override in pixels   |
| `MarginR`   | number | Right margin override in pixels  |
| `MarginV`   | number | Bottom margin override in pixels |
| `Effect`    | string | Transition effect                |
| `Text`      | string | Subtitle text content            |
| `ReadOrder` | number | Read order number                |
| `Layer`     | number | Z-index layer                    |
| `_index`    | number | Internal index (optional)        |

### ASSStyle

| Property                    | Type   | Description                                         |
| --------------------------- | ------ | --------------------------------------------------- |
| `Name`                      | string | Style name (case sensitive)                         |
| `FontName`                  | string | Font family name                                    |
| `FontSize`                  | number | Font size                                           |
| `PrimaryColour`             | number | Primary color (RGBA as uint32)                      |
| `SecondaryColour`           | number | Secondary color (RGBA as uint32)                    |
| `OutlineColour`             | number | Outline color (RGBA as uint32)                      |
| `BackColour`                | number | Background/shadow color (RGBA as uint32)            |
| `Bold`                      | number | Bold (-1 = true, 0 = false)                         |
| `Italic`                    | number | Italic (-1 = true, 0 = false)                       |
| `Underline`                 | number | Underline (-1 = true, 0 = false)                    |
| `StrikeOut`                 | number | StrikeOut (-1 = true, 0 = false)                    |
| `ScaleX`                    | number | Width scale (percent)                               |
| `ScaleY`                    | number | Height scale (percent)                              |
| `Spacing`                   | number | Extra spacing between characters (pixels)           |
| `Angle`                     | number | Rotation angle (degrees)                            |
| `BorderStyle`               | number | Border style (1 = outline + shadow, 3 = opaque box) |
| `Outline`                   | number | Outline width (0-4 pixels)                          |
| `Shadow`                    | number | Shadow depth (0-4 pixels)                           |
| `Alignment`                 | number | Alignment (1-9, numpad style)                       |
| `MarginL`                   | number | Left margin (pixels)                                |
| `MarginR`                   | number | Right margin (pixels)                               |
| `MarginV`                   | number | Vertical margin (pixels)                            |
| `Encoding`                  | number | Font encoding                                       |
| `treat_fontname_as_pattern` | number | Treat font name as pattern                          |
| `Blur`                      | number | Blur amount                                         |
| `Justify`                   | number | Text justification                                  |

# How to build?

## Dependencies

[mise](https://mise.jdx.dev) manages the toolchain (emsdk, bun, cmake — see `mise.toml`). You additionally need the usual autotools build dependencies:

- git
- make
- python3
- pkgconfig
- patch
- libtool
- autotools (autoconf, automake, autopoint)
- gettext
- ragel - Required by Harfbuzz
- itstool - Required by Fontconfig
- gperf - Required by Fontconfig

## Get the Source

```bash
git clone --recursive https://github.com/altqx/akarisub.git
```

## Build

```bash
mise install      # installs emsdk, bun, cmake
bun install       # JS dependencies
make              # builds the static libs (fribidi, freetype, harfbuzz, fontconfig, libass, ...) and the WASM glue
bun run build     # builds the WASM glue and TypeScript
```

- If on macOS with libtool from brew, `LIBTOOLIZE=glibtoolize make`
- Incremental rebuilds of the WASM glue only: `bun run build:wasm` (or `make workers`)
- Artifacts are in `pkg/` (WASM glue and binary) and `dist/` (TypeScript)
