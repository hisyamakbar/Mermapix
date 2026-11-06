import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { build } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

console.log('🚀 Building Mermapix Figma Plugin...')

// 1. Bundle plugin sandbox backend (plugin/src/main.ts -> plugin/code.js)
//    Figma's sandbox needs one classic script: IIFE, no imports/exports, not minified.
console.log('⚡ Bundling plugin/src/main.ts -> plugin/code.js...')
const sandboxTmpDir = path.resolve(rootDir, 'dist-plugin-sandbox')
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
      entry: path.resolve(rootDir, 'plugin/src/main.ts'),
      formats: ['iife'],
      name: 'MermapixPlugin',
      fileName: () => 'code.js',
    },
  },
})
fs.copyFileSync(path.join(sandboxTmpDir, 'code.js'), path.resolve(rootDir, 'plugin/code.js'))
fs.rmSync(sandboxTmpDir, { recursive: true, force: true })
console.log('✅ Wrote plugin/code.js')

// 2. Run Vite build with vite.plugin.config.ts
console.log('📦 Building plugin UI...')
execSync('npx vite build --config vite.plugin.config.ts', {
  cwd: rootDir,
  stdio: 'inherit',
})

const distPluginDir = path.resolve(rootDir, 'dist-plugin')
const assetsDir = path.resolve(distPluginDir, 'assets')

if (!fs.existsSync(assetsDir)) {
  throw new Error(`Assets directory not found at ${assetsDir}`)
}

const files = fs.readdirSync(assetsDir)
const cssFile = files.find((f) => f.endsWith('.css'))
const jsFile = files.find((f) => f.endsWith('.js'))

if (!cssFile || !jsFile) {
  throw new Error(`Could not find bundled CSS or JS file in ${assetsDir}`)
}

console.log(`📦 Inlining assets: ${cssFile} & ${jsFile}...`)

// The web app loads Inter / JetBrains Mono from Google Fonts (src/index.css). The plugin
// declares `networkAccess: none`, so that request is blocked anyway, and Figma's review
// flags undeclared network use. Strip remote @imports from the plugin build only; the UI
// falls back to the local Inter / system font stack it already used.
const cssContent = fs
  .readFileSync(path.join(assetsDir, cssFile), 'utf-8')
  .replace(/@import\s*(?:url\()?\s*["']?https?:\/\/[^;]*;/g, '')
const jsContent = fs.readFileSync(path.join(assetsDir, jsFile), 'utf-8')

// Figma iframe needs a self-contained HTML document
// Escape closing script tags within the inlined JS if any exist
const safeJsContent = jsContent.replace(/<\/script>/gi, '<\\/script>')

const uiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mermapix: Mermaid to Editable Figma</title>
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

const targetUiPath = path.resolve(rootDir, 'plugin/ui.html')
fs.writeFileSync(targetUiPath, uiHtml, 'utf-8')

console.log(`✅ Successfully generated self-contained ${targetUiPath} (${(fs.statSync(targetUiPath).size / 1024 / 1024).toFixed(2)} MB)`)

// Clean up intermediate build directory
fs.rmSync(distPluginDir, { recursive: true, force: true })
console.log('🧹 Cleaned up temporary dist-plugin directory.')
