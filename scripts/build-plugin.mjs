import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

console.log('🚀 Building Mermapix Figma Plugin...')

// 1. Compile plugin sandbox backend (plugin/code.ts -> plugin/code.js)
console.log('⚡ Compiling plugin/code.ts...')
execSync('npx tsc plugin/code.ts --target es2017 --module commonjs --skipLibCheck', {
  cwd: rootDir,
  stdio: 'inherit',
})

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

const cssContent = fs.readFileSync(path.join(assetsDir, cssFile), 'utf-8')
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
