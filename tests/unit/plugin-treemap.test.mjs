// Phase 9.2 treemap end to end: inline clipPath rects are gone (they landed as black rects in real Figma),
// sections and leaves are nested FIXED frames with fill + stroke merged, header / centered labels, names,
// bounds and texts preserved. Real built plugin/code.js on the real Mermaid payload SVGs (dark + light).
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { importSvg } from '../plugin-mock/svg-import.mjs'
import { layoutAuto } from '../plugin-mock/layout-sim.mjs'
import { runFixture } from '../plugin-mock/run-fixture.mjs'
import { relBounds } from '../plugin-mock/survey-metrics.mjs'

const THEMES = ['dark', 'light']
const EXAMPLE = '37-case-treemap'
const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol

const SECTIONS = ['Treemap', 'Monthly Budget', 'Housing', 'Savings', 'Food', 'Transport']
const LEAVES = ['Rent', 'Utilities', 'Internet', 'Retirement', 'Emergency fund', 'Groceries', 'Dining out', 'Car payment', 'Fuel']
const PARENT_OF = { 'Monthly Budget': 'Treemap', Housing: 'Monthly Budget', Savings: 'Monthly Budget', Food: 'Monthly Budget', Transport: 'Monthly Budget', Rent: 'Housing', Utilities: 'Housing', Internet: 'Housing', Retirement: 'Savings', 'Emergency fund': 'Savings', Groceries: 'Food', 'Dining out': 'Food', 'Car payment': 'Transport', Fuel: 'Transport' }

const runs = new Map()
async function load(theme) {
  if (!runs.has(theme)) {
    const run = await runFixture(EXAMPLE, theme)
    const original = importSvg({ ids: 0 }, run.svg) // what Figma builds from the untouched payload
    const textColor = /<svg[^>]*\sfill="(rgb\([^"]+\))"/.exec(run.svg)[1].match(/\d+/g).map((v) => Number(v) / 255)
    runs.set(theme, { ...run, original, textColor })
  }
  return runs.get(theme)
}

const sameColor = (c, rgb) => c && Math.abs(c.r - rgb[0]) < 0.003 && Math.abs(c.g - rgb[1]) < 0.003 && Math.abs(c.b - rgb[2]) < 0.003
/** Opaque, stroke-less shapes painted with the inherited text color = the clipPath rects as Figma draws them. */
const textColoredBlocks = (tree, rgb) => all(tree, (n) => (n.type === 'VECTOR' || n.type === 'FRAME') && n.width >= 10 && n.fills && n.fills.length > 0 && n.fills[0].visible !== false && n.fills[0].opacity === 1 && sameColor(n.fills[0].color, rgb) && !(n.strokes && n.strokes.length))

const sectionFrame = (root, name) => all(root, (n) => n.type === 'FRAME' && n.name.startsWith(`Section: ${name} (`))[0]
const leafFrame = (root, name) => all(root, (n) => n.type === 'FRAME' && n.name.startsWith(`Leaf: ${name} (`))[0]
const nodeFrame = (root, name) => sectionFrame(root, name) || leafFrame(root, name)

/** Ground truth rects of the original import: every painted section / leaf rect (clip groups and 25px header strips excluded). */
function originalBoxes(original) {
  const clipGroups = new Set(all(original, (n) => n.type === 'GROUP' && /^clip-/.test(n.name)))
  const out = []
  walk(original, (n, p) => {
    if (n.type !== 'VECTOR' || clipGroups.has(p)) return
    const hasPaint = (n.fills && n.fills.length && n.fills[0].opacity !== 0) || (n.strokes && n.strokes.length && n.strokes[0].opacity !== 0)
    if (!hasPaint && n.height <= 25) return // header strip
    out.push({ vec: n, b: relBounds(n, original) })
  })
  return out
}

for (const theme of THEMES) {
  test(`[treemap/${theme}] the mock importer reproduces the visible clipPath rects of the untouched payload`, async () => {
    const { original, textColor } = await load(theme)
    assert.equal(all(original, (n) => n.type === 'GROUP' && /^clip-/.test(n.name)).length, 15, '6 section + 9 leaf clip groups')
    assert.ok(textColoredBlocks(original, textColor).length >= 15, 'each clip rect is a visible block painted with the inherited text color')
  })

  test(`[treemap/${theme}] no clip rect or text-colored block is left, the clipPaths never reach the importer`, async () => {
    const { svgSeen, root, textColor } = await load(theme)
    assert.ok(!/<clipPath|clip-path=/.test(svgSeen), 'svgPrep dropped the label clipPaths and their references')
    assert.equal(textColoredBlocks(root, textColor).length, 0, 'no black (text colored) rects')
    assert.equal(all(root, (n) => /^clip-/.test(n.name)).length, 0)
  })

  test(`[treemap/${theme}] every section and leaf is a FRAME: paint merged, no vector left, FIXED, tagged, generic fallback skipped`, async () => {
    const { root, original } = await load(theme)
    assert.equal(all(root, (n) => n.type === 'VECTOR').length, 0, 'no loose / duplicate vectors at all')
    assert.ok(!root.pluginData || !root.pluginData['mermapix:fallback'], 'generic fallback did not run')
    for (const name of SECTIONS) {
      const f = sectionFrame(root, name)
      assert.ok(f, `Section: ${name}`)
      assert.equal(f.type, 'FRAME')
      assert.equal(f.pluginData['mermapix:kind'], 'Treemap Section')
      assert.equal(f.layoutMode, 'NONE', 'sections place their children absolutely')
    }
    for (const name of LEAVES) {
      const f = leafFrame(root, name)
      assert.ok(f, `Leaf: ${name}`)
      assert.equal(f.pluginData['mermapix:kind'], 'Treemap Leaf')
      assert.equal(f.layoutMode, 'VERTICAL')
      assert.equal(f.primaryAxisSizingMode, 'FIXED')
      assert.equal(f.counterAxisSizingMode, 'FIXED')
      assert.equal(f.primaryAxisAlignItems, 'CENTER')
      assert.equal(f.counterAxisAlignItems, 'CENTER')
    }
    // paint of the original rect (fill opacity folded in by the importer) is on the frame
    const boxes = originalBoxes(original)
    assert.equal(boxes.length, 15)
    for (const { vec, b } of boxes) {
      const f = all(root, (n) => n.type === 'FRAME' && /^(Section|Leaf): /.test(n.name)).find((n) => {
        const r = relBounds(n, root)
        return near(r.x, b.x) && near(r.y, b.y) && near(r.width, b.width) && near(r.height, b.height)
      })
      assert.ok(f, `frame at ${JSON.stringify(b)}`)
      assert.equal(JSON.stringify(f.fills), JSON.stringify((vec.fills[0] && vec.fills[0].opacity !== 0) ? vec.fills : []), `${f.name} fill`)
      if (vec.strokes.length && vec.strokes[0].opacity !== 0) {
        assert.equal(JSON.stringify(f.strokes), JSON.stringify(vec.strokes), `${f.name} stroke`)
        assert.equal(f.strokeWeight, vec.strokeWeight)
      } else assert.equal(f.strokes.length, 0)
    }
  })

  test(`[treemap/${theme}] bounds (1px), names and nesting follow Mermaid's layout`, async () => {
    const { root, original } = await load(theme)
    const frames = all(root, (n) => n.type === 'FRAME' && /^(Section|Leaf): /.test(n.name))
    assert.equal(frames.length, 15)
    for (const { b } of originalBoxes(original)) {
      const hit = frames.filter((n) => { const r = relBounds(n, root); return near(r.x, b.x) && near(r.y, b.y) && near(r.width, b.width) && near(r.height, b.height) })
      assert.equal(hit.length, 1, `exactly one frame at ${JSON.stringify(b)}`)
    }
    // section names carry the value, e.g. `Section: Housing ($1,680)`, leaves `Leaf: Rent ($1,400)`
    assert.equal(sectionFrame(root, 'Housing').name, 'Section: Housing ($1,680)')
    assert.equal(sectionFrame(root, 'Monthly Budget').name, 'Section: Monthly Budget ($3,500)')
    assert.equal(leafFrame(root, 'Rent').name, 'Leaf: Rent ($1,400)')
    assert.equal(leafFrame(root, 'Emergency fund').name, 'Leaf: Emergency fund ($300)')
    // nesting
    const titleOf = (f) => /^(?:Section|Leaf): (.+) \(/.exec(f.name)[1]
    for (const [child, parent] of Object.entries(PARENT_OF)) {
      const c = nodeFrame(root, child)
      assert.equal(titleOf(c.parent), parent, `${child} sits in ${parent}`)
    }
    assert.equal(sectionFrame(root, 'Treemap').parent, root, 'the unnamed root container is the outer frame')
    // every section: header first, then nested frames (headers never overlap children)
    for (const name of SECTIONS) {
      const s = sectionFrame(root, name)
      assert.equal(s.children[0].name, 'Header')
      assert.equal(s.clipsContent, false)
    }
  })

  test(`[treemap/${theme}] texts are preserved (characters, count, size) and sit where Mermaid put them`, async () => {
    const { root, original } = await load(theme)
    const sig = (t) => `${t.characters.trim()}|${t.fontSize}`
    const before = all(original, (n) => n.type === 'TEXT' && n.characters.trim()).map(sig).sort()
    const after = all(root, (n) => n.type === 'TEXT' && n.characters.trim()).map(sig).sort()
    assert.equal(before.length, 29)
    assert.deepEqual(after, before)
    assert.equal(all(root, (n) => n.type === 'TEXT' && !n.characters.trim()).length, 0)

    // Auto Layout simulation: headers (name left, value right) and the centered leaf stacks
    const rawFor = (chars, cy) => all(original, (n) => n.type === 'TEXT' && n.characters.trim() === chars).map((t) => ({ t, b: relBounds(t, original) })).sort((p, q) => Math.abs(p.b.y + p.b.height / 2 - cy) - Math.abs(q.b.y + q.b.height / 2 - cy))[0]

    let maxCenterX = 0
    for (const header of all(root, (n) => n.type === 'FRAME' && n.name === 'Header')) {
      assert.equal(header.layoutMode, 'HORIZONTAL')
      const hb = relBounds(header, root)
      for (const { node, x, y } of layoutAuto(header)) {
        const cy = hb.y + y + node.height / 2
        const raw = rawFor(node.characters.trim(), cy)
        assert.ok(near(cy, raw.b.y + raw.b.height / 2, 1), `${node.characters} vertical center`)
        if (node.textAlignHorizontal === 'LEFT') assert.ok(near(hb.x + x, raw.b.x, 1), `${node.characters} keeps its left edge`)
        else assert.ok(near(hb.x + x + node.width, raw.b.x + raw.b.width, 1), `${node.characters} keeps its right edge`)
      }
    }
    for (const name of LEAVES) {
      const leaf = leafFrame(root, name)
      const lb = relBounds(leaf, root)
      const kids = layoutAuto(leaf)
      assert.equal(kids.length, 2, `${name}: label + value`)
      for (const { node, x, y } of kids) {
        const cy = lb.y + y + node.height / 2
        const cx = lb.x + x + node.width / 2
        const raw = rawFor(node.characters.trim(), cy)
        assert.equal(node.fontSize, raw.t.fontSize, `${node.characters} keeps its size`)
        assert.ok(near(cy, raw.b.y + raw.b.height / 2, 1), `${name}/${node.characters} vertical center ${cy} vs ${raw.b.y + raw.b.height / 2}`)
        // Mermaid centers its labels in the leaf: Auto Layout lands on the leaf center, and the importer's
        // own (Arial based) text box only differs from that by its width estimate.
        assert.ok(near(cx, lb.x + lb.width / 2, 1), `${name}/${node.characters} horizontally centered`)
        maxCenterX = Math.max(maxCenterX, Math.abs(cx - (raw.b.x + raw.b.width / 2)))
        assert.equal(node.textAlignHorizontal, 'CENTER')
      }
    }
    assert.ok(maxCenterX <= 5, `original text centers are within the importer's width noise of the leaf center (${maxCenterX.toFixed(2)}px)`)
  })
}
