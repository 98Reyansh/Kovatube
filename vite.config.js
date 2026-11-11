import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    modulePreload: { polyfill: false },
  },
  plugins: [
    react(),
    {
      name: 'strip-crossorigin',
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, '')
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
