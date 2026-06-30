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
- Supports different video color spaces [(on browsers which support it)](https://caniuse.com/mdn-api_videocolorspace)
- Capable of using local fonts [(on browsers which support it)](https://caniuse.com/mdn-api_window_querylocalfonts)
- Works fast (all the heavy lifting is done by WebAssembly)
- Is fully threaded (on browsers which support it, it's capable of working fully on a separate thread)
- Is asynchronous (renders when available, not in order of execution)
- Benefits from hardware acceleration (uses hardware accelerated canvas API's)
- Doesn't manipulate the DOM to render subtitles
- Easy to use - just connect it to video element

### Fork Enhancements

- **GPU Rendering** - Hardware-accelerated rendering with an automatic fallback chain: WebGPU [(on browsers which support it)](https://caniuse.com/webgpu) → WebGL2 → Canvas2D
- **Hyper Optimizations** - Performance improvements and intelligent caching for smoother playback
- **Proper Fontconfig Implementation** - add Fontconfig support with multiple fallback fonts supported
- **Encrypted Subtitles** - optionally load AES-GCM encrypted subtitle payloads that are decrypted inside the worker, so plaintext never touches the main thread
- **Statistics Reporting** - Built-in statistics and performance metrics for debugging and monitoring
- **TypeScript Support** - Full TypeScript definitions and type safety
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

By default all you need to do is copy the files from the `dist/` folder of the repository into the same folder as where your JS runs, then do:

```js
import AkariSub from './index.js'

const renderer = new AkariSub({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass'
})
```

`Note:` while the `dist/` folder includes a UMD dist it still uses modern syntax. If you want backwards compatibility with older browsers I recommend you run it tru babel.

If you use a bundler like Vite, you can instead do:

```js
import AkariSub from 'akarisub'
import workerUrl from 'akarisub/worker?url'
import wasmUrl from 'akarisub/worker.wasm?url'

const renderer = new AkariSub({
  video: document.querySelector('video'),
  subContent: subtitleString,
  workerUrl,
  wasmUrl
})
```

## Using only with canvas

You're also able to use it without any video. However, that requires you to set the time the subtitles should render at yourself. Disable `onDemandRender` (it relies on video frame callbacks) and drive the clock manually:

```js
import AkariSub from './index.js'

const renderer = new AkariSub({
  canvas: document.querySelector('canvas'),
  subUrl: './tracks/sub.ass',
  onDemandRender: false
})

// setCurrentTime(isPaused?, currentTime?, rate?)
renderer.setCurrentTime(true, 15)
```

## Changing subtitles

You're not limited to only display the subtitle file you referenced in your options. You're able to dynamically change subtitles on the fly. There's four methods that you can use for this specifically:

- `setTrackByUrl(url):` works the same as the `subUrl` option. It will set the subtitle to display by its URL.
- `setTrack(content):` works the same as the `subContent` option. It will set the subtitle to display by its content (string, `Uint8Array` or `ArrayBuffer`).
- `setEncryptedTrack(content):` works the same as the `encryptedSubContent` option. The payload is decrypted inside the worker, so plaintext subtitles are never materialized on the main thread.
- `freeTrack():` this simply removes the subtitles. You can use the methods above to set a new subtitle file to be displayed.

```js
renderer.setTrackByUrl('/newsub.ass')
```

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

| Property | Type | Description |
|----------|------|-------------|
| `framesRendered` | number | Total frames rendered since reset |
| `framesDropped` | number | Frames dropped due to slow rendering |
| `avgRenderTime` | number | Average render time in milliseconds |
| `maxRenderTime` | number | Maximum render time in milliseconds |
| `minRenderTime` | number | Minimum render time in milliseconds |
| `lastRenderTime` | number | Most recent render time in milliseconds |
| `renderFps` | number | Estimated render FPS based on timing |
| `usingWorker` | boolean | Whether using Web Worker |
| `offscreenRender` | boolean | Whether offscreen rendering is enabled |
| `onDemandRender` | boolean | Whether on-demand rendering is enabled |
| `pendingRenders` | number | Number of pending render operations |
| `totalEvents` | number | Total subtitle events in current track |
| `cacheHits` | number | Number of cache hits (unchanged frames) |
| `cacheMisses` | number | Number of cache misses (rendered frames) |

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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `video` | HTMLVideoElement | - | Video to use as target for rendering and event listeners |
| `canvas` | HTMLCanvasElement | - | Canvas to use for manual handling (optional if video is provided) |
| `blendMode` | `'js'` \| `'wasm'` | `'wasm'` | Image blending mode. WASM is better for low-end devices, JS for hardware acceleration |
| `asyncRender` | boolean | auto | Render via ImageBitmap. Defaults to `true` on Canvas2D paths and `false` when a GPU renderer is active (raw buffers upload with fewer copies) or on WebKit |
| `offscreenRender` | boolean | `true` | Render fully on the worker, greatly reduces CPU usage |
| `onDemandRender` | boolean | `true` | Render subtitles as the video player renders frames |
| `targetFps` | number | `24` | Target FPS when not using onDemandRender |
| `timeOffset` | number | `0` | Subtitle time offset in seconds |
| `debug` | boolean | `false` | Enable debug logging |
| `prescaleFactor` | number | `1.0` | Scale factor for subtitles canvas |
| `prescaleHeightLimit` | number | `1080` | Height limit for prescaling in pixels |
| `maxRenderHeight` | number | `0` | Maximum render height (0 = no limit) |
| `dropAllAnimations` | boolean | `false` | Discard all animated tags for performance |
| `dropAllBlur` | boolean | `false` | Drop all blur effects (~10x performance gain) |
| `clampPos` | boolean | `false` | Clamp `\pos` values to script resolution |
| `renderAhead` | number | `0` | Optional extra seconds to render ahead; normally leave at 0 because RVFC `mediaTime` is already frame-aligned |
| `workerUrl` | string | `'akarisub-worker.js'` | URL to the worker script |
| `wasmUrl` | string | `'akarisub-worker.wasm'` | URL to the WASM binary |
| `subUrl` | string | - | URL of the subtitle file to play |
| `subContent` | string \| Uint8Array \| ArrayBuffer | - | Content of the subtitle file to play |
| `encryptedSubContent` | EncryptedSubtitleContent | - | AES-GCM encrypted subtitle payload, decrypted inside the worker |
| `fonts` | (string \| Uint8Array)[] | - | Array of font URLs or Uint8Arrays to force load |
| `availableFonts` | Record<string, string \| Uint8Array> | `{'liberation sans': './default.woff2'}` | Available fonts map (lowercase name → URL/data) |
| `fallbackFonts` | string[] | `['liberation sans']` | Fallback font families in order, used for the fontconfig cascade |
| `useLocalFonts` | boolean | `true` | Use Local Font Access API if available |
| `libassMemoryLimit` | number | `128` | libass bitmap cache memory limit in MiB |
| `libassGlyphLimit` | number | `2048` | libass glyph cache limit |
| `fullTrackWarmup` | boolean | `false` | Pre-render early track windows after load to warm libass caches |
| `onCanvasFallback` | function | - | Callback when no GPU renderer is available (Canvas2D fallback) |

## Methods

### Track Management

| Method | Parameters | Description |
|--------|------------|-------------|
| `setTrackByUrl(url)` | `url: string` | Load subtitle from URL |
| `setTrack(content)` | `content: string \| Uint8Array \| ArrayBuffer` | Set subtitle from content |
| `setEncryptedTrack(content)` | `content: EncryptedSubtitleContent` | Set subtitle from an encrypted payload (decrypted in the worker) |
| `freeTrack()` | - | Remove current subtitles |

### Playback Control

| Method | Parameters | Description |
|--------|------------|-------------|
| `setIsPaused(isPaused)` | `isPaused: boolean` | Set playback pause state |
| `setRate(rate)` | `rate: number` | Set playback rate (speed multiplier) |
| `setCurrentTime(isPaused?, currentTime?, rate?)` | `isPaused?: boolean, currentTime?: number, rate?: number` | Set current time, playback state and rate |

### Video & Canvas

| Method | Parameters | Description |
|--------|------------|-------------|
| `setVideo(video)` | `video: HTMLVideoElement` | Change target video element |
| `resize(width?, height?, top?, left?, force?)` | `width?: number, height?: number, top?: number, left?: number, force?: boolean` | Resize the canvas |

### Event Management

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `createEvent(event)` | `event: Partial<ASSEvent>` | `void` | Create a new ASS event |
| `setEvent(event, index)` | `event: Partial<ASSEvent>, index: number` | `void` | Overwrite event at index |
| `removeEvent(index)` | `index: number` | `void` | Remove event at index |
| `getEvents()` | - | `Promise<ASSEvent[]>` | Get all ASS events |
| `getEventCount()` | - | `Promise<number>` | Get event count (lightweight) |

### Style Management

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `createStyle(style)` | `style: Partial<ASSStyle>` | `void` | Create a new ASS style |
| `setStyle(style, index)` | `style: Partial<ASSStyle>, index: number` | `void` | Overwrite style at index |
| `removeStyle(index)` | `index: number` | `void` | Remove style at index |
| `getStyles()` | - | `Promise<ASSStyle[]>` | Get all ASS styles |
| `getStyleCount()` | - | `Promise<number>` | Get style count (lightweight) |
| `styleOverride(style)` | `style: Partial<ASSStyle>` | `void` | Set a style override |
| `disableStyleOverride()` | - | `void` | Disable style override |

### Font Management

| Method | Parameters | Description |
|--------|------------|-------------|
| `addFont(font)` | `font: string \| Uint8Array` | Add a font to the renderer |
| `setDefaultFont(font)` | `font: string` | Change the default font family |

### Statistics & Debugging

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `getStats()` | - | `Promise<PerformanceStats>` | Get performance statistics |
| `resetStats()` | - | `Promise<void>` | Reset statistics counters |
| `getEventCount()` | - | `Promise<number>` | Get event count (lightweight) |
| `getStyleCount()` | - | `Promise<number>` | Get style count (lightweight) |

### Lifecycle

| Method | Parameters | Description |
|--------|------------|-------------|
| `destroy(err?)` | `err?: Error \| string` | Destroy the renderer and cleanup |
| `sendMessage(target, data?, transferable?)` | `target: string, data?: Record<string, any>, transferable?: Transferable[]` | Send data to worker |

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `debug` | boolean | Enable/disable debug logging |
| `prescaleFactor` | number | Scale factor for subtitles |
| `prescaleHeightLimit` | number | Height limit for prescaling |
| `maxRenderHeight` | number | Maximum render height |
| `timeOffset` | number | Subtitle time offset in seconds |
| `renderAhead` | number | Optional extra seconds to render ahead of the video clock |
| `busy` | boolean | Whether the renderer is currently busy |
| `rendererType` | `'webgpu'` \| `'webgl2'` \| `'canvas2d'` | Active renderer backend (read-only) |
| `isUsingGPURenderer` | boolean | Whether a hardware-accelerated renderer is active (read-only) |
| `isUsingWebGPU` | boolean | *Deprecated* - use `rendererType === 'webgpu'` |

## Type Definitions

### ASSEvent

| Property | Type | Description |
|----------|------|-------------|
| `Start` | number | Start time in milliseconds |
| `Duration` | number | Duration in milliseconds |
| `Style` | string | Style name |
| `Name` | string | Character name (informational) |
| `MarginL` | number | Left margin override in pixels |
| `MarginR` | number | Right margin override in pixels |
| `MarginV` | number | Bottom margin override in pixels |
| `Effect` | string | Transition effect |
| `Text` | string | Subtitle text content |
| `ReadOrder` | number | Read order number |
| `Layer` | number | Z-index layer |
| `_index` | number | Internal index (optional) |

### ASSStyle

| Property | Type | Description |
|----------|------|-------------|
| `Name` | string | Style name (case sensitive) |
| `FontName` | string | Font family name |
| `FontSize` | number | Font size |
| `PrimaryColour` | number | Primary color (RGBA as uint32) |
| `SecondaryColour` | number | Secondary color (RGBA as uint32) |
| `OutlineColour` | number | Outline color (RGBA as uint32) |
| `BackColour` | number | Background/shadow color (RGBA as uint32) |
| `Bold` | number | Bold (-1 = true, 0 = false) |
| `Italic` | number | Italic (-1 = true, 0 = false) |
| `Underline` | number | Underline (-1 = true, 0 = false) |
| `StrikeOut` | number | StrikeOut (-1 = true, 0 = false) |
| `ScaleX` | number | Width scale (percent) |
| `ScaleY` | number | Height scale (percent) |
| `Spacing` | number | Extra spacing between characters (pixels) |
| `Angle` | number | Rotation angle (degrees) |
| `BorderStyle` | number | Border style (1 = outline + shadow, 3 = opaque box) |
| `Outline` | number | Outline width (0-4 pixels) |
| `Shadow` | number | Shadow depth (0-4 pixels) |
| `Alignment` | number | Alignment (1-9, numpad style) |
| `MarginL` | number | Left margin (pixels) |
| `MarginR` | number | Right margin (pixels) |
| `MarginV` | number | Vertical margin (pixels) |
| `Encoding` | number | Font encoding |
| `treat_fontname_as_pattern` | number | Treat font name as pattern |
| `Blur` | number | Blur amount |
| `Justify` | number | Text justification |

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
make              # builds the static libs (fribidi, freetype, harfbuzz, fontconfig, libass, ...) and the WASM worker
bun run build     # builds the WASM worker, TypeScript declarations and JS bundles
```

- If on macOS with libtool from brew, `LIBTOOLIZE=glibtoolize make`
- Incremental rebuilds of the worker only: `bun run build:wasm` (or `make worker`)
- Artifacts are in `dist/`
