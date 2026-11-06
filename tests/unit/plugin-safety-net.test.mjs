// Phase 10.1 plugin safety net: after optimizeDiagramNodes the root frame never crops its content
// (growRootToFitContent in plugin/src/cleanup.ts). Real built plugin/code.js on real Mermaid payloads
// and a few hand-made SVGs, through the mock Figma. Requires `pnpm build:plugin` first.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { FIXTURE_DIR, runFixture, runSvg } from '../plugin-mock/run-fixture.mjs'

const viewBoxOf = (svg) => /viewBox="([^"]+)"/.exec(svg)[1].split(/[\s,]+/).map(Number)
const setViewBox = (svg, vb) => svg
  .replace(/viewBox="[^"]+"/, `viewBox="${vb.join(' ')}"`)
  .replace(/(<svg[^>]*?)\swidth="[^"]+"/, `$1 width="${vb[2]}"`)
  .replace(/(<svg[^>]*?)\sheight="[^"]+"/, `$1 height="${vb[3]}"`)

/**
 * Union of the bounds of every layer that lies at least partly inside the root rect. Children of Auto Layout
 * frames are skipped (Figma positions them, the mock does not: their stored x/y are meaningless); the frame
 * itself counts.
 */
function boundsOfLeaves(root) {
  const boxes = []
  const visit = (parent, ox, oy) => {
    for (const n of parent.children || []) {
      if (n.visible === false) continue
      if (n.type === 'GROUP') { visit(n, ox, oy); continue }
      boxes.push({ x0: ox + n.x, y0: oy + n.y, x1: ox + n.x + n.width, y1: oy + n.y + n.height, n })
      if (n.type === 'FRAME' && (!n.layoutMode || n.layoutMode === 'NONE')) visit(n, ox + n.x, oy + n.y)
    }
  }
  visit(root, 0, 0)
  return boxes.filter((b) => !(b.x1 <= 0 || b.x0 >= root.width || b.y1 <= 0 || b.y0 >= root.height))
}
function overflowOf(root) {
  const boxes = boundsOfLeaves(root)
  const x0 = Math.min(...boxes.map((b) => b.x0)), y0 = Math.min(...boxes.map((b) => b.y0))
  const x1 = Math.max(...boxes.map((b) => b.x1)), y1 = Math.max(...boxes.map((b) => b.y1))
  return { left: -x0, top: -y0, right: x1 - root.width, bottom: y1 - root.height }
}
const maxOverflow = (o) => Math.max(o.left, o.top, o.right, o.bottom)

const treemapLight = () => fs.readFileSync(path.join(FIXTURE_DIR, '37-case-treemap-light.svg'), 'utf8')

test('a payload with the pre-10.1 cropped viewBox (treemap, 34px cut at the bottom) is grown, nothing is cropped', async () => {
  const cropped = setViewBox(treemapLight(), [-24, -16, 1030, 372]) // what buildExportSvg used to emit
  const { root } = await runSvg(cropped, 'light')
  assert.ok(maxOverflow(overflowOf(root)) <= 0.5, JSON.stringify(overflowOf(root)))
  assert.ok(root.height > 372, `the frame grew (${root.height})`)
  assert.equal(root.width, 1030 + 0, 'width needed no growth beyond the exported viewBox + margins')
})

test('content at negative coordinates grows the frame to the left/top and keeps every layer in place', async () => {
  const svg = treemapLight()
  const [x, y, w, h] = viewBoxOf(svg)
  const shifted = setViewBox(svg, [x + 60, y + 40, w - 60, h - 40]) // frame starts 60px right / 40px below the content
  const before = await runSvg(svg, 'light')
  const after = await runSvg(shifted, 'light')
  const o = overflowOf(after.root)
  assert.ok(maxOverflow(o) <= 0.5, JSON.stringify(o))
  // margins on the sides that grew: >= 24 left, >= 16 top
  const boxes = boundsOfLeaves(after.root)
  const minX = Math.min(...boxes.map((b) => b.x0)), minY = Math.min(...boxes.map((b) => b.y0))
  assert.ok(minX >= 24 - 1 && minY >= 16 - 1, `left/top margins kept (${minX}, ${minY})`)
  // layers keep their relative positions: two section frames
  const frameAt = (r, prefix) => { const f = boundsOfLeaves(r.root).find((b) => b.n.type === 'FRAME' && b.n.name.startsWith(prefix)); return f }
  const a0 = frameAt(before, 'Section: Housing'), a1 = frameAt(after, 'Section: Housing')
  const c0 = frameAt(before, 'Section: Food'), c1 = frameAt(after, 'Section: Food')
  assert.ok(Math.abs((c1.x0 - a1.x0) - (c0.x0 - a0.x0)) < 0.5 && Math.abs((c1.y0 - a1.y0) - (c0.y0 - a0.y0)) < 0.5, 'relative positions unchanged')
})

test('a wider font than the one the SVG was measured with (text running past the right edge) grows the frame by overflow + 12', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60"><rect x="10" y="10" width="180" height="40" fill="rgb(255, 255, 255)" stroke="rgb(0, 0, 0)"/><text font-size="14" font-family="Arial, sans-serif" fill="rgb(0, 0, 0)"><tspan x="10" y="35" fill="rgb(0, 0, 0)">A deliberately long label that Inter renders wider than Arial</tspan></text></svg>'
  const { root } = await runSvg(svg, 'light')
  const o = overflowOf(root)
  assert.ok(maxOverflow(o) <= 0.5, JSON.stringify(o))
  assert.ok(root.width > 200)
  const text = boundsOfLeaves(root).find((b) => b.n.type === 'TEXT')
  assert.ok(root.width - text.x1 >= 12 - 0.5, `right margin >= 12 (${root.width - text.x1})`)
})

test('an exact payload is left alone: root size equals the exported viewBox', async () => {
  for (const [name, theme] of [['37-case-treemap', 'light'], ['40-case-eventmodeling-cart', 'dark'], ['40-case-eventmodeling-cart', 'light'], ['1-ex-erd', 'light'], ['3-ex-sequence', 'dark']]) {
    const run = await runFixture(name, theme)
    const [, , w, h] = viewBoxOf(run.svg)
    assert.equal(run.root.width, w, `${name} ${theme} width`)
    assert.equal(run.root.height, h, `${name} ${theme} height`)
  }
})

test('layers wholly outside the frame are Mermaid clipping them on purpose (gantt today marker) and do not grow it', async () => {
  const svg = zlib.gunzipSync(fs.readFileSync(path.join(FIXTURE_DIR, 'survey', 'gantt-light.svg.gz'))).toString('utf8')
  const [minX, , w, h] = viewBoxOf(svg)
  const farX = Math.max(...[...svg.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1])))
  assert.ok(farX > minX + w + 1000, 'the payload has the far-away today line')
  const { root } = await runSvg(svg, 'light')
  assert.equal(root.width, w)
  assert.equal(root.height, h)
})
