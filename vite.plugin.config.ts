import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist-plugin',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/plugin/index.html'),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
