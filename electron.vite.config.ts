import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * Injects the Content-Security-Policy meta tag.
 *
 * Production gets the strict policy. The dev server needs `'unsafe-inline'` for
 * React Fast Refresh's inline preamble and a websocket origin for HMR, but it
 * must still set *a* policy: Electron logs a security warning whenever a renderer
 * has no CSP at all, and that warning would otherwise drown out real ones.
 *
 * The packaged renderer never talks to the network (all provider calls happen in
 * the main process), so the production policy can stay this tight.
 */
function cspPlugin(): Plugin {
  const base = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ]

  const productionPolicy = [...base, "script-src 'self'", "connect-src 'self'"].join('; ')
  const developmentPolicy = [...base, "script-src 'self' 'unsafe-inline'", "connect-src 'self' ws: wss:"].join('; ')

  let policy = productionPolicy

  return {
    name: 'translate-clip-csp',
    configResolved(config) {
      policy = config.command === 'serve' ? developmentPolicy : productionPolicy
    },
    transformIndexHtml(html) {
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('src/main/main.ts')
      },
      outDir: 'out/main'
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('src/main/preload.ts'),
        formats: ['cjs']
      },
      outDir: 'out/preload',
      rollupOptions: {
        output: {
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name]-[hash].cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    build: {
      outDir: 'out/renderer'
    },
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [tailwindcss(), react(), cspPlugin()]
  }
})
