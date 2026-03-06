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

- **WebGPU Support** - Hardware-accelerated rendering using the modern WebGPU API [(on browsers which support it)](https://caniuse.com/webgpu)
- **Hyper Optimizations** - Performance improvements and intelligent caching for smoother playback
- **Proper Fontconfig Implementation** - add Fontconfig support with multiple fallback fonts supported
- **Statistics Reporting** - Built-in statistics and performance metrics for debugging and monitoring
- **TypeScript Support** - Full TypeScript definitions and type safety
- **Updated Dependencies** - All dependencies updated to their latest versions, including libass

## Usage

By default all you need to do is copy the files from the `dist/` folder of the repository into the same folder as where your JS runs, then do:

```js
import AkariSub from './akarisub.es.js'

const renderer = new AkariSub({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass'
})
```

`Note:` while the `dist/` folder includes a UMD dist it still uses modern syntax. If you want backwards compatibility with older browsers I recommend you run it tru babel.

If you use a bundler like Vite, you can instead do:

```js
import AkariSub from 'akarisub'
import workerUrl from 'akarisub/dist/akarisub-worker.js?url'
import wasmUrl from 'akarisub/dist/akarisub-worker.wasm?url'

const renderer = new AkariSub({
  video: document.querySelector('video'),
  subContent: subtitleString,
  workerUrl, // you can also use: `new URL('akarisub/dist/akarisub-worker.js', import.meta.url)` instead of importing it as an url
  wasmUrl
})
```

## Using only with canvas

You're also able to use it without any video. However, that requires you to set the time the subtitles should render at yourself:

```js
import AkariSub from './akarisub.es.js'

const renderer = new AkariSub({
  canvas: document.querySelector('canvas'),
  subUrl: './tracks/sub.ass'
})

renderer.setCurrentTime(15)
```

## Changing subtitles

You're not limited to only display the subtitle file you referenced in your options. You're able to dynamically change subtitles on the fly. There's three methods that you can use for this specifically:

- `setTrackByUrl(url):` works the same as the `subUrl` option. It will set the subtitle to display by its URL.
- `setTrack(content):` works the same as the `subContent` option. It will set the subtitle to display by its content.
- `freeTrack():` this simply removes the subtitles. You can use the two methods above to set a new subtitle file to be displayed.

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

## WebGPU Rendering

AkariSub automatically uses WebGPU for GPU-accelerated rendering when available, with automatic fallback to Canvas2D:

```typescript
import AkariSub from 'akarisub'

const renderer = new AkariSub({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass',
  preferWebGPU: true, // Enable WebGPU (default: true)
  onWebGPUFallback: () => {
    console.log('WebGPU unavailable, using Canvas2D fallback')
  }
})

// Check if WebGPU is being used
if (renderer.isUsingWebGPU) {
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
| `asyncRender` | boolean | `true` | Use async rendering with ImageBitmap for GPU offloading |
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
| `workerUrl` | string | `'akarisub-worker.js'` | URL to the worker script |
| `wasmUrl` | string | `'akarisub-worker.wasm'` | URL to the WASM binary |
| `subUrl` | string | - | URL of the subtitle file to play |
| `subContent` | string | - | Content of the subtitle file to play |
| `fonts` | (string \| Uint8Array)[] | - | Array of font URLs or Uint8Arrays to force load |
| `availableFonts` | Record<string, string \| Uint8Array> | `{'liberation sans': './default.woff2'}` | Available fonts map (lowercase name → URL/data) |
| `fallbackFont` | string | `'liberation sans'` | Fallback font family key |
| `useLocalFonts` | boolean | `false` | Use Local Font Access API if available |
| `libassMemoryLimit` | number | - | libass bitmap cache memory limit in MiB |
| `libassGlyphLimit` | number | - | libass glyph cache limit |
| `preferWebGPU` | boolean | `true` | Prefer WebGPU renderer if available |
| `onWebGPUFallback` | function | - | Callback when WebGPU is unavailable |

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
| `runBenchmark()` | - | `void` | Run a benchmark on the worker |

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
| `busy` | boolean | Whether the renderer is currently busy |
| `isUsingWebGPU` | boolean | Whether WebGPU renderer is active (read-only) |

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

# How to build?

## Dependencies

- git
- emscripten (Configure the enviroment)
- make
- python3
- cmake
- pkgconfig
- patch
- libtool
- autotools (autoconf, automake, autopoint)
- gettext
- ragel - Required by Harfbuzz
- itstool - Required by Fontconfig
- gperf - Required by Fontconfig
- licensecheck

## Get the Source

Run git clone --recursive https://github.com/altqx/akarisub.git

## Build inside a Container

### Docker

1. Install Docker
2. ./run-docker-build.sh
3. Artifacts are in /dist/js

### Buildah

1. Install Buildah and a suitable backend for buildah run like crun or runc
2. ./run-buildah-build.sh
3. Artifacts are in /dist/js

## Build without Containers

1. Install the dependency packages listed above
2. make
   - If on macOS with libtool from brew, LIBTOOLIZE=glibtoolize make
3. Artifacts are in /dist/js
