// Phase 8.2 end to end: the real built plugin/code.js on the real Mermaid payload SVGs
// (4 built-in examples x dark/light) through the mock SVG importer.
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { importSvg } from '../plugin-mock/svg-import.mjs'
import { runFixture, EXAMPLES, THEMES } from '../plugin-mock/run-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const THEME_NAMES = ['dark', 'light']
const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol

/** Bounds relative to the root frame (GROUPs transparent, FRAME positions accumulate). */
function rel(n, root) {
  let x = n.x, y = n.y, p = n.parent
  while (p && p !== root) { if (p.type === 'FRAME') { x += p.x; y += p.y } p = p.parent }
  return { x, y, width: n.width, height: n.height }
}

const NODE_RE = /-flowchart-(.+)-(\d+)$/
const runs = new Map()
async function load(example, theme) {
  const key = `${example}/${theme}`
  if (!runs.has(key)) {
    const r = await runFixture(example, theme)
    // the exact tree the plugin received (same processed SVG) = ground truth to compare against
    const before = importSvg({ ids: 0 }, r.svgSeen)
    runs.set(key, { ...r, before })
  }
  return runs.get(key)
}

const descendants = (n, type) => all(n, (c) => c.type === type && c !== n)
const solidKey = (paints) => JSON.stringify((paints || []).map((p) => [p.type, p.color, p.opacity ?? 1]))

/** Original visual of a node group: bounds union + paint of the fill / stroke carriers. */
function originalNode(group, root) {
  const vs = descendants(group, 'VECTOR').filter((v) => v.width > 0 || v.height > 0)
  const xs = vs.map((v) => rel(v, root))
  const x = Math.min(...xs.map((b) => b.x)), y = Math.min(...xs.map((b) => b.y))
  const w = Math.max(...xs.map((b) => b.x + b.width)) - x, h = Math.max(...xs.map((b) => b.y + b.height)) - y
  const filled = vs.find((v) => v.fills.length)
  const stroked = vs.find((v) => v.strokes.length)
  const dashed = vs.find((v) => v.strokes.length && v.dashPattern.some((d) => d > 0) && v.dashPattern.length && v.dashPattern.some((d, i) => i % 2 === 1 && d > 0))
  const texts = descendants(group, 'TEXT').filter((t) => t.characters.trim()).map((t) => t.characters.trim())
  return { x, y, w, h, filled, stroked, dashed, texts, vectors: vs.length }
}

const nodeFrames = (tree) => all(tree, (n) => n.type === 'FRAME' && n.pluginData && n.pluginData['mermapix:node'] !== undefined)

for (const theme of THEME_NAMES) {
  for (const example of EXAMPLES) {
    const isFlow = example.includes('flowchart') || example.includes('sitemap')

    test(`[${example}/${theme}] every original text survives exactly once (zero-drop)`, async () => {
      const { before, root } = await load(example, theme)
      const texts = (tree) => all(tree, (n) => n.type === 'TEXT' && n.characters.trim()).map((t) => t.characters.trim()).sort()
      // ERD rows are re-assembled but all strings must still exist exactly as often as before
      assert.deepEqual(texts(root), texts(before))
    })

    test(`[${example}/${theme}] root frame is painted with the theme background`, async () => {
      const { root } = await load(example, theme)
      const hex = THEMES[theme].background
      const want = { r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 }
      assert.equal(root.fills.length, 1)
      assert.equal(root.fills[0].visible, true)
      assert.equal(root.fills[0].opacity, 1)
      for (const k of 'rgb') assert.ok(near(root.fills[0].color[k], want[k], 1e-6), `${k}`)
    })

    test(`[${example}/${theme}] connectors (L_* / id_entity edges) keep path + bounds (8.3 renames flowchart lines to "Line")`, { skip: example.includes('sequence') && 'sequence message lines are covered by plugin-sequence.test.mjs (phase 8.4)' }, async () => {
      const { before, root } = await load(example, theme)
      const edges = (tree) => all(tree, (n) => n.type === 'VECTOR' && /(^|-)L_|id_entity|cyclic-special/.test(n.name))
      const b = edges(before)
      const lines = all(root, (n) => n.type === 'VECTOR' && (/id_entity|cyclic-special/.test(n.name) || n.name === 'Line'))
      assert.equal(lines.length, b.length)
      for (const e of b) {
        const bb = rel(e, before)
        const m = lines.find((x) => x.vectorPaths[0].data === e.vectorPaths[0].data && ['x', 'y', 'width', 'height'].every((k) => near(bb[k], rel(x, root)[k], 0.01)))
        assert.ok(m, e.name)
      }
    })

    if (isFlow) {
      test(`[${example}/${theme}] every node group becomes a FRAME (rect-like) or wrapper FRAME (complex), geometry preserved`, async () => {
        const { before, root } = await load(example, theme)
        const originals = all(before, (n) => n.type === 'GROUP' && NODE_RE.test(n.name))
        assert.ok(originals.length >= 5)
        const frames = nodeFrames(root)
        assert.equal(frames.length, originals.length)
        assert.equal(all(root, (n) => n.type === 'GROUP' && NODE_RE.test(n.name)).length, 0, 'no raw node groups left')
        const ids = new Set()
        for (const g of originals) {
          const id = NODE_RE.exec(g.name)[1]
          ids.add(id)
          const o = originalNode(g, before)
          const f = frames.find((x) => x.pluginData['mermapix:node'] === id)
          assert.ok(f, `frame for ${id}`)
          const b = rel(f, root)
          for (const [k, v] of [['x', o.x], ['y', o.y], ['width', o.w], ['height', o.h]]) {
            assert.ok(near(b[k], v), `${id}: ${k} ${b[k]} vs ${v} (Δ ${Math.abs(b[k] - v)})`)
          }
          assert.equal(f.layoutMode, 'HORIZONTAL')
          assert.equal(f.primaryAxisSizingMode, 'FIXED')
          assert.equal(f.counterAxisSizingMode, 'FIXED')
          assert.equal(f.primaryAxisAlignItems, 'CENTER')
          assert.equal(f.counterAxisAlignItems, 'CENTER')
          assert.equal(f.clipsContent, false)

          const kind = f.pluginData['mermapix:kind']
          const vecs = f.children.filter((c) => c.type === 'VECTOR')
          const texts = f.children.filter((c) => c.type === 'TEXT')
          assert.equal(texts.length, o.texts.length)
          assert.equal(texts[0].fontName.family, 'Inter', id)
          assert.equal(texts[0].textAlignHorizontal, 'CENTER')
          if (['Rectangle', 'Rounded Rectangle', 'Stadium', 'Circle'].includes(kind)) {
            // paint lives on the frame itself, no separate outline vector
            assert.equal(vecs.length, 0, `${id} (${kind}) must not keep a vector`)
            assert.equal(solidKey(f.fills), solidKey(o.filled.fills), `${id} fill`)
            assert.equal(solidKey(f.strokes), solidKey(o.stroked.strokes), `${id} stroke`)
            assert.equal(f.strokeWeight, o.stroked.strokeWeight, `${id} weight`)
            if (o.dashed) assert.deepEqual(f.dashPattern, o.dashed.dashPattern, `${id} dash`)
            if (kind === 'Circle') assert.ok(near(f.cornerRadius, o.w / 2))
            if (kind === 'Stadium') assert.ok(near(f.cornerRadius, Math.min(o.w, o.h) / 2))
          } else {
            assert.equal(f.fills.length, 0, `${id} wrapper has no fill`)
            assert.equal(f.strokes.length, 0, `${id} wrapper has no stroke`)
            assert.equal(vecs.length, 1, `${id} (${kind}) wraps exactly one merged vector`)
            assert.equal(vecs[0].layoutPositioning, 'ABSOLUTE')
            assert.equal(vecs[0].name, kind)
            assert.ok(near(vecs[0].x, 0) && near(vecs[0].y, 0))
            assert.ok(near(vecs[0].width, f.width) && near(vecs[0].height, f.height))
            assert.equal(solidKey(vecs[0].fills), solidKey(o.filled.fills), `${id} fill`)
            assert.equal(solidKey(vecs[0].strokes), solidKey(o.stroked.strokes), `${id} stroke`)
            assert.equal(vecs[0].strokeWeight, o.stroked.strokeWeight, `${id} weight`)
            if (o.dashed) assert.deepEqual(vecs[0].dashPattern, o.dashed.dashPattern, `${id} dash`)
            // vector goes below the label
            assert.ok(f.children.indexOf(vecs[0]) < f.children.indexOf(texts[0]))
          }
        }
      })

      test(`[${example}/${theme}] no stacked identical-bounds vector pairs remain`, async () => {
        const { root } = await load(example, theme)
        const vs = all(root, (n) => n.type === 'VECTOR' && n.width > 0 && n.height > 0)
        const dupes = []
        for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
          const a = rel(vs[i], root), b = rel(vs[j], root)
          // markers sit exactly on connector ends by design (arrowheads inside their own group)
          if (vs[i].parent.name.includes('(') || vs[j].parent.name.includes('(')) continue
          if (['x', 'y', 'width', 'height'].every((k) => near(a[k], b[k]))) dupes.push(`${vs[i].name}|${vs[j].name}`)
        }
        assert.deepEqual(dupes, [])
      })

      test(`[${example}/${theme}] relative layer order of nodes is preserved within each parent`, async () => {
        const { before, root } = await load(example, theme)
        const ids = all(before, (n) => n.type === 'GROUP' && NODE_RE.test(n.name)).map((n) => NODE_RE.exec(n.name)[1])
        const after = nodeFrames(root).map((f) => f.pluginData['mermapix:node'])
        assert.deepEqual([...after].sort(), [...ids].sort())
        for (const parent of all(root, (n) => n.children && n.children.some((c) => c.pluginData && c.pluginData['mermapix:node'] !== undefined))) {
          const order = parent.children.filter((c) => c.pluginData && c.pluginData['mermapix:node'] !== undefined).map((c) => ids.indexOf(c.pluginData['mermapix:node']))
          assert.deepEqual(order, [...order].sort((a, c) => a - c), `${parent.name}`)
        }
      })
    }

    test(`[${example}/${theme}] edge labels become pill frames (flowchart + ERD)`, async () => {
      const { root } = await load(example, theme)
      const labels = all(root, (n) => n.type === 'FRAME' && n.name.startsWith('Label: '))
      const want = {
        '1-ex-erd': ['places', 'contains', 'ordered as', 'groups', 'parent of', 'paid by'],
        '2-ex-flowchart': ['yes', 'no'],
        '3-ex-sequence': [],
        '4-ex-sitemap': ['featured on homepage'],
      }[example]
      assert.deepEqual(labels.map((l) => l.name.slice(7)).sort(), [...want].sort())
      for (const l of labels) {
        assert.equal(l.layoutMode, 'HORIZONTAL')
        assert.equal(l.primaryAxisSizingMode, 'FIXED')
        assert.equal(l.children.length, 1)
        assert.equal(l.children[0].type, 'TEXT')
        assert.equal(l.children[0].textAlignHorizontal, 'CENTER')
        assert.equal(l.fills.length, 1)
        assert.equal(l.strokes.length, 0)
      }
    })
  }

  test(`[ERD/${theme}] every entity is an Auto Layout table; no entity groups left (8.1 behavior)`, async () => {
    const { root, before } = await load('1-ex-erd', theme)
    const tables = all(root, (n) => n.type === 'FRAME' && n.layoutMode === 'VERTICAL' && (n.children || []).some((c) => c.name.startsWith('Header: ')))
    assert.deepEqual(tables.map((t) => t.name).sort(), ['CATEGORY', 'CUSTOMER', 'ORDER', 'ORDER_ITEM', 'PAYMENT', 'PRODUCT'])
    assert.equal(all(root, (n) => /-entity-[A-Z_]+-\d+$/.test(n.name)).length, 0)
    for (const t of tables) {
      const ent = all(before, (n) => n.type === 'GROUP' && new RegExp(`-entity-${t.name}-\\d+$`).test(n.name))[0]
      const b = rel(t, root), o = rel(ent, before)
      for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(b[k], o[k], 0.5), `${t.name} ${k}`)
    }
  })

  test(`[sequence/${theme}] sequence diagrams get frames now (phase 8.4); the full structure is asserted in plugin-sequence.test.mjs`, async () => {
    const { root } = await load('3-ex-sequence', theme)
    assert.ok(all(root, (n) => n.type === 'FRAME' && n !== root).length > 0)
  })
}

// ---------------------------------------------------------------- distribution + text overflow report

const EXPECTED_KINDS = {
  '2-ex-flowchart': { Rectangle: 4, Stadium: 1, Diamond: 1, Subroutine: 1, Cylinder: 1 },
  '4-ex-sitemap': { Rectangle: 16, Subroutine: 5, Cylinder: 3, Parallelogram: 3, Hexagon: 2, Circle: 4, Flag: 2 },
}

for (const theme of THEME_NAMES) {
  for (const [example, expected] of Object.entries(EXPECTED_KINDS)) {
    test(`[${example}/${theme}] detected shape kinds + text fit after the Inter switch`, async (t) => {
      const { root } = await load(example, theme)
      const kinds = {}
      let overflow = 0, tight = 0, minMargin = Infinity
      for (const f of nodeFrames(root)) {
        const k = f.pluginData['mermapix:kind']
        kinds[k] = (kinds[k] || 0) + 1
        const txt = f.children.find((c) => c.type === 'TEXT')
        const margin = f.width - txt.width
        minMargin = Math.min(minMargin, margin)
        if (margin < 0) overflow++
        else if (margin < 16) tight++
        assert.equal(txt.fontName.family, 'Inter')
      }
      t.diagnostic(`${example}/${theme} kinds=${JSON.stringify(kinds)} textOverflow=${overflow} tight(<16px spare)=${tight} minSpare=${minMargin.toFixed(1)}px`)
      assert.deepEqual(kinds, expected)
      assert.equal(overflow, 0, 'no label may be wider than its fixed frame')
    })
  }
}
