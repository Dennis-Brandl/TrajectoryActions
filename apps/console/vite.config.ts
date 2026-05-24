import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readFileSync } from 'fs'

const containerVersion = (
  JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')) as {
    version: string
  }
).version

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(containerVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5176,
    proxy: {
      '/trajectory': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/management': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
})
