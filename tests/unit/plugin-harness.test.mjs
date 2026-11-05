// End-to-end behavior of the bundled sandbox script (plugin/code.js) against a mock Figma.
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPlugin, walk } from '../plugin-mock/figma-mock.mjs'
import { buildErdScene, COLORS } from '../plugin-mock/erd-scene.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CODE = path.resolve(here, '../../plugin/code.js')
const read = (rel) => fs.readFileSync(path.resolve(here, rel), 'utf8')
const count = (s, re) => (s.match(re) || []).length
const find = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }

const BASELINE_ERD = read('../baseline/erd-basic.svg')

test('bundle is a classic script (no module syntax)', () => {
  const src = fs.readFileSync(CODE, 'utf8')
  assert.ok(!/^\s*(import|export)\s/m.test(src))
  assert.ok(!/\brequire\(/.test(src))
})

test('markers are inlined once: pre-inlined SVG is passed through, raw SVG is inlined', async () => {
  const raw = await runPlugin(CODE, BASELINE_ERD, buildErdScene)
  const nRaw = count(raw.svgSeen, /<g id="inlined-marker-\d+-[a-z-]+-(?:start|end)" class="inlined-marker /g)
  assert.ok(nRaw > 0)
  assert.equal(count(raw.svgSeen, /class="inlined-marker /g), nRaw)

  const preInlined = raw.svgSeen.replace(/ id="inlined-marker-\d+-[a-z-]+"/g, '') // as the web UI would send it
  const again = await runPlugin(CODE, preInlined, buildErdScene)
  assert.equal(count(again.svgSeen, /class="inlined-marker /g), nRaw, 'no second inlining pass')
  const markerLayers = find(again.tree, (n) => /Crow's Foot/.test(n.name))
  assert.equal(markerLayers.length, nRaw)
})

test('marker layers get semantic names and survive cleanup', async () => {
  const r = await runPlugin(CODE, BASELINE_ERD, buildErdScene)
  const names = find(r.tree, (n) => n.type === 'GROUP' && /Crow's Foot|Arrowhead/.test(n.name)).map((n) => n.name)
  assert.ok(names.length > 0)
  assert.ok(names.every((n) => /^Crow's Foot: (only-one|zero-or-one|one-or-more|zero-or-more) \((start|end)\)$/.test(n)), names.join())
  assert.equal(find(r.tree, (n) => n.name.includes('inlined-marker')).length, 0)
  assert.ok(find(r.tree, (n) => /Crow's Foot/.test(n.name)).every((n) => n.visible))
})

test('flowchart pointEnd markers are named Arrowhead, not Crow\'s Foot', async () => {
  const svg = read('../baseline/flowchart-basic.svg')
  const r = await runPlugin(CODE, svg, buildErdScene)
  const names = find(r.tree, (n) => /Arrowhead|Crow|Cross|Circle/.test(n.name) && n.type === 'GROUP').map((n) => n.name)
  assert.ok(names.length > 0)
  assert.ok(names.every((n) => !n.includes("Crow's Foot")), names.join())
})

const tableFrames = (tree) => find(tree, (n) => n.type === 'FRAME' && n.layoutMode === 'VERTICAL' && (n.children || []).some((c) => c.name.startsWith('Header: ')))

test('every entity incl. KNOWLEDGE_BASE becomes an Auto Layout table; edges/self-relations are not entities', async () => {
  const r = await runPlugin(CODE, BASELINE_ERD, buildErdScene)
  const names = tableFrames(r.tree).map((n) => n.name).sort()
  assert.deepEqual(names, ['ARTICLE', 'CATEGORY', 'KNOWLEDGE_BASE'])
  const kb = tableFrames(r.tree).find((n) => n.name === 'KNOWLEDGE_BASE')
  assert.equal(find(kb, (n) => n.name === 'Connector').length, 0)
  // original raw entity groups are gone, edges and cyclic pieces remain untouched
  assert.equal(find(r.tree, (n) => /-entity-[A-Z_]+-\d+$/.test(n.name)).length, 0)
  assert.equal(find(r.tree, (n) => n.name.includes('id_entity-KNOWLEDGE_BASE-0_entity-ARTICLE-1_0')).length, 1)
  assert.equal(find(r.tree, (n) => n.name.includes('cyclic-special')).length, 3)
})

test('header fill comes from the outer box, row cells from their own row pair (stripes kept)', async () => {
  const r = await runPlugin(CODE, BASELINE_ERD, buildErdScene)
  const article = tableFrames(r.tree).find((n) => n.name === 'ARTICLE')
  const header = article.children.find((c) => c.name.startsWith('Header: '))
  assert.deepEqual(header.fills[0].color, COLORS.header)
  assert.deepEqual(article.fills[0].color, COLORS.header)
  assert.deepEqual(header.strokes[0].color, COLORS.border)
  const content = article.children.find((c) => c.name === 'Content')
  for (const col of content.children) {
    col.children.forEach((cell, i) => {
      assert.deepEqual(cell.fills[0].color, i % 2 === 0 ? COLORS.odd : COLORS.even, `${col.name} row ${i}`)
    })
  }
})

test('column widths are measured with the final font and fit their content', async () => {
  const r = await runPlugin(CODE, BASELINE_ERD, buildErdScene)
  for (const table of tableFrames(r.tree)) {
    const content = table.children.find((c) => c.name === 'Content')
    const total = content.children.reduce((s, c) => s + c.width, 0)
    assert.equal(Math.round(total), Math.round(table.width), `${table.name}: columns sum to table width`)
    for (const col of content.children) {
      for (const cell of col.children) {
        for (const t of cell.children) {
          assert.equal(t.fontName.family, 'Inter')
          // Inter text width (7px/char regular, 7.5 bold in the mock) + 16px padding must fit
          assert.ok(t.width + 16 <= cell.width + 1e-9, `${table.name}/${col.name}: "${t.characters}" ${t.width}px in ${cell.width}px cell`)
        }
      }
    }
  }
})
