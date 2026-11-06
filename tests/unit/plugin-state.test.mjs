// Phase 8.5 end to end: stateDiagram-v2 states, composite containers, start/end/choice/fork/join and
// notes become frames; transitions are grouped like flowchart edges. Real built plugin/code.js on the
// real Mermaid payload SVGs (dark + light).
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { importSvg } from '../plugin-mock/svg-import.mjs'
import { runFixture } from '../plugin-mock/run-fixture.mjs'
import { isGenericName, relBounds, metrics } from '../plugin-mock/survey-metrics.mjs'
import { vectorPolyline } from '../../plugin/src/connectorGeometry.ts'

const THEMES = ['dark', 'light']
const EXAMPLE = '10-case-state'
const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol
const STATE_RE = /-state-(.+)-(\d+)$/
const rel = relBounds
const textsOf = (tree) => all(tree, (n) => n.type === 'TEXT' && n.characters.trim()).map((t) => t.characters.trim()).sort()
const solidKey = (paints) => JSON.stringify((paints || []).map((p) => [p.type, p.color, p.opacity ?? 1]))
const kindOf = (n) => n.pluginData && n.pluginData['mermapix:kind']

const runs = new Map()
async function load(theme) {
  if (!runs.has(theme)) {
    const r = await runFixture(EXAMPLE, theme)
    const before = importSvg({ ids: 0 }, r.svgSeen)
    const groups = all(before, (n) => n.type === 'GROUP' && STATE_RE.test(n.name) && !n.name.includes('inlined-marker')).map((g) => {
      const vs = all(g, (n) => n.type === 'VECTOR')
      const b = (v) => rel(v, before)
      const big = vs.reduce((a, c) => (c.width * c.height > a.width * a.height ? c : a))
      return { id: STATE_RE.exec(g.name)[1], vectors: vs, box: vs.length ? b(big) : null, texts: all(g, (n) => n.type === 'TEXT' && n.characters.trim()).map((t) => t.characters.trim()) }
    })
    runs.set(theme, { ...r, before, groups })
  }
  return runs.get(theme)
}
const frame = (run, name) => all(run.root, (n) => n.type === 'FRAME' && n.name === name)[0]
const boxOf = (run, id) => run.groups.find((g) => g.id === id).box
const expectBounds = (f, want, label, run) => {
  const b = rel(f, run.root)
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(b[k], want[k]), `${label} ${k} ${b[k]} vs ${want[k]}`)
}

for (const theme of THEMES) {
  const tag = `[state/${theme}]`

  test(`${tag} plain states are rounded Auto Layout FRAMEs at the exact bounds with merged paint`, async () => {
    const run = await load(theme)
    for (const [name, id] of [['State: Idle', 'Idle'], ['State: Done', 'Done'], ['State: P1', 'P1'], ['State: P2', 'P2'], ['State: Running', 'Running'], ['State: Paused', 'Paused'], ['State: A', 'A']]) {
      const f = frame(run, name)
      assert.ok(f, name)
      const g = run.groups.find((x) => x.id === id)
      expectBounds(f, rel(g.vectors[0], run.before), name, run)
      assert.equal(f.layoutMode, 'HORIZONTAL')
      assert.equal(f.primaryAxisSizingMode, 'FIXED')
      assert.equal(f.counterAxisSizingMode, 'FIXED')
      assert.equal(f.cornerRadius, 5)
      assert.equal(solidKey(f.fills), solidKey(g.vectors[0].fills))
      assert.equal(solidKey(f.strokes), solidKey(g.vectors[0].strokes))
      assert.equal(all(f, (n) => n.type === 'VECTOR').length, 0, 'border merged into the frame')
      assert.equal(f.children.length, 1)
      assert.equal(f.children[0].type, 'TEXT')
      assert.equal(f.children[0].fontName.family, 'Inter')
    }
  })

  test(`${tag} composite states are container FRAMEs (title + Body) and nest their states by geometry`, async () => {
    const run = await load(theme)
    for (const [name, id] of [['State: Active', 'Active'], ['State: Inner', 'Inner']]) {
      const f = frame(run, name)
      assert.ok(f, name)
      const g = run.groups.find((x) => x.id === id)
      const outer = g.vectors.reduce((a, c) => (c.height > a.height ? c : a))
      expectBounds(f, rel(outer, run.before), name, run)
      assert.equal(f.layoutMode, 'NONE')
      assert.equal(f.clipsContent, false)
      assert.equal(kindOf(f), 'Composite State')
      assert.equal(f.children[0].type, 'TEXT', 'title first')
      assert.equal(f.children[0].characters.trim(), id)
      const body = f.children.find((k) => k.name === 'Body')
      assert.ok(body, 'Body frame')
      const inner = g.vectors.reduce((a, c) => (c.height < a.height ? c : a))
      expectBounds(body, rel(inner, run.before), name + ' body', run)
      assert.equal(solidKey(body.fills), solidKey(inner.fills))
      assert.equal(solidKey(body.strokes), solidKey(inner.strokes))
      assert.equal(all(body, (n) => n.type === 'VECTOR').length, 0)
    }
    const active = frame(run, 'State: Active')
    const activeBody = active.children.find((k) => k.name === 'Body')
    const names = (f) => f.children.map((k) => k.name)
    assert.deepEqual(names(activeBody).filter((n) => n !== 'Start').sort(), ['State: Inner', 'State: Paused', 'State: Running'])
    const innerBody = frame(run, 'State: Inner').children.find((k) => k.name === 'Body')
    assert.deepEqual(names(innerBody).sort(), ['End', 'Start', 'State: A'])
    // outside states are not swallowed
    assert.ok(run.root.children.some((k) => k.name === 'State: Idle'))
    // nested frames keep their absolute bounds
    expectBounds(frame(run, 'State: Running'), rel(run.groups.find((x) => x.id === 'Running').vectors[0], run.before), 'Running', run)
    expectBounds(frame(run, 'State: A'), rel(run.groups.find((x) => x.id === 'A').vectors[0], run.before), 'A', run)
  })

  test(`${tag} Start / End / Choice / Fork / Join / Note are frames at the exact bounds`, async () => {
    const run = await load(theme)
    const starts = all(run.root, (n) => n.type === 'FRAME' && n.name === 'Start')
    assert.equal(starts.length, 3)
    for (const s of starts) {
      assert.equal(s.cornerRadius, s.width / 2)
      assert.ok(s.fills.length > 0 && s.strokes.length > 0)
      assert.equal(s.children.length, 0)
    }
    for (const id of ['root_start', 'Active_start', 'Inner_start']) {
      const want = run.groups.find((g) => g.id === id).box
      assert.ok(starts.some((s) => { const b = rel(s, run.root); return ['x', 'y', 'width', 'height'].every((k) => near(b[k], want[k])) }), id)
    }
    const ends = all(run.root, (n) => n.type === 'FRAME' && n.name === 'End')
    assert.equal(ends.length, 2)
    for (const e of ends) {
      assert.equal(e.children.length, 1)
      const dot = e.children[0]
      assert.equal(dot.type, 'FRAME')
      assert.equal(dot.name, 'Inner')
      // inner circle is centered in the ring (14x14 ring, 5x5 dot -> 4.5px)
      assert.ok(near((e.width - dot.width) / 2, 4.5, 0.1))
      assert.equal(e.layoutMode, 'HORIZONTAL')
      assert.equal(e.primaryAxisAlignItems, 'CENTER')
      assert.equal(e.counterAxisAlignItems, 'CENTER')
      assert.equal(e.strokeWeight, 2)
      assert.equal(dot.strokeWeight, 2)
      assert.equal(all(e, (n) => n.type === 'VECTOR').length, 0)
    }
    const g = (id) => run.groups.find((x) => x.id === id)
    for (const id of ['root_end', 'Inner_end']) {
      const want = g(id).box
      assert.ok(ends.some((e) => { const b = rel(e, run.root); return ['x', 'y', 'width', 'height'].every((k) => near(b[k], want[k])) }), id)
    }
    const choice = frame(run, 'Choice')
    expectBounds(choice, g('choice_state').box, 'choice', run)
    assert.equal(all(choice, (n) => n.type === 'VECTOR').length, 1, 'diamond = one merged vector inside the wrapper')
    const vec = all(choice, (n) => n.type === 'VECTOR')[0]
    assert.ok(vec.strokes.length > 0 && vec.fills.length > 0)
    for (const [name, id] of [['Fork', 'fork_state'], ['Join', 'join_state']]) {
      const f = frame(run, name)
      assert.ok(f, name)
      expectBounds(f, g(id).box, name, run)
      assert.ok(f.fills.length > 0 && f.strokes.length > 0)
      assert.equal(f.strokeWeight, 1.3)
      assert.equal(f.children.length, 0)
    }
    const note = frame(run, 'Note: Waiting for input')
    expectBounds(note, g('Idle----note').box, 'note', run)
    assert.equal(note.children.length, 1)
    assert.equal(note.strokeWeight, 1.3)
    assert.equal(all(note, (n) => n.type === 'VECTOR').length, 0)
    // Mermaid's invisible note anchor rect is gone
    assert.equal(all(run.root, (n) => n.name.includes('----parent')).length, 0)
  })

  test(`${tag} no stacked fill/outline pairs and no leftover shape vectors outside the Choice wrapper and the connectors`, async () => {
    const run = await load(theme)
    const m = metrics(run.root)
    assert.equal(m.stacked, 0)
    const inEdge = new Set()
    for (const e of all(run.root, (c) => c.type === 'GROUP' && c.name.startsWith('Edge: '))) walk(e, (n) => inEdge.add(n))
    const loose = all(run.root, (n, p) => n.type === 'VECTOR' && !inEdge.has(n) && !(p && p.name === 'Choice'))
    assert.deepEqual(loose.map((n) => n.name), [])
  })

  test(`${tag} transitions: one 'Edge: A → B' group each (ends resolved by geometry), all inside 'Connectors' on top`, async () => {
    const run = await load(theme)
    const connectors = all(run.root, (n) => n.type === 'GROUP' && n.name === 'Connectors')
    assert.equal(connectors.length, 1)
    assert.equal(run.root.children[run.root.children.length - 1], connectors[0])
    const edges = connectors[0].children.filter((n) => n.name.startsWith('Edge: '))
    const rawEdges = all(run.before, (n) => n.type === 'VECTOR' && /-(edge\d+|[^-]*----note-\d+)$/.test(n.name))
    assert.equal(rawEdges.length, 18)
    assert.equal(edges.length, rawEdges.length)
    assert.deepEqual(edges.map((e) => e.name).sort(), [
      'Edge: A → End', 'Edge: Active → Choice', 'Edge: Choice → Done', 'Edge: Choice → Idle', 'Edge: Done → Fork',
      'Edge: Fork → P1', 'Edge: Fork → P2', 'Edge: Idle → Active', 'Edge: Idle → Waiting for input', 'Edge: Join → End',
      'Edge: P1 → Join', 'Edge: P2 → Join', 'Edge: Running → Inner', 'Edge: Running → Paused', 'Edge: Paused → Running',
      'Edge: Start → A', 'Edge: Start → Idle', 'Edge: Start → Running',
    ].sort())
    for (const e of edges) {
      assert.equal(e.children.filter((k) => k.name === 'Line').length, 1)
      // every transition keeps its arrowhead group; the dashed note connector has none
      assert.equal(e.children.some((k) => k.type === 'GROUP'), !e.name.includes('Waiting for input'), e.name)
    }
    // transition labels travel with their edge
    for (const [edge, label] of [['Edge: Idle → Active', 'start'], ['Edge: Choice → Done', 'ok'], ['Edge: Choice → Idle', 'retry'], ['Edge: Running → Paused', 'pause'], ['Edge: Paused → Running', 'resume']]) {
      assert.ok(edges.find((e) => e.name === edge).children.some((k) => k.type === 'FRAME' && k.name === `Label: ${label}`), `${edge} / ${label}`)
    }
    const key = (b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`
    assert.deepEqual(edges.map((e) => key(rel(e.children.find((k) => k.name === 'Line'), run.root))).sort(), rawEdges.map((v) => key(rel(v, run.before))).sort())
  })

  test(`${tag} connectors never reach into a state frame; paint order: composites < states < connectors`, async () => {
    const run = await load(theme)
    const nodes = all(run.root, (n) => n.type === 'FRAME' && n.pluginData && n.pluginData['mermapix:node'] !== undefined && ['State', 'Note'].includes(kindOf(n)))
    assert.ok(nodes.length >= 8)
    for (const g of all(run.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: '))) {
      const line = g.children.find((k) => k.name === 'Line')
      const b = rel(line, run.root)
      const pts = vectorPolyline(line.vectorPaths[0].data, b.x, b.y)
      for (const f of nodes) {
        const r = rel(f, run.root)
        const depth = (p) => Math.min(p.x - r.x, r.x + r.width - p.x, p.y - r.y, r.y + r.height - p.y)
        for (const p of pts) assert.ok(depth(p) <= 1.5, `${g.name} enters ${f.name} by ${depth(p)}`)
      }
    }
    const idx = (n) => run.root.children.indexOf(n)
    const active = run.root.children.find((n) => n.name === 'State: Active')
    const idle = run.root.children.find((n) => n.name === 'State: Idle')
    const connectors = run.root.children.find((n) => n.name === 'Connectors')
    assert.ok(idx(active) < idx(idle) && idx(idle) < idx(connectors))
    const body = active.children.find((k) => k.name === 'Body')
    assert.ok(active.children.indexOf(body) > 0, 'title first, Body panel after it')
    const inner = body.children.find((k) => k.name === 'State: Inner')
    const running = body.children.find((k) => k.name === 'State: Running')
    assert.ok(body.children.indexOf(inner) < body.children.indexOf(running), 'nested composite (cluster) is painted before plain states, like Mermaid')
  })

  test(`${tag} zero-drop texts, no duplicates, no generic layer names`, async () => {
    const run = await load(theme)
    assert.deepEqual(textsOf(run.root), textsOf(run.before))
    const bad = all(run.root, (n, p) => n !== run.root && isGenericName(n.name) && !(n.name === 'Line' && p && p.name.startsWith('Edge: ')))
    assert.deepEqual(bad.map((n) => `${n.type}:${n.name}`), [])
  })
}

test('[state extras/dark] description alias, concurrent regions, multi-line note on the left: no crash, zero-drop, no generic names', async () => {
  const r = await runFixture('36-case-state-extras', 'dark')
  const before = importSvg({ ids: 0 }, r.svgSeen)
  assert.deepEqual(textsOf(r.root), textsOf(before))
  const work = all(r.root, (n) => n.type === 'FRAME' && n.name === 'State: Work')[0]
  assert.ok(work)
  const body = work.children.find((k) => k.name === 'Body')
  const regions = body.children.filter((k) => k.name === 'Region')
  assert.equal(regions.length, 2, 'two concurrent regions are containers inside the composite body')
  for (const reg of regions) {
    assert.equal(kindOf(reg), 'State Region')
    assert.equal(reg.layoutMode, 'NONE')
    assert.ok(reg.children.some((k) => k.name === 'Start'))
  }
  assert.deepEqual(regions[0].children.map((k) => k.name).sort(), ['Start', 'State: Do thing'])
  assert.deepEqual(regions[1].children.map((k) => k.name).sort(), ['End', 'Start', 'State: Task2'])
  assert.ok(all(r.root, (n) => n.type === 'FRAME' && n.name === 'State: A long description')[0], 'state "A long description" as s1')
  const note = all(r.root, (n) => n.type === 'FRAME' && n.name === 'Note: multi line note')[0]
  assert.ok(note)
  assert.equal(note.children[0].characters, 'multi\nline note')
  const edges = all(r.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: ')).map((e) => e.name).sort()
  assert.equal(edges.length, 7)
  assert.ok(edges.includes('Edge: Start → A long description'))
  assert.ok(edges.includes('Edge: Work → End'))
  assert.equal(all(r.root, (n) => n.type === 'VECTOR' && /note/.test(n.name)).length, 0, 'the note connector (named ...----note-6-s1) is a regular edge')
  const bad = all(r.root, (n, p) => n !== r.root && isGenericName(n.name) && !(n.name === 'Line' && p && p.name.startsWith('Edge: ')))
  assert.deepEqual(bad.map((n) => `${n.type}:${n.name}`), [])
})

// User case 2026-11-06: order lifecycle (LR, composite with its own start/end, labelled
// transitions, a two-line note on the right).
for (const theme of THEMES) {
  test(`[state order lifecycle/${theme}] composite, notes and labelled transitions: zero-drop, every part a frame, named edges`, async () => {
    const r = await runFixture('42-case-state-order', theme)
    const before = importSvg({ ids: 0 }, r.svgSeen)
    assert.deepEqual(textsOf(r.root), textsOf(before))
    const frameNames = all(r.root, (n) => n.type === 'FRAME').map((n) => n.name)
    for (const s of ['Placed', 'Paid', 'Cancelled', 'Delivered', 'Packing', 'Shipped', 'Fulfilment']) {
      assert.ok(frameNames.includes(`State: ${s}`), `State: ${s} is a frame`)
    }
    const fulfilment = all(r.root, (n) => n.type === 'FRAME' && n.name === 'State: Fulfilment')[0]
    const body = fulfilment.children.find((k) => k.name === 'Body')
    assert.deepEqual(body.children.map((k) => k.name).sort(), ['End', 'Start', 'State: Packing', 'State: Shipped'])
    const note = all(r.root, (n) => n.type === 'FRAME' && n.name.startsWith('Note: Payment can be card'))[0]
    assert.ok(note, 'the note is a frame')
    assert.equal(note.children[0].characters, 'Payment can be card,\nwallet, or bank transfer')
    const edges = all(r.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: ')).map((e) => e.name)
    assert.equal(edges.length, 11, "10 transitions + the note link")
    for (const e of ['Edge: Placed → Paid', 'Edge: Placed → Cancelled', 'Edge: Paid → Fulfilment', 'Edge: Fulfilment → Delivered', 'Edge: Packing → Shipped']) {
      assert.ok(edges.includes(e), e)
    }
    const labels = all(r.root, (n) => n.type === 'FRAME' && n.name.startsWith('Label: ')).map((n) => n.name).sort()
    assert.deepEqual(labels, ['Label: courier confirms', 'Label: customer cancels', 'Label: handed to courier', 'Label: payment received'])
    const bad = all(r.root, (n, p) => n !== r.root && isGenericName(n.name) && !(n.name === 'Line' && p && p.name.startsWith('Edge: ')))
    assert.deepEqual(bad.map((n) => `${n.type}:${n.name}`), [])
  })
}
