import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inlineSvgMarkers as pluginInline, parsePathGeometry as pluginParse } from '../../plugin/src/markers.ts'
import { inlineSvgMarkers as webInline, parsePathGeometry as webParse } from '../../src/export/markers.ts'

// plugin/src/markers.ts is a copy of src/export/markers.ts (the Figma sandbox cannot import
// from src/). Until Phase 8.1 de-duplicates marker inlining, both must stay byte-identical.

const here = path.dirname(fileURLToPath(import.meta.url))
const dirs = [path.resolve(here, '../baseline'), path.resolve(here, '../fixtures/plugin')]
const svgFiles = dirs.flatMap((dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => path.join(dir, f))
    : [],
)

test('plugin marker fixtures are present', () => {
  assert.ok(svgFiles.length >= 3, `expected SVG fixtures, found ${svgFiles.length}`)
})

for (const file of svgFiles) {
  test(`plugin inlineSvgMarkers is byte-identical to src/export for ${path.basename(file)}`, () => {
    const svg = fs.readFileSync(file, 'utf8')
    const fromPlugin = pluginInline(svg)
    assert.equal(fromPlugin, webInline(svg))
    if (svg.includes('<marker')) {
      assert.ok(fromPlugin.includes('inlined-marker'), 'markers should be inlined')
    }
  })
}

test('plugin parsePathGeometry matches src/export', () => {
  for (const d of ['M0 0L10 10', 'm1 2 l3 4 h5 v6 c1 2 3 4 5 6 q1 2 3 4', 'M 0 0 H10 V20 z', '', 'x']) {
    assert.deepEqual(pluginParse(d), webParse(d))
  }
})

test('plugin inlineSvgMarkers passes through non-marker input', () => {
  assert.equal(pluginInline('<svg></svg>'), '<svg></svg>')
  assert.equal(pluginInline(''), '')
})
