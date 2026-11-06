import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// UI of the developer-only Mermapix Test Runner plugin (plugin-dev/). Same toolchain as vite.plugin.config.ts;
// scripts/build-test-runner.mjs inlines the output into the single-file plugin-dev/ui.html.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist-test-runner',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'plugin-dev/src/ui/index.html'),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
