# AGENTS.md

## Cursor Cloud specific instructions

AkariSub is a browser library (a WASM wrapper around libass) — there is no long-running
application server. "Running it" means building the WASM + TypeScript artifacts and
exercising them in a browser. See `README.md` (the "How to build?" section) for the
canonical build commands and `.github/workflows/build.yml` for the CI order.

### Toolchain (already installed in the environment)

- `bun` (1.3.14) and Emscripten (`emcc`/`em++`, 6.0.6) are preinstalled. `~/.bashrc` adds
  `~/.bun/bin` to `PATH` and sources `~/emsdk/emsdk_env.sh`, so interactive agent shells
  get both automatically. A non-interactive shell that skips `~/.bashrc` will NOT have them
  — in that case run `source "$HOME/emsdk/emsdk_env.sh"` and use `~/.bun/bin/bun`.
- The native submodules under `lib/` (libass, freetype, harfbuzz, fontconfig, fribidi,
  expat, brotli) are required for the WASM build. The startup update script initializes
  them (`git submodule update --init --recursive`); the working tree must not be missing
  them before running `make`/`bun run build`.

### Build / test / lint

- `bun run build` — builds the native libs into `build/prefix`, links the WASM glue into
  `pkg/`, then compiles TypeScript into `dist/`. The first clean build is slow (compiles
  all C/C++ deps, ~7 min); it is single-threaded per the Makefile. Artifacts land in `pkg/`
  (`akarisub.js` glue + `akarisub.wasm`) and `dist/`.
- `bun run build:wasm` (a.k.a. `make worker`) — rebuild only the WASM glue after C++ changes.
- `bun run build:ts` — rebuild only TypeScript.
- `bun run typecheck` — TS type checking (this is the closest thing to a lint gate; CI runs it).
- `bun test ./tests` — unit tests. Runnable without building the WASM. `fixture-parity.test.ts`
  self-skips unless media fixtures exist under `tests/akarisub-test/` (a `.webm` + `ED.ass`).
- `bun run format` runs Prettier in WRITE mode. The repo currently has pre-existing Prettier
  drift, so `prettier --check` reports warnings that are NOT caused by your changes — do not
  treat them as a regression, and there is no check-only lint step in CI.

### Manual browser testing (the `tests/*.html` harnesses)

The HTML harnesses (`tests/browser-libass-timing.html`, `tests/browser-libass-blur.html`)
import `dist` modules with extensionless specifiers, so they only work when served through a
bundler dev server (Vite/webpack/Rollup), exactly as the library is meant to be consumed. A
plain static file server will 404 the module graph (native ESM cannot resolve `./wrapper`).

To demo end-to-end: build first (`bun run build`), then run a Vite dev server rooted at the
repo and open `/tests/browser-libass-timing.html`. On success `<pre id="result">` shows
`PASS`. The WASM is built with `USE_PTHREADS=0`, so no COOP/COEP cross-origin isolation is
required. The worker, WASM binary, and default font are resolved relative to the package
module URL (`pkg/akarisub.js`, `pkg/akarisub.wasm`, `assets/default.woff2`).
