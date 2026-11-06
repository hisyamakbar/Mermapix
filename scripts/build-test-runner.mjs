import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { build } from 'vite'
import { generate, OUT_PATH } from './gen-figma-audit.mjs'

// Builds the developer-only Mermapix Test Runner Figma plugin:
//   plugin-dev/src/main.ts      -> plugin-dev/code.js  (sandbox, IIFE)
//   plugin-dev/src/ui/*         -> plugin-dev/ui.html  (single file; bundles tests/figma-fixtures/*.mmd)
// and regenerates tests/figma-audit.js from plugin-dev/src/auditCore.js.
// Nothing here touches plugin/ (the production plugin).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

console.log('🧪 Building Mermapix Test Runner (developer plugin)...')

// 0. Keep the paste-ready MCP audit in sync with the shared module.
fs.writeFileSync(OUT_PATH, generate(), 'utf8')
console.log('✅ Wrote tests/figma-audit.js')

// 1. Sandbox. Figma's sandbox needs one classic script: IIFE, no imports/exports, not minified.
const sandboxTmpDir = path.resolve(rootDir, 'dist-test-runner-sandbox')
await build({
  root: rootDir,
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: sandboxTmpDir,
    emptyOutDir: true,
    minify: false,
    target: 'es2017',
    reportCompressedSize: false,
    lib: {
      entry: path.resolve(rootDir, 'plugin-dev/src/main.ts'),
      formats: ['iife'],
      name: 'MermapixTestRunner',
      fileName: () => 'code.js',
    },
  },
})
fs.copyFileSync(path.join(sandboxTmpDir, 'code.js'), path.resolve(rootDir, 'plugin-dev/code.js'))
fs.rmSync(sandboxTmpDir, { recursive: true, force: true })
console.log('✅ Wrote plugin-dev/code.js')

// 2. UI
console.log('📦 Building test runner UI...')
execSync('npx vite build --config vite.test-runner.config.ts', { cwd: rootDir, stdio: 'inherit' })

const distDir = path.resolve(rootDir, 'dist-test-runner')
const assetsDir = path.resolve(distDir, 'assets')
if (!fs.existsSync(assetsDir)) throw new Error(`Assets directory not found at ${assetsDir}`)

const files = fs.readdirSync(assetsDir)
const cssFile = files.find((f) => f.endsWith('.css'))
const jsFile = files.find((f) => f.endsWith('.js'))
if (!cssFile || !jsFile) throw new Error(`Could not find bundled CSS or JS file in ${assetsDir}`)

const cssContent = fs.readFileSync(path.join(assetsDir, cssFile), 'utf-8')
const jsContent = fs.readFileSync(path.join(assetsDir, jsFile), 'utf-8')
const safeJsContent = jsContent.replace(/<\/script>/gi, '<\\/script>')

const uiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mermapix Test Runner (dev)</title>
  <style>
${cssContent}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
${safeJsContent}
  </script>
</body>
</html>
`

const targetUiPath = path.resolve(rootDir, 'plugin-dev/ui.html')
fs.writeFileSync(targetUiPath, uiHtml, 'utf-8')
console.log(`✅ Wrote ${targetUiPath} (${(fs.statSync(targetUiPath).size / 1024 / 1024).toFixed(2)} MB)`)

fs.rmSync(distDir, { recursive: true, force: true })
console.log('🧹 Cleaned up temporary dist-test-runner directory.')
