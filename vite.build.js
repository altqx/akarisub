// vite.config.js
import { resolve, dirname } from 'path'
import { build } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Build main library (TypeScript entry point)
await build({
  configFile: false,
  build: {
    target: 'esnext',
    emptyOutDir: false,
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'JASSUB',
      fileName: (format) => (format === 'es' ? 'index.js' : `jassub.${format}.js`),
      formats: ['es', 'umd']
    }
  }
})

// Build UMD bundle for direct script tag usage
await build({
  configFile: false,
  build: {
    target: 'esnext',
    emptyOutDir: false,
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'JASSUB',
      fileName: () => 'jassub.umd.js',
      formats: ['umd']
    }
  }
})

// Build worker from TypeScript
await build({
  configFile: false,
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'dist/js/jassub-worker.wasm',
          dest: './'
        }
      ]
    })
  ],
  resolve: {
    alias: {
      wasm: 'dist/js/jassub-worker.js'
    }
  },
  build: {
    target: 'esnext',
    outDir: './dist',
    minify: 'esbuild',
    lib: {
      fileName: () => 'jassub-worker.js',
      entry: 'src/ts/worker.ts',
      formats: ['iife'],
      name: 'JASSUBWorker'
    },
    emptyOutDir: false
  }
})
