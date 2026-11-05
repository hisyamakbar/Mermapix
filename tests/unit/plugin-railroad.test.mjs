// Phase 9.2 railroad grammars end to end: terminals / non-terminals / special sequences are FRAMEs with fill +
// border merged and centered text, rules are `Rule: <name>` groups with named tracks and Start / End markers.
// Real built plugin/code.js on the real Mermaid payload SVGs (railroad-peg-beta and railroad-ebnf-beta, dark +
// light) and on the same payload relabeled as the sibling diagram types that share the renderer.
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { importSvg } from '../plugin-mock/svg-import.mjs'
import { layoutAuto } from '../plugin-mock/layout-sim.mjs'
import { runFixture, runSvg } from '../plugin-mock/run-fixture.mjs'
import { relBounds } from '../plugin-mock/survey-metrics.mjs'
import { boxKind, isRailroadType, isSpecialLabel, markerNames, ruleNameOf } from '../../plugin/src/railroadGeometry.ts'

const THEMES = ['dark', 'light']
const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol
const sig = (t) => `${t.characters.trim()}|${t.fontSize}`

const PEG_RULES = ['Expression', 'Term', 'Factor', 'Number', 'Digit']
const EBNF_RULES = ['Greeting', 'Name', 'Alias']

const cache = new Map()
async function load(example, theme, rename) {
  const key = `${example}/${theme}/${rename || ''}`
  if (!cache.has(key)) {
    let run = await runFixture(example, theme)
    if (rename) run = await runSvg(run.svg.replace(/aria-roledescription="[^"]+"/, `aria-roledescription="${rename}"`), theme)
    cache.set(key, { ...run, original: importSvg({ ids: 0 }, run.svg) })
  }
  return cache.get(key)
}

/** Ground truth from the untouched import: boxes (rect vectors that have a text group sibling) and circles. */
function originals(original) {
  const boxes = []
  const circles = []
  const tracks = []
  walk(original, (g) => {
    if (g.type !== 'GROUP' || !g.children) return
    const vs = g.children.filter((c) => c.type === 'VECTOR')
    const ts = g.children.filter((c) => c.type === 'TEXT' && c.characters.trim())
    const gs = g.children.filter((c) => c.type === 'GROUP')
    if (gs.length) return
    if (vs.length === 1 && ts.length === 1) boxes.push({ v: vs[0], t: ts[0], b: relBounds(vs[0], original) })
    else if (vs.length === 1 && ts.length === 0 && vs[0].fills.length) circles.push({ v: vs[0], b: relBounds(vs[0], original) })
  })
  const boxVecs = new Set(boxes.map((b) => b.v))
  const circleVecs = new Set(circles.map((c) => c.v))
  walk(original, (n) => { if (n.type === 'VECTOR' && !boxVecs.has(n) && !circleVecs.has(n)) tracks.push(n) })
  return { boxes, circles, tracks }
}

const CASES = [
  { example: '38-case-railroad', rules: PEG_RULES, rename: null },
  { example: '39-case-railroad-ebnf', rules: EBNF_RULES, rename: null },
]

for (const theme of THEMES) {
  for (const { example, rules } of CASES) {
    test(`[railroad/${theme}] ${example}: boxes are frames (paint merged, FIXED, centered text), no stray vectors`, async () => {
      const { root, original } = await load(example, theme)
      const { boxes, circles, tracks } = originals(original)
      assert.ok(boxes.length >= 5)
      assert.ok(!root.pluginData || !root.pluginData['mermapix:fallback'], 'generic fallback did not run')
      // every remaining vector is a Track: stroke only, same count as the original track paths
      const vectors = all(root, (n) => n.type === 'VECTOR')
      assert.equal(vectors.length, tracks.length)
      assert.ok(vectors.every((v) => v.name === 'Track' && v.fills.length === 0 && v.strokes.length > 0), 'tracks are unfilled strokes')
      const frames = all(root, (n) => n.type === 'FRAME' && /^(Terminal|NonTerminal|Special): /.test(n.name))
      assert.equal(frames.length, boxes.length)
      for (const { v, t, b } of boxes) {
        const f = frames.find((n) => { const r = relBounds(n, root); return near(r.x, b.x) && near(r.y, b.y) && near(r.width, b.width) && near(r.height, b.height) })
        assert.ok(f, `frame for ${t.characters}`)
        const rounded = v.vectorPaths[0].data.includes('C')
        const label = t.characters.trim()
        const expectKind = rounded ? 'Terminal' : /^\? .* \?$/.test(label) ? 'Special' : 'NonTerminal'
        assert.equal(f.name, `${expectKind}: ${label}`)
        assert.equal(f.pluginData['mermapix:kind'], `Railroad ${expectKind}`)
        assert.equal(JSON.stringify(f.fills), JSON.stringify(v.fills), `${f.name} fill`)
        assert.equal(JSON.stringify(f.strokes), JSON.stringify(v.strokes), `${f.name} stroke`)
        assert.equal(f.strokeWeight, v.strokeWeight)
        assert.equal(f.cornerRadius, rounded ? 10 : 0, `${f.name} corner radius kept`)
        assert.equal(f.layoutMode, 'HORIZONTAL')
        assert.equal(f.primaryAxisSizingMode, 'FIXED')
        assert.equal(f.counterAxisSizingMode, 'FIXED')
        assert.equal(f.primaryAxisAlignItems, 'CENTER')
        assert.equal(f.counterAxisAlignItems, 'CENTER')
        assert.equal(f.children.length, 1)
        // the text sits where Mermaid put it (vertical 1px; horizontal only differs by the importer's width estimate)
        const [{ node, x, y }] = layoutAuto(f)
        const fb = relBounds(f, root)
        const ob = relBounds(t, original)
        assert.ok(near(fb.y + y + node.height / 2, ob.y + ob.height / 2, 1), `${f.name} vertical center`)
        assert.ok(near(fb.x + x + node.width / 2, ob.x + ob.width / 2, 3), `${f.name} horizontal center`)
        assert.equal(node.fontSize, t.fontSize)
      }
      // start / end markers: circle frames at the circle bounds with the marker fill
      const markers = all(root, (n) => n.type === 'FRAME' && (n.name === 'Start' || n.name === 'End'))
      assert.equal(markers.length, circles.length)
      assert.equal(markers.filter((m) => m.name === 'Start').length, rules.length)
      assert.equal(markers.filter((m) => m.name === 'End').length, rules.length)
      for (const { v, b } of circles) {
        const m = markers.find((n) => { const r = relBounds(n, root); return near(r.x, b.x) && near(r.y, b.y) && near(r.width, b.width) })
        assert.ok(m, 'marker frame at the circle bounds')
        assert.equal(JSON.stringify(m.fills), JSON.stringify(v.fills))
        assert.equal(m.cornerRadius, b.width / 2)
      }
    })

    test(`[railroad/${theme}] ${example}: one flat \`Rule: <name>\` group per rule with name text, tracks, boxes and markers`, async () => {
      const { root } = await load(example, theme)
      assert.ok(root.children.every((c) => c.type === 'GROUP' && c.name.startsWith('Rule: ')), 'only rule groups at the top level')
      assert.deepEqual(root.children.map((c) => c.name), rules.map((r) => `Rule: ${r}`))
      for (const g of root.children) {
        const name = g.name.slice('Rule: '.length)
        assert.ok(g.children.every((c) => c.type !== 'GROUP'), `${g.name}: flat`)
        const nameText = g.children.filter((c) => c.type === 'TEXT')
        assert.equal(nameText.length, 1)
        assert.equal(nameText[0].characters.trim(), `${name} =`)
        assert.equal(nameText[0].fontName.family, 'Inter')
        assert.equal(nameText[0].fontName.style, 'Bold')
        assert.equal(g.children.filter((c) => c.name === 'Start').length, 1)
        assert.equal(g.children.filter((c) => c.name === 'End').length, 1)
        assert.ok(g.children.filter((c) => c.name === 'Track').length >= 2)
        assert.ok(g.children.filter((c) => /^(Terminal|NonTerminal|Special): /.test(c.name)).length >= 1)
        assert.equal(g.pluginData['mermapix:kind'], 'Railroad Rule')
      }
      // texts: same characters + sizes as the payload (rule names, box labels), none lost
      const { original } = await load(example, theme)
      const before = all(original, (n) => n.type === 'TEXT' && n.characters.trim()).map(sig).sort()
      const after = all(root, (n) => n.type === 'TEXT' && n.characters.trim()).map(sig).sort()
      assert.deepEqual(after, before)
    })
  }

  test(`[railroad/${theme}] rule name text keeps its left edge and vertical center`, async () => {
    const { root, original } = await load('38-case-railroad', theme)
    for (const t of all(root, (n) => n.type === 'TEXT' && /\s=$/.test(n.characters))) {
      const raw = all(original, (n) => n.type === 'TEXT' && n.characters.trim() === t.characters.trim())[0]
      const a = relBounds(t, root)
      const b = relBounds(raw, original)
      assert.ok(near(a.x, b.x, 0.5), `${t.characters} left edge`)
      assert.ok(near(a.y + a.height / 2, b.y + b.height / 2, 0.5), `${t.characters} vertical center`)
    }
  })

  test(`[railroad/${theme}] sibling grammar types (railroad, railroadEbnf, railroadAbnf) route to the same converter`, async () => {
    for (const type of ['railroad', 'railroadEbnf', 'railroadAbnf']) {
      const { root } = await load('38-case-railroad', theme, type)
      assert.deepEqual(root.children.map((c) => c.name), PEG_RULES.map((r) => `Rule: ${r}`), type)
      assert.equal(all(root, (n) => n.type === 'FRAME' && /^Terminal: /.test(n.name)).length > 0, true)
    }
  })

  test(`[railroad/${theme}] the special-sequence label becomes \`Special: …\` (square, not a terminal)`, async () => {
    const { root } = await load('39-case-railroad-ebnf', theme)
    const specials = all(root, (n) => n.type === 'FRAME' && n.name.startsWith('Special: '))
    assert.equal(specials.length, 1)
    assert.equal(specials[0].name, 'Special: ? any word ?')
    assert.equal(specials[0].cornerRadius, 0)
  })
}

test('railroad geometry helpers: type routing, box kinds, rule names, marker names', () => {
  for (const t of ['railroad', 'railroadEbnf', 'railroadAbnf', 'railroadPeg']) assert.equal(isRailroadType(t), true)
  for (const t of ['treemap', 'flowchart', '', undefined, 'railroadX']) assert.equal(isRailroadType(t), false)
  assert.equal(boxKind(10, 'x'), 'Terminal')
  assert.equal(boxKind(0, 'Term'), 'NonTerminal')
  assert.equal(boxKind(0, '? any word ?'), 'Special')
  assert.equal(boxKind(10, '? looks special ?'), 'Terminal', 'a rounded box is always a terminal')
  assert.equal(isSpecialLabel('? x ?'), true)
  assert.equal(isSpecialLabel('?x?'), false)
  assert.equal(ruleNameOf('Expression =', 700), 'Expression')
  assert.equal(ruleNameOf('Expression =', 400), null, 'not bold: a terminal like "=" is not a rule name')
  assert.equal(ruleNameOf('Expression', 700), null)
  assert.deepEqual(markerNames([100, 360]), ['Start', 'End'])
  assert.deepEqual(markerNames([360, 100]), ['End', 'Start'])
  assert.deepEqual(markerNames([1, 2, 3]), ['Marker', 'Marker', 'Marker'])
})
