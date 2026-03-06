<h1 align="center">
  AkariSub
</h1>
<p align="center">
  JavaScript SSA/ASS Subtitle Renderer.
</p>

AkariSub is a JS wrapper around a Rust-powered <a href="https://github.com/libass/libass">libass</a> runtime, which renders <a href="https://en.wikipedia.org/wiki/SubStation_Alpha">SSA/ASS subtitles</a> directly in your browser. It uses WebAssembly for rendering, worker offload, and GPU-friendly browser integration.

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
- Supports Canvas2D, WebGL2, and WebGPU rendering backends with automatic fallback
- Supports OffscreenCanvas worker rendering when available
- Provides event/style editing, style override, and runtime font management APIs
- Includes built-in statistics reporting for performance monitoring
- Ships first-class TypeScript definitions

## Installation

**npm / bun**

```bash
npm install akarisub
# or
bun add akarisub
```

## Usage

### High-Level API (Video Integration)

The high-level API handles video synchronization, canvas overlay creation, resize handling, and subtitle loading for you.

```typescript
import AkariSub from 'akarisub'

const renderer = new AkariSub({
  video: videoElement,
  subUrl: '/subtitles/movie.ass',
  renderer: 'auto',
  onCanvasFallback: () => {
    console.log('GPU renderer unavailable, using Canvas2D')
  }
})

renderer.addEventListener('ready', () => {
  console.log('Subtitles ready')
})

renderer.addEventListener('error', (event) => {
  console.error('Subtitle error:', (event as CustomEvent<Error>).detail)
})

// When done:
renderer.destroy()
```

You can also load subtitles directly from a string:

```typescript
import AkariSub from 'akarisub'

const response = await fetch('/subtitles/movie.ass')
const subtitleText = await response.text()

const renderer = new AkariSub({
  video: videoElement,
  subContent: subtitleText
})
```

### Canvas-Only Usage

If you are rendering without a bound video element, provide a canvas and drive subtitle timing manually:

```typescript
import AkariSub from 'akarisub'

const renderer = new AkariSub({
  canvas: canvasElement,
  subUrl: '/subtitles/movie.ass'
})

renderer.setCurrentTime(false, 15)
renderer.setRate(1)
```

### Runtime Track Updates

You can replace or clear subtitle tracks at runtime:

```typescript
renderer.setTrackByUrl('/subtitles/alternate.ass')
renderer.setTrack(assSubtitleString)
renderer.freeTrack()
```

### Optional WASM Initialization

The high-level renderer initializes the WASM runtime automatically. If you are using the lower-level exports directly, you can initialize it yourself:

```typescript
import { initWasm } from 'akarisub'

await initWasm('/akarisub/pkg/akarisub_bg.wasm')
```

## Lifecycle

Destroy the renderer when you are finished with it:

```typescript
const renderer = new AkariSub(options)
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

## Renderer Selection

AkariSub automatically prefers the fastest available renderer in this order: WebGPU, WebGL2, then Canvas2D. You can also force a specific renderer and listen for canvas fallback:

```typescript
import AkariSub from 'akarisub'

const renderer = new AkariSub({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass',
  renderer: 'webgpu',
  onCanvasFallback: () => {
    console.log('Requested GPU renderer unavailable, using Canvas2D fallback')
  }
})

// Check the active renderer
if (renderer.rendererType === 'webgpu') {
  console.log('WebGPU rendering enabled!')
}
```

## Options

The default options are best, and automatically fallback to the next fastest options in line, when the API's they use are unsupported. You can however forcefully change this behavior by specifying options.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `video` | HTMLVideoElement | - | Video to use as target for rendering and event listeners |
| `canvas` | HTMLCanvasElement | - | Canvas to use for manual handling (optional if video is provided) |
| `blendMode` | `'js'` \| `'wasm'` | - | Deprecated compatibility option. Ignored by the Rust runtime wrapper |
| `asyncRender` | boolean | - | Deprecated compatibility option. Ignored by the Rust runtime wrapper |
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
| `workerUrl` | string \/ URL | internal bundled worker | Optional URL for the worker module, for example `/akarisub/dist/ts/worker.js` |
| `wasmUrl` | string \/ URL | package-resolved WASM | Optional URL for the WASM binary, for example `/akarisub/pkg/akarisub_bg.wasm` |
| `subUrl` | string | - | URL of the subtitle file to play |
| `subContent` | string | - | Content of the subtitle file to play |
| `fonts` | (string \| Uint8Array)[] | - | Array of font URLs or Uint8Arrays to force load |
| `availableFonts` | Record<string, string \| Uint8Array> | `{'liberation sans': './default.woff2'}` | Available fonts map (lowercase name → URL/data) |
| `fallbackFonts` | string[] | - | Ordered list of fallback font family names |
| `useLocalFonts` | boolean | `false` | Use Local Font Access API if available |
| `libassMemoryLimit` | number | - | libass bitmap cache memory limit in MiB |
| `libassGlyphLimit` | number | - | libass glyph cache limit |
| `renderer` | `'auto' \| 'canvas2d' \| 'webgl2' \| 'webgpu'` | `'auto'` | Preferred renderer backend |
| `onCanvasFallback` | function | - | Callback fired when a requested GPU renderer falls back to Canvas2D |

## Methods

### Track Management

| Method | Parameters | Description |
|--------|------------|-------------|
| `setTrackByUrl(url)` | `url: string` | Load subtitle from URL |
| `setTrack(content)` | `content: string` | Set subtitle from string content |
| `freeTrack()` | - | Remove current subtitles |

### Playback Control

| Method | Parameters | Description |
|--------|------------|-------------|
| `setIsPaused(isPaused)` | `isPaused: boolean` | Set playback pause state |
| `setRate(rate)` | `rate: number` | Set playback rate (speed multiplier) |
| `setCurrentTime(isPaused?, currentTime?, rate?)` | `isPaused?: boolean, currentTime?: number, rate?: number` | Set current time, optionally request an immediate paused render, and update playback rate |

### Video & Canvas

| Method | Parameters | Description |
|--------|------------|-------------|
| `setVideo(video)` | `video: HTMLVideoElement` | Change target video element |
| `resize()` | - | Re-sync the overlay canvas to the current video/canvas size and force a render |

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
| `getStats()` | - | `Promise<BrowserRendererPerformanceStats>` | Get performance statistics |
| `resetStats()` | - | `Promise<void>` | Reset statistics counters |
| `getEventCount()` | - | `Promise<number>` | Get event count (lightweight) |
| `getStyleCount()` | - | `Promise<number>` | Get style count (lightweight) |
| `runBenchmark()` | - | `void` | Deprecated compatibility stub. Currently logs a warning |

### Lifecycle

| Method | Parameters | Description |
|--------|------------|-------------|
| `destroy(err?)` | `err?: Error \| string` | Destroy the renderer and cleanup |

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `debug` | boolean | Enable/disable debug logging |
| `prescaleFactor` | number | Scale factor for subtitles |
| `prescaleHeightLimit` | number | Height limit for prescaling |
| `maxRenderHeight` | number | Maximum render height |
| `timeOffset` | number | Subtitle time offset in seconds |
| `busy` | boolean | Whether the renderer is currently busy |
| `renderAhead` | number | Render-ahead offset in seconds |
| `rendererType` | `'canvas2d' \| 'webgl2' \| 'webgpu'` | Active renderer backend (read-only) |
| `offscreenRender` | boolean | Whether OffscreenCanvas rendering is active (read-only) |

## Type Definitions

### ASSEvent

| Property | Type | Description |
|----------|------|-------------|
| `Start` | number | Start time in seconds |
| `Duration` | number | Duration in seconds |
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

## Build

### Get the Source

```
git clone --recursive https://github.com/altqx/akarisub.git
```

### Prerequisites

- Rust toolchain with `cargo`
- `wasm-pack`
- Bun

### Install Dependencies

```bash
bun install
```

### Build

```bash
bun run build
```

This runs the release WebAssembly build and then generates the TypeScript wrapper output.

### Development Builds

```bash
bun run build:wasm
bun run build:ts
```

### Other Useful Commands

```bash
bun run clean
bun run test
bun run format
```
