/**
 * Standalone Vite config for web-only builds (Vercel / static hosting).
 * Builds only the renderer — skips Electron main and preload processes.
 */
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path, { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'
import packageJson from './release/app/package.json'

const inferredRelease = process.env.SENTRY_RELEASE || packageJson.version

/** Inject <base href="/"> so SPA routes resolve correctly */
function injectBaseTag(): Plugin {
  return {
    name: 'inject-base-tag',
    transformIndexHtml() {
      return [{ tag: 'base', attrs: { href: '/' }, injectTo: 'head-prepend' }]
    },
  }
}

/** Inject release date */
function injectReleaseDate(): Plugin {
  const releaseDate = new Date().toISOString().slice(0, 10)
  return {
    name: 'inject-release-date',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          children: `window.chatbox_release_date="${releaseDate}";`,
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

/** Replace dvh with vh for browser compatibility */
function dvhToVh(): Plugin {
  return {
    name: 'dvh-to-vh',
    transform(code, id) {
      if (id.endsWith('.css') || id.endsWith('.module.css')) {
        return code.replace(/dvh/g, 'vh')
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    root: resolve(__dirname, 'src/renderer'),
    base: '/',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './routes',
        generatedRouteTree: './routeTree.gen.ts',
      }),
      react({}),
      dvhToVh(),
      injectBaseTag(),
      injectReleaseDate(),
      visualizer({
        filename: 'release/app/dist/renderer/stats.html',
        open: false,
        title: 'Renderer Dependency Analysis',
      }),
    ].filter(Boolean),
    build: {
      outDir: resolve(__dirname, 'release/app/dist/renderer'),
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: isProduction ? 'hidden' : true,
      minify: isProduction ? 'esbuild' : false,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: {
          entryFileNames: 'js/[name].[hash].js',
          chunkFileNames: 'js/[name].[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.css')) return 'styles/[name].[hash][extname]'
            if (/\.(woff|woff2|eot|ttf|otf)$/i.test(assetInfo.name || '')) return 'fonts/[name].[hash][extname]'
            if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(assetInfo.name || '')) return 'images/[name].[hash][extname]'
            return 'assets/[name].[hash][extname]'
          },
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@ai-sdk') || id.includes('ai/')) return 'vendor-ai'
              if (id.includes('@mantine') || id.includes('@tabler')) return 'vendor-ui'
              if (id.includes('mermaid') || id.includes('d3')) return 'vendor-charts'
            }
          },
        },
      },
    },
    css: {
      modules: {
        generateScopedName: '[name]__[local]___[hash:base64:5]',
      },
      postcss: resolve(__dirname, 'postcss.config.cjs'),
    },
    define: {
      'process.type': '"renderer"',
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
      'process.env.CHATBOX_BUILD_TARGET': JSON.stringify('web'),
      'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify('web'),
      'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify('web'),
      'process.env.USE_LOCAL_API': JSON.stringify(''),
      'process.env.USE_BETA_API': JSON.stringify(''),
    },
    optimizeDeps: {
      include: ['mermaid'],
      esbuildOptions: { target: 'es2015' },
    },
  }
})
