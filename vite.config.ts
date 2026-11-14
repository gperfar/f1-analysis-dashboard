import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works at any URL path
  // (GitHub Pages serves it under /<repo-name>/).
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    target: 'es2015',
    chunkSizeWarningLimit: 6000, // Plotly alone is ~4.5 MB
  },
  define: {
    global: 'globalThis',
  },
})
