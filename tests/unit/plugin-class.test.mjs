// Phase 8.5 end to end: classDiagram boxes become Auto Layout class frames (header / attributes / methods,
// dividers merged), namespaces and notes become frames, relations are grouped like flowchart edges.
// Real built plugin/code.js on the real Mermaid payload SVGs (dark + light).
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { importSvg } from '../plugin-mock/svg-import.mjs'
import { runFixture } from '../plugin-mock/run-fixture.mjs'
import { layoutVertical } from '../plugin-mock/layout-sim.mjs'
import { isGenericName, relBounds } from '../plugin-mock/survey-metrics.mjs'
import { vectorPolyline } from '../../plugin/src/connectorGeometry.ts'

const THEMES = ['dark', 'light']
const EXAMPLE = '9-case-class'
const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol
const CLASS_RE = /-classId-(.+)-(\d+)$/
const rel = relBounds
const textsOf = (tree) => all(tree, (n) => n.type === 'TEXT' && n.characters.trim()).map((t) => t.characters.trim()).sort()
const solidKey = (paints) => JSON.stringify((paints || []).map((p) => [p.type, p.color, p.opacity ?? 1]))

const runs = new Map()
async function load(theme) {
  if (!runs.has(theme)) {
    const r = await runFixture(EXAMPLE, theme)
    const before = importSvg({ ids: 0 }, r.svgSeen)
    const boxes = all(before, (n) => n.type === 'GROUP' && CLASS_RE.test(n.name)).map((g) => {
      const vs = all(g, (n) => n.type === 'VECTOR')
      const big = vs.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
      return {
        id: CLASS_RE.exec(g.name)[1],
        box: rel(big, before),
        dividers: vs.filter((v) => v.height <= 1.5).map((v) => ({ y: rel(v, before).y, weight: v.strokeWeight })).sort((a, b) => a.y - b.y),
        texts: all(g, (n) => n.type === 'TEXT' && n.characters.trim()).map((t) => ({ s: t.characters.trim(), b: rel(t, before), w: t.fontWeight })),
        fillKey: solidKey(vs[0].fills),
        strokeKey: solidKey(vs[0].strokes),
      }
    })
    runs.set(theme, { ...r, before, boxes })
  }
  return runs.get(theme)
}

const classFrames = (root) => all(root, (n) => n.type === 'FRAME' && n.pluginData && n.pluginData['mermapix:kind'] === 'Class')

for (const theme of THEMES) {
  const tag = `[class/${theme}]`

  test(`${tag} every class box becomes a vertical Auto Layout FRAME at the exact bounds with merged border`, async () => {
    const run = await load(theme)
    const frames = classFrames(run.root)
    assert.equal(frames.length, run.boxes.length)
    assert.ok(run.boxes.length >= 6)
    assert.equal(all(run.root, (n) => n.type === 'GROUP' && CLASS_RE.test(n.name)).length, 0, 'no raw class groups left')
    for (const c of run.boxes) {
      const f = frames.find((x) => x.pluginData['mermapix:node'] === c.id)
      assert.ok(f, c.id)
      assert.equal(f.type, 'FRAME')
      assert.ok(f.name.startsWith('Class: '), f.name)
      const b = rel(f, run.root)
      for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(b[k], c.box[k]), `${c.id} ${k} ${b[k]} vs ${c.box[k]}`)
      assert.equal(f.layoutMode, 'VERTICAL')
      assert.equal(f.primaryAxisSizingMode, 'FIXED')
      assert.equal(f.counterAxisSizingMode, 'FIXED')
      assert.equal(solidKey(f.fills), c.fillKey, `${c.id} fill`)
      assert.equal(solidKey(f.strokes), c.strokeKey, `${c.id} stroke`)
      assert.equal(f.strokeWeight, 1)
      assert.equal(all(f, (n) => n.type === 'VECTOR').length, 0, 'border + dividers merged: no vector inside a class frame')
      // compartments tile the box exactly
      assert.ok(f.children.length === c.dividers.length + 1, `${c.id} compartments`)
      assert.equal(f.children[0].name, 'Header')
      assert.deepEqual(f.children.slice(1).map((k) => k.name), c.dividers.length === 2 ? ['Attributes', 'Methods'] : ['Members'])
      assert.ok(near(f.children.reduce((a, k) => a + k.height, 0), c.box.height), `${c.id} heights add up`)
      f.children.forEach((k, i) => {
        assert.equal(k.layoutAlign, 'STRETCH')
        assert.ok(near(k.width, f.width))
        const d = c.dividers[i]
        if (d) {
          assert.equal(k.strokeAlign, 'INSIDE')
          assert.equal(k.strokeBottomWeight, d.weight)
          assert.equal(k.strokeTopWeight, 0)
          assert.equal(solidKey(k.strokes), c.strokeKey)
        } else assert.ok(!k.strokes || k.strokes.length === 0 || !k.strokeBottomWeight, 'last compartment has no divider')
      })
      // the inside-bottom border sits exactly on the original centered divider stroke
      let top = 0
      f.children.forEach((k, i) => {
        const d = c.dividers[i]
        if (d) assert.ok(near(top + k.height - d.weight / 2, d.y - c.box.y, 0.01), `${c.id} divider ${i}`)
        top += k.height
      })
    }
  })

  test(`${tag} Auto Layout puts every line back where Mermaid had it (center y <= 0.25px, left x <= 0.5px, header center <= 0.5px)`, async () => {
    const run = await load(theme)
    for (const c of run.boxes) {
      const f = classFrames(run.root).find((x) => x.pluginData['mermapix:node'] === c.id)
      const fb = rel(f, run.root)
      let top = 0
      f.children.forEach((comp, ci) => {
        const pos = layoutVertical(comp)
        for (const { node: t, x, y } of pos) {
          assert.equal(t.fontName.family, 'Inter')
          const want = c.texts.find((o) => o.s === t.characters.trim() && Math.abs(o.b.y + o.b.height / 2 - (fb.y + top + y + t.height / 2)) < 0.25)
          assert.ok(want, `${c.id}/${comp.name}: "${t.characters}" y=${fb.y + top + y + t.height / 2}`)
          if (ci === 0) {
            const cx = fb.x + x + t.width / 2
            assert.ok(near(cx, want.b.x + want.b.width / 2, 0.5), `${c.id} header center x ${cx} vs ${want.b.x + want.b.width / 2}`)
            assert.equal(t.textAlignHorizontal, 'CENTER')
          } else {
            assert.ok(near(fb.x + x, want.b.x, 0.5), `${c.id} member left x`)
            assert.equal(t.textAlignHorizontal, 'LEFT')
          }
        }
        top += comp.height
      })
    }
  })

  test(`${tag} annotations and titles: «abstract» / «interface» sit above the class name`, async () => {
    const run = await load(theme)
    const frames = classFrames(run.root)
    const shape = frames.find((f) => f.name === 'Class: Shape')
    const flyer = frames.find((f) => f.name === 'Class: Flyer')
    for (const f of [shape, flyer]) {
      const header = f.children[0]
      assert.equal(header.children.length, 2)
      assert.ok(header.children[0].name.startsWith('Annotation: '))
      assert.ok(header.children[1].name.startsWith('Title: '))
    }
    assert.equal(frames.find((f) => f.name === 'Class: Pond').children[0].children.length, 1)
    // classes without members still show both empty compartments (Mermaid draws both)
    assert.equal(frames.find((f) => f.name === 'Class: Pond').children.length, 3)
  })

  test(`${tag} zero-drop: every text is present exactly once`, async () => {
    const run = await load(theme)
    assert.deepEqual(textsOf(run.root), textsOf(run.before))
    assert.equal(all(run.root, (n) => n.type === 'TEXT' && !n.characters.trim()).length, 0)
  })

  test(`${tag} namespace is a container FRAME holding its classes; notes are Auto Layout frames`, async () => {
    const run = await load(theme)
    const ns = all(run.root, (n) => n.type === 'FRAME' && n.name === 'Namespace: Shapes')[0]
    assert.ok(ns, 'namespace frame')
    assert.equal(ns.layoutMode, 'NONE')
    assert.equal(ns.clipsContent, false)
    const rawNs = all(run.before, (n) => n.type === 'GROUP' && n.name.endsWith('-Shapes'))[0]
    const rb = rel(all(rawNs, (n) => n.type === 'VECTOR')[0], run.before)
    const nb = rel(ns, run.root)
    for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(nb[k], rb[k]), `namespace ${k}`)
    assert.deepEqual(ns.children.filter((k) => k.name.startsWith('Class: ')).map((k) => k.name).sort(), ['Class: Circle', 'Class: Shape'])
    assert.equal(ns.children[0].type, 'TEXT', 'title is the bottom-most child')
    // absolute bounds of the members are unchanged
    for (const k of ns.children.filter((x) => x.name.startsWith('Class: '))) {
      const c = run.boxes.find((o) => o.id === k.pluginData['mermapix:node'])
      const b = rel(k, run.root)
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(near(b[key], c.box[key]), `${k.name} ${key}`)
    }
    const note = all(run.root, (n) => n.type === 'FRAME' && n.name === 'Note: Quacks loudly')[0]
    assert.ok(note)
    assert.equal(note.layoutMode, 'HORIZONTAL')
    assert.equal(all(note, (n) => n.type === 'VECTOR').length, 0)
    const rawNote = all(run.before, (n) => n.type === 'GROUP' && /-note0$/.test(n.name))[0]
    const nv = rel(all(rawNote, (n) => n.type === 'VECTOR')[0], run.before)
    const b = rel(note, run.root)
    for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(b[k], nv[k]), `note ${k}`)
  })

  test(`${tag} relations: one 'Edge: A → B' group each inside one top 'Connectors' group, class markers keep their names`, async () => {
    const run = await load(theme)
    const connectors = all(run.root, (n) => n.type === 'GROUP' && n.name === 'Connectors')
    assert.equal(connectors.length, 1)
    assert.equal(run.root.children[run.root.children.length - 1], connectors[0], 'Connectors is the top layer')
    const edges = connectors[0].children.filter((n) => n.name.startsWith('Edge: '))
    const names = edges.map((e) => e.name).sort()
    assert.deepEqual(names, [
      'Edge: Animal → Duck', 'Edge: Animal → Flyer', 'Edge: Animal → Pond', 'Edge: Duck → Flyer',
      'Edge: Duck → Pond', 'Edge: Pond → Duck', 'Edge: Quacks loudly → Duck', 'Edge: Shape → Circle',
    ])
    const rawEdges = all(run.before, (n) => n.type === 'VECTOR' && /-(id_.+_\d+|edgeNote\d+)$/.test(n.name))
    assert.equal(edges.length, rawEdges.length)
    for (const e of edges) assert.equal(e.children.filter((k) => k.name === 'Line').length, 1)
    const markerNames = (e) => e.children.filter((k) => k.type === 'GROUP').map((k) => k.name)
    assert.deepEqual(markerNames(edges.find((e) => e.name === 'Edge: Animal → Duck')), ['Inheritance Arrow'])
    assert.deepEqual(markerNames(edges.find((e) => e.name === 'Edge: Pond → Duck')), ['Composition Diamond'])
    assert.deepEqual(markerNames(edges.find((e) => e.name === 'Edge: Animal → Pond')), ['Aggregation Diamond'])
    assert.deepEqual(markerNames(edges.find((e) => e.name === 'Edge: Animal → Flyer')), ['Dependency Arrow'])
    // the relation label travels with its edge
    assert.ok(edges.find((e) => e.name === 'Edge: Duck → Pond').children.some((k) => k.type === 'FRAME' && k.name === 'Label: lives in'))
    // edge lines stay exactly where they were
    const lines = edges.map((e) => rel(e.children.find((k) => k.name === 'Line'), run.root)).map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`).sort()
    const raw = rawEdges.map((v) => rel(v, run.before)).map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`).sort()
    assert.deepEqual(lines, raw)
  })

  test(`${tag} connectors never reach into a class box (paint order: namespace < classes < connectors)`, async () => {
    const run = await load(theme)
    const frames = classFrames(run.root)
    for (const g of all(run.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: '))) {
      const line = g.children.find((k) => k.name === 'Line')
      const b = rel(line, run.root)
      const pts = vectorPolyline(line.vectorPaths[0].data, b.x, b.y)
      for (const f of frames) {
        const r = rel(f, run.root)
        const depth = (p) => Math.min(p.x - r.x, r.x + r.width - p.x, p.y - r.y, r.y + r.height - p.y)
        for (const p of pts) assert.ok(depth(p) <= 1.5, `${g.name} enters ${f.name} by ${depth(p)}`)
      }
    }
    // z-order: namespace frame below its classes below Connectors (Mermaid: clusters, then nodes)
    const idx = (n) => run.root.children.indexOf(n)
    const ns = run.root.children.find((n) => n.name === 'Namespace: Shapes')
    const connectors = run.root.children.find((n) => n.name === 'Connectors')
    for (const f of run.root.children.filter((n) => n.name.startsWith('Class: ') || n.name.startsWith('Note: '))) {
      assert.ok(idx(ns) < idx(f) && idx(f) < idx(connectors), f.name)
    }
    for (const f of ns.children.filter((n) => n.name.startsWith('Class: '))) assert.ok(ns.children.indexOf(f) > 0)
  })

  test(`${tag} no generic layer names (Vector / Group / Frame / mermaid-*)`, async () => {
    const run = await load(theme)
    const bad = all(run.root, (n, p) => n !== run.root && isGenericName(n.name) && !(n.name === 'Line' && p && p.name.startsWith('Edge: ')))
    assert.deepEqual(bad.map((n) => `${n.type}:${n.name}`), [])
    assert.equal(all(run.root, (n) => n.type === 'VECTOR' && n.name === 'Vector').length, 0)
  })
}

test('[class extras/dark] generics, label, lollipop interface, free note, cardinalities: no crash, zero-drop, no generic names', async () => {
  const r = await runFixture('35-case-class-extras', 'dark')
  const before = importSvg({ ids: 0 }, r.svgSeen)
  assert.deepEqual(textsOf(r.root), textsOf(before))
  const names = r.root.children.map((n) => n.name)
  for (const n of ['Class: List<T>', 'Class: Repository (generic)', 'Class: A', 'Class: B', 'Interface: A', 'Note: A free floating note', 'Connectors']) assert.ok(names.includes(n), n)
  assert.ok(!names.some((n) => n.startsWith('Namespace')), 'the lollipop interface is not mistaken for a namespace')
  const annotation = all(r.root, (n) => n.type === 'TEXT' && n.name.startsWith('Annotation: '))
  assert.deepEqual(annotation.map((n) => n.characters.trim()), ['«Service»'])
  const edges = all(r.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: '))
  assert.equal(edges.length, 5)
  assert.ok(edges.some((e) => e.name === 'Edge: List<T> → Repository (generic)'))
  assert.ok(edges.some((e) => e.children.some((k) => k.name === 'Lollipop')))
  const bad = all(r.root, (n, p) => n !== r.root && isGenericName(n.name) && !(n.name === 'Line' && p && p.name.startsWith('Edge: ')))
  assert.deepEqual(bad.map((n) => `${n.type}:${n.name}`), [])
})
