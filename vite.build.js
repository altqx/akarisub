// vite.config.js
import { resolve, dirname } from 'path'
import { build } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath } from 'url'
import { appendFile } from 'fs/promises'

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
      fileName: (format) => format === 'es' ? 'index.js' : `jassub.${format}.js`,
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: ['rvfc-polyfill'],
      output: {
        globals: {
          'rvfc-polyfill': 'rvfcPolyfill'
        }
      }
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
        },
        {
          src: 'dist/js/jassub-worker-modern.wasm',
          dest: './'
        }
      ]
    })
  ],
  resolve: {
    alias: {
      wasm: 'dist/js/jassub-worker-modern.js'
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

await build({
  configFile: false,
  build: {
    terserOptions: {
      mangle: false,
      compress: false,
      format: {
        comments: false
      }
    },
    target: 'esnext',
    outDir: './dist',
    minify: 'terser',
    rollupOptions: {
      treeshake: false,
      output: {
        exports: 'none',
        entryFileNames: '[name].js'
      },
      input: {
        'jassub-worker.wasm': resolve(__dirname, 'dist/js/jassub-worker.wasm.js')
      }
    },
    emptyOutDir: false
  }
})

await appendFile(resolve(__dirname, 'dist/jassub-worker.wasm.js'), 'self.WebAssembly=WebAssembly')
