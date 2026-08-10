import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { copyFile } from 'fs/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))

const esResult = await Bun.build({
  entrypoints: [resolve(__dirname, 'src/index.ts')],
  outdir: resolve(__dirname, 'dist'),
  target: 'browser',
  format: 'esm',
  minify: true,
  naming: 'index.js'
})

if (!esResult.success) {
  console.error('ES build failed:', esResult.logs)
  process.exit(1)
}

console.log('Built ES module: dist/index.js')

const umdResult = await Bun.build({
  entrypoints: [resolve(__dirname, 'src/index.ts')],
  outdir: resolve(__dirname, 'dist'),
  target: 'browser',
  format: 'iife',
  minify: true,
  naming: 'akarisub.umd.js'
})

if (!umdResult.success) {
  console.error('UMD build failed:', umdResult.logs)
  process.exit(1)
}

const umdPath = resolve(__dirname, 'dist/akarisub.umd.js')
let umdContent = await Bun.file(umdPath).text()

const umdWrapper = `(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AkariSub = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
${umdContent}
return AkariSub;
}));`

await Bun.write(umdPath, umdWrapper)

console.log('Built UMD bundle: dist/akarisub.umd.js')

const workerBuildResult = await Bun.build({
  entrypoints: [resolve(__dirname, 'src/ts/worker.ts')],
  outdir: resolve(__dirname, 'dist'),
  target: 'browser',
  format: 'iife',
  minify: true,
  naming: 'akarisub-worker.js',
  define: {
    'import.meta.url': 'self.location.href'
  },
  plugins: [
    {
      name: 'wasm-alias',
      setup(build) {
        build.onResolve({ filter: /^wasm$/ }, () => {
          return { path: resolve(__dirname, 'dist/js/akarisub-worker.js') }
        })
      }
    }
  ]
})

if (!workerBuildResult.success) {
  console.error('Worker build failed:', workerBuildResult.logs)
  process.exit(1)
}

await copyFile(
  resolve(__dirname, 'THIRD_PARTY_NOTICES.md'),
  resolve(__dirname, 'dist/COPYRIGHT')
)
console.log('Copied THIRD_PARTY_NOTICES.md to dist/COPYRIGHT')

try {
  await copyFile(
    resolve(__dirname, 'dist/js/akarisub-worker.wasm'),
    resolve(__dirname, 'dist/akarisub-worker.wasm')
  )
  console.log('Copied akarisub-worker.wasm to dist/')
} catch (e) {
  console.warn('Could not copy wasm file (may already exist):', (e as Error).message)
}

console.log('Built worker: dist/akarisub-worker.js')
console.log('\nBuild complete!')
