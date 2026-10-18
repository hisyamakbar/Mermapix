#!/usr/bin/env node

/**
 * Mermapix Clean Open Source Exporter
 * 
 * Prepares a pristine, production-ready directory for the public GitHub repository,
 * stripping out all internal agent workflows, private planning archives, and cache artifacts.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const targetDir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(rootDir, 'dist-oss')

console.log('📦 Preparing clean Open Source release directory...')
console.log(`📍 Source: ${rootDir}`)
console.log(`🎯 Target: ${targetDir}`)

const INCLUDED_PATHS = [
  'src',
  'plugin',
  'public',
  'scripts',
  'tests',
  'index.html',
  'vite.config.ts',
  'vite.plugin.config.ts',
  'package.json',
  'tsconfig.json',
  'pnpm-lock.yaml',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'AGENTS.md',
  '.gitignore',
  '.mise.toml',
]

const EXCLUDED_PATTERNS = [
  '.agents',
  '.claude',
  '.figma',
  'plans/archive',
  'node_modules',
  'dist',
  'dist-plugin',
  'dist-oss',
  'tests/output',
  '.DS_Store',
]

if (fs.existsSync(targetDir)) {
  console.log(`⚠️ Target directory exists. Cleaning ${targetDir}...`)
  fs.rmSync(targetDir, { recursive: true, force: true })
}
fs.mkdirSync(targetDir, { recursive: true })

for (const item of INCLUDED_PATHS) {
  const srcPath = path.join(rootDir, item)
  const destPath = path.join(targetDir, item)

  if (!fs.existsSync(srcPath)) continue

  const stat = fs.statSync(srcPath)
  if (stat.isDirectory()) {
    copyDirRecursive(srcPath, destPath)
  } else {
    fs.copyFileSync(srcPath, destPath)
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src)) {
    if (EXCLUDED_PATTERNS.some((pat) => entry === pat || entry.includes(pat))) continue
    const srcChild = path.join(src, entry)
    const destChild = path.join(dest, entry)
    const stat = fs.statSync(srcChild)
    if (stat.isDirectory()) {
      copyDirRecursive(srcChild, destChild)
    } else {
      fs.copyFileSync(srcChild, destChild)
    }
  }
}

console.log(`✅ Clean Open Source bundle successfully created at:\n   ${targetDir}`)
console.log(`
Next steps to publish as public open source:
  1. cd ${targetDir}
  2. git init
  3. git add .
  4. git commit -m "feat: initial open source release (v1.0.0)"
  5. git remote add origin https://github.com/hisyamakbar/<your-public-repo>.git
  6. git push -u origin main
`)
