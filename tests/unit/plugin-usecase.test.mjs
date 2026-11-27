// Phase 14.3 end to end: usecase-beta (Mermaid 12.3.0) actors, use cases, notes, system boundaries / packages and
// relations become named frames and `Edge: A → B` groups. Real built plugin/code.js on the real Mermaid payload SVGs
// (dark + light; fixtures 43, 44 and 46).
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { runSvg, runSurvey, readSurveySvg } from '../plugin-mock/run-fixture.mjs'
import { layoutCentered } from '../plugin-mock/layout-sim.mjs'
import { all, near, rel, kindOf, roleOf, byName, isUnpainted, solidKey, rawOf, assertBounds, insideBox, assertStructured } from '../plugin-mock/diagram-asserts.mjs'
import { createSession } from '../plugin-mock/session.mjs'
import { THEMES } from '../plugin-mock/run-fixture.mjs'
import { applyTextChanges } from '../../src/plugin/sourcePatch.ts'
import { classifyUsecaseGroup, actorPartNames, actorNameTexts, usecaseNodeId, isCentredIn } from '../../plugin/src/usecaseGeometry.ts'
import { edgeBodyFromName, isAnonymousEdgeName } from '../../plugin/src/connectorGeometry.ts'

const THEME_LIST = ['dark', 'light']
const NODE_RE = /-usecase-(.+)$/
const source = (n) => fs.readFileSync(new URL(`../figma-fixtures/${n}.mmd`, import.meta.url), 'utf8')

const runs = new Map()
async function load(type, theme) {
  const k = `${type}/${theme}`
  if (!runs.has(k)) {
    const run = await runSurvey(type, theme)
    const before = rawOf(run)
    // raw node groups by Mermaid id, with their vectors / texts
    const groups = new Map()
    for (const g of all(before, (n) => n.type === 'GROUP' && NODE_RE.test(n.name) && !n.name.includes('inlined-marker'))) {
      groups.set(NODE_RE.exec(g.name)[1], {
        vectors: all(g, (n) => n.type === 'VECTOR'),
        texts: all(g, (n) => n.type === 'TEXT' && n.characters.trim()),
      })
    }
    runs.set(k, { ...run, before, groups })
  }
  return runs.get(k)
}
const edgeGroups = (run) => all(run.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: '))
const useCases = (run) => all(run.root, (n) => n.type === 'FRAME' && roleOf(n) === 'usecase')
const markerNames = (e) => e.children.filter((k) => k.type === 'GROUP').map((k) => k.name)
const bigVector = (g) => g.vectors.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))

for (const theme of THEME_LIST) {
  const tag = `[usecase/${theme}]`

  test(`${tag} checkout: boundary, actors, use cases and one Connectors group, named like the diagram`, async () => {
    const run = await load('usecase', theme)
    assertStructured(run, tag)
    const top = run.root.children.map((c) => c.name)
    assert.deepEqual(top, ['System Boundary: Online shop', 'Actor: Customer', 'Actor: Administrator', 'Connectors'])
    assert.equal(run.root.children[run.root.children.length - 1].name, 'Connectors', 'connectors on top')
    const boundary = byName(run.root, 'System Boundary: Online shop')
    assert.equal(boundary.type, 'FRAME')
    assert.equal(kindOf(boundary), 'System Boundary')
    assert.equal(boundary.pluginData['mermapix:cluster'], 'shop')
    assert.equal(boundary.layoutMode, 'NONE')
    assert.equal(boundary.clipsContent, false)
    assert.deepEqual(boundary.children.map((c) => c.name), [
      'Online shop', 'Use Case: Browse products', 'Use Case: Place order', 'Use Case: Pay', 'Use Case: Apply coupon', 'Use Case: Manage catalogue',
    ])
  })

  test(`${tag} checkout: use cases are wrapper frames at the ellipse bounds (a frame cannot be elliptical): paint stays on the vector, label centred`, async () => {
    const run = await load('usecase', theme)
    const ucs = useCases(run)
    assert.equal(ucs.length, 5)
    const boundary = byName(run.root, 'System Boundary: Online shop')
    const bb = rel(boundary, run.root)
    for (const f of ucs) {
      const id = f.pluginData['mermapix:node']
      const raw = run.groups.get(id)
      const ell = bigVector(raw)
      assertBounds(rel(f, run.root), rel(ell, run.before), f.name)
      assert.equal(f.layoutMode, 'HORIZONTAL')
      assert.equal(f.primaryAxisSizingMode, 'FIXED')
      assert.equal(f.counterAxisSizingMode, 'FIXED')
      assert.equal(f.primaryAxisAlignItems, 'CENTER')
      assert.equal(f.counterAxisAlignItems, 'CENTER')
      assert.equal(f.fills.length, 0, 'the wrapper carries no paint')
      assert.equal(kindOf(f), 'Ellipse')
      const vec = f.children.filter((c) => c.type === 'VECTOR')
      assert.equal(vec.length, 1)
      assert.equal(vec[0].name, 'Ellipse')
      assert.equal(vec[0].layoutPositioning, 'ABSOLUTE')
      assert.equal(solidKey(vec[0].fills), solidKey(ell.fills))
      assert.equal(solidKey(vec[0].strokes), solidKey(ell.strokes))
      assert.equal(vec[0].strokeWeight, ell.strokeWeight)
      const text = f.children.filter((c) => c.type === 'TEXT')
      assert.equal(text.length, 1)
      assert.equal(f.name, `Use Case: ${text[0].characters}`)
      assert.equal(f.pluginData['mermapix:label'], text[0].characters)
      assert.equal(text[0].fontName.family, 'Inter')
      // Auto Layout puts the label where Mermaid had it: centred on the shape horizontally (the mock measures Arial a few px
      // narrower than the real font, so the raw label's own x is not a reference), at the raw label's height vertically
      const pos = layoutCentered(f, text[0])
      const rawT = rel(raw.texts[0], run.before)
      const fb = rel(f, run.root)
      assert.ok(near(fb.x + pos.x + text[0].width / 2, fb.x + fb.width / 2, 0.5), `${f.name} label x`)
      assert.ok(near(fb.y + pos.y + text[0].height / 2, rawT.y + rawT.height / 2, 1.5), `${f.name} label y`)
      // contained: a child of the boundary frame, geometrically inside it
      assert.equal(f.parent, boundary)
      assert.ok(insideBox(bb, fb), `${f.name} inside the boundary`)
    }
  })

  test(`${tag} checkout: boundary frame carries the rect's paint at its exact bounds, title inside`, async () => {
    const run = await load('usecase', theme)
    const boundary = byName(run.root, 'System Boundary: Online shop')
    const raw = run.groups.get('shop')
    const rect = bigVector(raw)
    assertBounds(rel(boundary, run.root), rel(rect, run.before), 'boundary')
    assert.equal(solidKey(boundary.fills), solidKey(rect.fills))
    assert.equal(solidKey(boundary.strokes), solidKey(rect.strokes))
    assert.equal(boundary.strokeWeight, rect.strokeWeight)
    assert.equal(boundary.children.filter((n) => n.type === 'VECTOR').length, 0, 'the rect is merged into the frame')
    const title = boundary.children[0]
    assert.equal(title.type, 'TEXT')
    assert.equal(title.characters, 'Online shop')
    assert.equal(boundary.pluginData['mermapix:label'], 'Online shop')
    // z-order: the boundary is the bottom layer
    assert.equal(run.root.children[0], boundary)
  })

  test(`${tag} checkout: an actor is ONE frame (figure + name) at the hit-area bounds; the invisible hit rect is gone`, async () => {
    const run = await load('usecase', theme)
    for (const [id, name] of [['Customer', 'Actor: Customer'], ['Admin', 'Actor: Administrator']]) {
      const f = byName(run.root, name)
      assert.ok(f, name)
      const raw = run.groups.get(id)
      const hit = raw.vectors.find(isUnpainted)
      const fig = raw.vectors.filter((v) => !isUnpainted(v))
      assert.ok(hit && fig.length === 1)
      assertBounds(rel(f, run.root), rel(hit, run.before), name)
      assert.equal(f.type, 'FRAME')
      assert.equal(f.layoutMode, 'NONE')
      assert.equal(f.clipsContent, false)
      assert.equal(f.fills.length, 0)
      assert.equal(f.pluginData['mermapix:node'], id)
      assert.equal(kindOf(f), 'Actor')
      assert.deepEqual(f.children.map((c) => `${c.type}:${c.name}`), ['VECTOR:Figure', `TEXT:${raw.texts[0].characters}`])
      // the figure keeps its absolute bounds, the name keeps its centre
      assertBounds(rel(f.children[0], run.root), rel(fig[0], run.before), `${name} figure`)
      assert.equal(solidKey(f.children[0].strokes), solidKey(fig[0].strokes))
      const t = rel(f.children[1], run.root)
      const rt = rel(raw.texts[0], run.before)
      assert.ok(near(t.x + t.width / 2, rt.x + rt.width / 2, 1) && near(t.y + t.height / 2, rt.y + rt.height / 2, 1), `${name} name centre`)
      assert.equal(f.children[1].fontName.family, 'Inter')
      assert.ok(insideBox(rel(f, run.root), t, 8), 'the name fits in the actor frame')
    }
    assert.equal(all(run.root, (n) => n.type === 'VECTOR' && isUnpainted(n)).length, 0, 'no unpainted vector left')
  })

  test(`${tag} checkout: every relation is one 'Edge: A → B' group in Connectors, with its marker and label`, async () => {
    const run = await load('usecase', theme)
    const connectors = byName(run.root, 'Connectors')
    const edges = connectors.children.filter((n) => n.name.startsWith('Edge: '))
    assert.equal(connectors.children.length, edges.length)
    const rawEdges = all(run.before, (n) => n.type === 'VECTOR' && /^usecase-.*-edge-\d+$/.test(n.name))
    assert.equal(rawEdges.length, 5)
    assert.deepEqual(edges.map((e) => e.name).sort(), [
      'Edge: Administrator → Manage catalogue', 'Edge: Apply coupon → Place order', 'Edge: Customer → Browse products',
      'Edge: Customer → Place order', 'Edge: Place order → Pay',
    ])
    for (const e of edges) {
      assert.equal(e.children.filter((k) => k.name === 'Line').length, 1)
      assert.deepEqual(markerNames(e), ['inlined-marker'].length ? markerNames(e).map(() => 'Arrowhead (end)') : [])
      assert.equal(markerNames(e).length, 1, `${e.name} keeps its arrowhead`)
    }
    const label = (n) => edges.find((e) => e.name === n).children.filter((k) => k.type === 'FRAME').map((k) => k.name)
    assert.deepEqual(label('Edge: Place order → Pay'), ['Label: «include»'])
    assert.deepEqual(label('Edge: Apply coupon → Place order'), ['Label: «extend»'])
    assert.deepEqual(label('Edge: Customer → Browse products'), [])
    const key = (b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`
    assert.deepEqual(edges.map((e) => key(rel(e.children.find((k) => k.name === 'Line'), run.root))).sort(), rawEdges.map((v) => key(rel(v, run.before))).sort())
    // dashed include / extend relations keep their dash
    for (const n of ['Edge: Place order → Pay', 'Edge: Apply coupon → Place order']) assert.ok(edges.find((e) => e.name === n).children.find((k) => k.name === 'Line').dashPattern.length > 0)
  })

  test(`${tag} variants: package boundary (Tab + Body), hollow / awesome / plain actors, rect-form use case, note, circle end, generalization`, async () => {
    const run = await load('usecase-variants', theme)
    assertStructured(run, tag)
    const top = run.root.children.map((c) => c.name)
    assert.deepEqual(top, [
      'Package: Billing', 'Actor: Clerk', 'Actor: Guest', 'Actor: Auditor', 'Actor: Staff', 'Note: Generalises Clerk', 'Connectors',
    ])
    const pkg = byName(run.root, 'Package: Billing')
    assert.equal(kindOf(pkg), 'Package')
    assert.equal(pkg.pluginData['mermapix:cluster'], 'billing')
    assert.equal(pkg.fills.length, 0)
    assert.deepEqual(pkg.children.map((c) => c.name), ['Tab', 'Body', 'Use Case: Create invoice', 'Use Case: Print receipt', 'Use Case: Refund order'])
    const raw = run.groups.get('billing').vectors
    const tabRaw = raw.reduce((a, b) => (b.width * b.height < a.width * a.height ? b : a))
    const bodyRaw = raw.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
    const [tab, body] = pkg.children
    assertBounds(rel(tab, run.root), rel(tabRaw, run.before), 'tab')
    assertBounds(rel(body, run.root), rel(bodyRaw, run.before), 'body')
    assertBounds(rel(pkg, run.root), { x: Math.min(rel(tabRaw, run.before).x, rel(bodyRaw, run.before).x), y: rel(tabRaw, run.before).y, width: rel(bodyRaw, run.before).width, height: rel(bodyRaw, run.before).height + rel(tabRaw, run.before).height }, 'package union')
    assert.equal(solidKey(tab.fills), solidKey(tabRaw.fills))
    assert.equal(solidKey(body.fills), solidKey(bodyRaw.fills))
    assert.equal(body.children.length, 0)
    assert.deepEqual(tab.children.map((c) => c.characters), ['Billing'])
    for (const c of pkg.children.slice(2)) assert.ok(insideBox(rel(body, run.root), rel(c, run.root)), `${c.name} inside the body`)
    // actors by variant
    assert.deepEqual(byName(run.root, 'Actor: Clerk').children.map((c) => c.name), ['Head', 'Body', 'Clerk'])
    assert.deepEqual(byName(run.root, 'Actor: Guest').children.map((c) => c.name), ['Figure', 'Guest'])
    assert.deepEqual(byName(run.root, 'Actor: Auditor').children.map((c) => c.name), ['Figure', 'Auditor'])
    // `Receipt[Print receipt]`: rect form = Auto Layout frame carrying the paint, no vector inside
    const receipt = byName(run.root, 'Use Case: Print receipt')
    assert.equal(receipt.layoutMode, 'HORIZONTAL')
    assert.equal(receipt.children.length, 1)
    assert.equal(receipt.fills.length, 1)
    assert.equal(receipt.strokes.length, 1)
    assertBounds(rel(receipt, run.root), rel(bigVector(run.groups.get('Receipt')), run.before), 'receipt')
    // note: rect-like Auto Layout frame with the note's fill + border, the rough outline pair merged away
    const note = byName(run.root, 'Note: Generalises Clerk')
    assert.equal(kindOf(note), 'Note')
    assert.equal(all(note, (n) => n.type === 'VECTOR').length, 0)
    assert.equal(note.fills.length, 1)
    assert.equal(note.strokes.length, 1)
    assert.equal(note.pluginData['mermapix:node'], 'note-0')
    // relations
    const connectors = byName(run.root, 'Connectors')
    const edges = connectors.children
    assert.deepEqual(edges.map((e) => e.name).sort(), [
      'Edge: Auditor → Refund order', 'Edge: Clerk → Create invoice', 'Edge: Clerk → Staff', 'Edge: Generalises Clerk → Staff',
      'Edge: Guest → Print receipt', 'Edge: Refund order → Create invoice',
    ])
    const e = (n) => edges.find((x) => x.name === n)
    assert.deepEqual(markerNames(e('Edge: Clerk → Staff')), ['inlined-marker-1-extension-end'].length ? markerNames(e('Edge: Clerk → Staff')).map(() => 'Inheritance Arrow') : [])
    assert.deepEqual(markerNames(e('Edge: Refund order → Create invoice')).length, 1)
    assert.ok(markerNames(e('Edge: Clerk → Staff')).every((n) => n === 'Inheritance Arrow'), 'generalization = the class diagram inheritance arrow')
    assert.deepEqual(markerNames(e('Edge: Auditor → Refund order')), ['Circle (end)'])
    assert.deepEqual(markerNames(e('Edge: Clerk → Create invoice')), ['Arrowhead (end)'])
    assert.deepEqual(markerNames(e('Edge: Generalises Clerk → Staff')), [], 'the note connector has no marker')
    assert.deepEqual(e('Edge: Guest → Print receipt').children.filter((k) => k.type === 'FRAME').map((k) => k.name), ['Label: views'])
    assert.ok(e('Edge: Generalises Clerk → Staff').children.find((k) => k.name === 'Line').dashPattern.length > 0)
  })

  test(`${tag} extras: business slash, stereotype, icon actor, two boundaries, undeclared endpoint: every node converted, every relation resolved`, async () => {
    const run = await load('usecase-extras', theme)
    assertStructured(run, tag, { importerDrops: 1 })
    assert.deepEqual(run.root.children.map((c) => c.name), [
      'System Boundary: Front office', 'System Boundary: Back office', 'Actor: Customer', 'Actor: Bot', 'Use Case: Undeclared', 'Note: VIP only', 'Connectors',
    ])
    const front = byName(run.root, 'System Boundary: Front office')
    assert.deepEqual(front.children.slice(1).map((c) => c.name), ['Use Case: Place order', 'Use Case: «Entry» Log in', 'Use Case: Plain rect'])
    assert.deepEqual(byName(run.root, 'System Boundary: Back office').children.slice(1).map((c) => c.name), ['Use Case: Ship'])
    // the business slash stays a vector next to the ellipse
    assert.deepEqual(byName(run.root, 'Use Case: Place order').children.map((c) => c.name), ['Ellipse', 'Detail', 'Place order'])
    assert.deepEqual(byName(run.root, 'Actor: Customer').children.map((c) => c.name), ['Figure', 'Detail', 'Customer'])
    // a stereotype makes two labels: both kept, in one frame
    assert.deepEqual(all(byName(run.root, 'Use Case: «Entry» Log in'), (n) => n.type === 'TEXT').length, 1)
    const edges = byName(run.root, 'Connectors').children.map((e) => e.name).sort()
    assert.deepEqual(edges, [
      'Edge: Bot → Ship', 'Edge: Customer → Place order', 'Edge: Customer → «Entry» Log in', 'Edge: Place order → Ship',
      'Edge: Plain rect → Undeclared', 'Edge: VIP only → Customer',
    ].sort())
    assert.ok(!edges.some((n) => n.startsWith('Edge: Connector')), 'no unresolved relation')
    assert.deepEqual(markerNames(byName(run.root, 'Connectors').children.find((e) => e.name === 'Edge: Bot → Ship')), ['Cross (end)'])
  })
}

test('[usecase] no hit-area rect in the import (a Figma that drops unpainted rects): actors are still found by their label below the figure', async () => {
  for (const theme of THEME_LIST) {
    const svg = readSurveySvg('usecase-variants', theme).replace(/<rect\b[^>]*aria-hidden="true"[^>]*\/>/g, '')
    assert.notEqual(svg, readSurveySvg('usecase-variants', theme))
    const run = await runSvg(svg, theme)
    assertStructured(run, `nohit/${theme}`)
    assert.deepEqual(run.root.children.map((c) => c.name), ['Package: Billing', 'Actor: Clerk', 'Actor: Guest', 'Actor: Auditor', 'Actor: Staff', 'Note: Generalises Clerk', 'Connectors'])
    const clerk = byName(run.root, 'Actor: Clerk')
    // the box is then the union of figure and name
    assert.ok(clerk.width > 30 && clerk.width <= 76 && clerk.height > 60 && clerk.height <= 116, `${clerk.width}x${clerk.height}`)
    assert.ok(all(byName(run.root, 'Connectors'), (n) => n.type === 'GROUP' && n.name.startsWith('Edge: ')).length === 6)
  }
})

test('[usecase] unrecognised structure degrades to the generic fallback instead of throwing', async () => {
  const svg = readSurveySvg('usecase', 'dark').replace(/-usecase-/g, '-uc-')
  const run = await runSvg(svg, 'dark')
  assert.ok(!run.log.some((l) => l[0] === 'notify' && l[1][1] && l[1][1].error))
  assert.equal(run.root.pluginData['mermapix:fallback'], 'usecase')
  assert.equal(all(run.root, (n) => n.type === 'TEXT' && n.characters.trim()).length, (svg.match(/<text\b/g) || []).length)
  // a group the classifier cannot place is left as it was, the others are still converted
  const odd = readSurveySvg('usecase', 'dark').replace(/<ellipse rx="80" ry="28" cx="0" cy="0"/, '<polygon points="0,0 40,0 20,30" ')
  const r2 = await runSvg(odd, 'dark')
  assert.ok(!r2.log.some((l) => l[0] === 'notify' && l[1][1] && l[1][1].error))
  assert.ok(byName(r2.root, 'Actor: Customer'))
})

test('usecaseGeometry: names, classification and actor parts (pure)', () => {
  assert.equal(usecaseNodeId('mermaid-svg-0-usecase-Customer'), 'Customer')
  assert.equal(usecaseNodeId('mermaid-svg-0-usecase-note-0'), 'note-0')
  assert.equal(usecaseNodeId('usecase-mermaid-svg-0-edge-0'), null, 'relations are not nodes')
  assert.equal(usecaseNodeId('mermaid-svg-0-L_a_b_0'), null)
  assert.equal(usecaseNodeId('inlined-marker-1-arrowhead-end'), null)
  const R = (x, y, width, height) => ({ x, y, width, height })
  const part = (rect, o = {}) => ({ rect, painted: true, rectLike: false, ellipse: false, ...o })
  const label = R(40, 20, 50, 14)
  assert.equal(classifyUsecaseGroup({ id: 'U', vectors: [part(R(0, 0, 130, 56), { ellipse: true })], texts: [label] }), 'usecase')
  assert.equal(classifyUsecaseGroup({ id: 'U', vectors: [part(R(0, 0, 130, 56), { rectLike: true })], texts: [label] }), 'usecase')
  // a title on the top edge of a big rect is a boundary, an empty-looking centred one a use case
  assert.equal(classifyUsecaseGroup({ id: 'S', vectors: [part(R(0, 0, 400, 300), { rectLike: true })], texts: [R(170, 0, 60, 14)] }), 'boundary')
  assert.equal(classifyUsecaseGroup({ id: 'S', vectors: [part(R(0, 26, 400, 300), { rectLike: true }), part(R(0, 0, 80, 26), { rectLike: true })], texts: [R(20, 5, 40, 14)] }), 'package')
  assert.equal(classifyUsecaseGroup({ id: 'note-0', vectors: [part(R(0, 0, 140, 36), { rectLike: true }), part(R(0, 0, 140, 36))], texts: [label] }), 'note')
  // actor: a hit area, or a name outside every figure
  assert.equal(classifyUsecaseGroup({ id: 'A', vectors: [part(R(0, 0, 76, 116), { painted: false, rectLike: true }), part(R(20, 10, 34, 64))], texts: [R(10, 90, 50, 17)] }), 'actor')
  assert.equal(classifyUsecaseGroup({ id: 'A', vectors: [part(R(20, 10, 34, 64))], texts: [R(10, 90, 50, 17)] }), 'actor')
  // decoration inside the ellipse (business slash) keeps it a use case; a stray shape outside does not
  assert.equal(classifyUsecaseGroup({ id: 'U', vectors: [part(R(0, 0, 160, 56), { ellipse: true }), part(R(140, 20, 16, 24))], texts: [R(50, 20, 60, 14)] }), 'usecase')
  assert.equal(classifyUsecaseGroup({ id: 'U', vectors: [part(R(0, 0, 160, 56), { ellipse: true }), part(R(300, 20, 16, 24))], texts: [R(50, 20, 60, 14)] }), null)
  assert.equal(classifyUsecaseGroup({ id: 'U', vectors: [], texts: [label] }), null)
  assert.equal(classifyUsecaseGroup({ id: 'U', vectors: [part(R(0, 0, 50, 50))], texts: [] }), null)
  assert.equal(isCentredIn(R(40, 20, 50, 14), R(0, 0, 130, 54)), true)
  // the name is the text outside the figure; Mermaid's unknown-icon placeholder `?` sits inside it
  assert.deepEqual(actorNameTexts([R(10, 10, 52, 52)], [R(30, 30, 8, 12), R(20, 90, 30, 14)]), [1])
  assert.deepEqual(actorNameTexts([R(10, 10, 52, 52)], [R(30, 30, 8, 12)]), [0], 'all of them when none is outside')
  assert.equal(classifyUsecaseGroup({ id: 'A', vectors: [part(R(10, 10, 52, 52))], texts: [R(30, 30, 8, 12), R(20, 90, 30, 14)] }), 'actor')
  assert.deepEqual(actorPartNames([R(0, 0, 34, 64)]), ['Figure'])
  assert.deepEqual(actorPartNames([R(14, 4, 18, 18), R(0, 26, 44, 38)]), ['Head', 'Body'])
  assert.deepEqual(actorPartNames([R(0, 0, 34, 64), R(20, 8, 10, 17)]), ['Figure', 'Detail'])
  // relation ids carry no from / to
  assert.equal(edgeBodyFromName('usecase-mermaid-svg-0-edge-3'), null)
  assert.equal(isAnonymousEdgeName('usecase-mermaid-svg-0-edge-3'), true)
  assert.equal(isAnonymousEdgeName('usecase-mermaid-svg-0-note-0-edge'), true)
  assert.equal(isAnonymousEdgeName('mermaid-svg-0-usecase-Browse'), false)
  assert.equal(isAnonymousEdgeName('mermaid-svg-0-flowchart-edge-1-0'), false)
})

// ---------------------------------------------------------------- source-linked: what canvas edits write back

async function editedTexts(src, svg, theme, edit) {
  const s = createSession()
  const out = await s.send({ type: 'create-svg', svg, name: 'D', theme, themeVariables: THEMES[theme], source: src })
  assert.deepEqual(out.filter((m) => m.type === 'inserted'), [{ type: 'inserted', linked: true }])
  const root = s.page.children[s.page.children.length - 1]
  edit(root)
  const answer = await s.send({ type: 'inspect-diagram', id: root.id })
  assert.equal(answer[0].type, 'diagram-changes')
  return answer[0].changes
}
const textNode = (root, characters) => {
  const t = all(root, (n) => n.type === 'TEXT' && n.characters === characters)[0]
  assert.ok(t, characters)
  return t
}

test('[usecase] text context: actors, use cases and the boundary title carry their Mermaid id; notes, relation labels and stereotyped nodes carry none', async () => {
  const src = source('43-usecase-checkout')
  const changes = await editedTexts(src, readSurveySvg('usecase', 'light'), 'light', (root) => {
    textNode(root, 'Browse products').characters = 'Browse the catalogue'
    textNode(root, 'Customer').characters = 'Shopper'
    textNode(root, 'Online shop').characters = 'Web shop'
    textNode(root, '«include»').characters = '«includes»'
  })
  const ctx = (from) => changes.texts.find((t) => t.from === from).context
  assert.deepEqual(ctx('Browse products'), { kind: 'node', id: 'Browse' })
  assert.deepEqual(ctx('Customer'), { kind: 'node', id: 'Customer' })
  assert.deepEqual(ctx('Online shop'), { kind: 'cluster', id: 'shop' })
  assert.equal(ctx('«include»'), undefined)
  assert.equal(changes.moved, 0, 'text edits alone do not count as moved layers')
  // the existing patcher writes the certain ones (declared with a label) and leaves the rest alone
  const r = applyTextChanges(src, changes.texts)
  assert.equal(r.applied.length + r.unresolved.length, 4)
  assert.match(r.source, /Browse\("Browse the catalogue"\)/)
  assert.match(r.source, /actor Customer\("Shopper"\)/)
  assert.match(r.source, /systemBoundary shop\["Web shop"\]/)
  assert.deepEqual(r.unresolved.map((u) => u.from ?? u.change?.from), ['«include»'])
})

test('[usecase] package title and a note: the package title gets a cluster context, the note none', async () => {
  const src = source('44-usecase-variants')
  const changes = await editedTexts(src, readSurveySvg('usecase-variants', 'dark'), 'dark', (root) => {
    textNode(root, 'Billing').characters = 'Invoicing'
    textNode(root, 'Generalises Clerk').characters = 'Staff generalises Clerk'
    textNode(root, 'Print receipt').characters = 'Print a receipt'
  })
  const ctx = (from) => changes.texts.find((t) => t.from === from).context
  assert.deepEqual(ctx('Billing'), { kind: 'cluster', id: 'billing' })
  assert.equal(ctx('Generalises Clerk'), undefined)
  assert.deepEqual(ctx('Print receipt'), { kind: 'node', id: 'Receipt' })
  const r = applyTextChanges(src, changes.texts)
  assert.match(r.source, /systemBoundary billing\["Invoicing"\]@\{ type: package \}/)
  assert.match(r.source, /Receipt\[Print a receipt\]/)
  assert.match(r.source, /note for Staff "Staff generalises Clerk"|Generalises Clerk/)
})
