import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative Pfade: der Leser läuft unter wima26.de/leser/ und wird nach public/leser gebaut (Wima liefert public/ aus)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../public/leser',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // iPadOS/Safari ab 16.4 (u. a. wegen RegExp-Lookbehind und Modul-Workern)
    target: ['es2022', 'safari16.4', 'ios16.4', 'chrome111', 'firefox114', 'edge111'],
  },
  worker: { format: 'es' },
})
