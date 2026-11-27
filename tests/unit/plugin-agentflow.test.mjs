// Phase 14.4 end to end: agentflow-beta (Mermaid 12.3.0) nodes by kind, flow containers and the three edge kinds.
// Real built plugin/code.js on the real Mermaid payload SVGs (dark + light; fixtures 45 and 47).
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runSvg, runSurvey, readSurveySvg, THEMES } from '../plugin-mock/run-fixture.mjs'
import { layoutCentered } from '../plugin-mock/layout-sim.mjs'
import { metrics } from '../plugin-mock/survey-metrics.mjs'
import { all, near, rel, kindOf, roleOf, byName, solidKey, rawOf, assertBounds, insideBox, assertStructured } from '../plugin-mock/diagram-asserts.mjs'
import { createSession } from '../plugin-mock/session.mjs'
import { applyTextChanges } from '../../src/plugin/sourcePatch.ts'
import { agentflowNodeId, agentflowKind, agentflowEdgeStyle, markerKindOfLayer } from '../../plugin/src/agentflowGeometry.ts'

const THEME_LIST = ['dark', 'light']
const NODE_RE = /-agentflow-(.+)-(\d+)$/
const source = (n) => fs.readFileSync(new URL(`../figma-fixtures/${n}.mmd`, import.meta.url), 'utf8')

const runs = new Map()
async function load(type, theme) {
  const k = `${type}/${theme}`
  if (!runs.has(k)) {
    const run = await runSurvey(type, theme)
    const before = rawOf(run)
    const groups = new Map()
    for (const g of all(before, (n) => n.type === 'GROUP' && NODE_RE.test(n.name) && !n.name.includes('inlined-marker'))) {
      groups.set(NODE_RE.exec(g.name)[1], { vectors: all(g, (n) => n.type === 'VECTOR'), texts: all(g, (n) => n.type === 'TEXT' && n.characters.trim()) })
    }
    runs.set(k, { ...run, before, groups })
  }
  return runs.get(k)
}
const bigVector = (g) => g.vectors.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
const names = (n) => n.children.map((c) => c.name)
const markerNames = (e) => e.children.filter((k) => k.type === 'GROUP').map((k) => k.name)

for (const theme of THEME_LIST) {
  const tag = `[agentflow/${theme}]`

  test(`${tag} support: flows nest like the source (flow in flow, nodes in their flow), z-order flows < nodes < Connectors`, async () => {
    const run = await load('agentflow', theme)
    assertStructured(run, tag)
    assert.deepEqual(names(run.root), ['Flow: Support team', 'Connectors'])
    const team = byName(run.root, 'Flow: Support team')
    assert.equal(team.pluginData['mermapix:cluster'], 'team')
    assert.equal(kindOf(team), 'Flow')
    assert.equal(roleOf(team), 'flow')
    assert.deepEqual(names(team), ['Support team', 'Flow: Resolver agent', 'Flow: Triage agent', 'Task: Escalate to human'])
    assert.deepEqual(names(byName(team, 'Flow: Triage agent')), ['Triage agent', 'Input: New ticket', 'Task: Classify request', 'Tool: search_orders', 'Decision: Known issue?'])
    assert.deepEqual(names(byName(team, 'Flow: Resolver agent')), ['Resolver agent', 'Task: Draft reply', 'Action: send_email', 'Refdoc: Refund policy'])
    // containment is geometric AND structural
    for (const flow of all(run.root, (n) => n.type === 'FRAME' && roleOf(n) === 'flow')) {
      for (const c of flow.children.filter((k) => k.type === 'FRAME')) assert.ok(insideBox(rel(flow, run.root), rel(c, run.root)), `${c.name} inside ${flow.name}`)
    }
    // the flow container is the rect: stroke + corner radius on the frame, no fill, title inside
    const raw = run.before
    const rect = all(raw, (n) => n.type === 'VECTOR' && Math.abs(n.width - 514.5) < 1 && n.height > 1000)[0]
    assertBounds(rel(team, run.root), rel(rect, raw), 'team flow')
    assert.equal(team.layoutMode, 'NONE')
    assert.equal(team.clipsContent, false)
    assert.equal(team.cornerRadius, 10)
    assert.equal(solidKey(team.strokes), solidKey(rect.strokes))
    assert.equal(team.strokeWeight, rect.strokeWeight)
  })

  test(`${tag} support: each node is a frame named by its kind at the shape's bounds, paint merged, label centred`, async () => {
    const run = await load('agentflow', theme)
    const want = {
      ticket: ['Input: New ticket', 'Parallelogram'], classify: ['Task: Classify request', null], lookup: ['Tool: search_orders', 'Subroutine'],
      known: ['Decision: Known issue?', 'Diamond'], fix: ['Task: Draft reply', null], send: ['Action: send_email', 'Hexagon'],
      policy: ['Refdoc: Refund policy', 'Polygon'], escalate: ['Task: Escalate to human', null],
    }
    assert.equal(run.groups.size, 8)
    for (const [id, [name, vectorName]] of Object.entries(want)) {
      const f = byName(run.root, name)
      assert.ok(f, name)
      assert.equal(f.type, 'FRAME')
      assert.equal(f.pluginData['mermapix:node'], id)
      assert.equal(f.pluginData['mermapix:label'], name.split(': ')[1])
      assert.equal(roleOf(f), name.split(': ')[0].toLowerCase())
      const raw = run.groups.get(id)
      const shape = bigVector(raw)
      assertBounds(rel(f, run.root), rel(shape, run.before), name)
      assert.equal(f.layoutMode, 'HORIZONTAL')
      assert.equal(f.primaryAxisSizingMode, 'FIXED')
      assert.equal(f.counterAxisSizingMode, 'FIXED')
      const text = f.children.filter((c) => c.type === 'TEXT')
      assert.equal(text.length, 1)
      assert.equal(text[0].characters, name.split(': ')[1])
      const vec = f.children.filter((c) => c.type === 'VECTOR')
      if (vectorName === null) {
        // task: rounded rect = the frame itself, fill + border merged on it, no vector left
        assert.equal(vec.length, 0, name)
        assert.equal(f.cornerRadius, 5)
        assert.equal(solidKey(f.fills), solidKey(shape.fills))
        assert.equal(solidKey(f.strokes), solidKey(shape.strokes))
      } else {
        // the other shapes: wrapper frame (no paint) + ONE merged vector keeping the shape
        assert.equal(vec.length, 1, name)
        assert.equal(vec[0].name, vectorName)
        assert.equal(f.fills.length, 0)
        assert.ok(vec[0].fills.length === 1 && vec[0].strokes.length === 1, `${name}: fill + stroke merged on the vector`)
        assert.equal(solidKey(vec[0].fills), solidKey(shape.fills))
        assertBounds(rel(vec[0], run.root), rel(shape, run.before), `${name} vector`)
      }
      // label stays centred on the shape (Auto Layout), at Mermaid's height
      const pos = layoutCentered(f, text[0])
      const fb = rel(f, run.root)
      const rt = rel(raw.texts[0], run.before)
      assert.ok(near(fb.y + pos.y + text[0].height / 2, rt.y + rt.height / 2, 3), `${name} label y`)
    }
  })

  test(`${tag} support: no stacked fill/outline pair is left (the refdoc outline is merged), connectors are the only loose vectors`, async () => {
    const run = await load('agentflow', theme)
    assert.equal(metrics(run.root).stacked, 0)
    assert.equal(metrics(run.before).stacked, 1, 'the importer produced exactly one stacked pair: the refdoc shape')
    const inEdge = new Set()
    for (const e of all(run.root, (c) => c.type === 'GROUP' && c.name.startsWith('Edge: '))) all(e, () => true).forEach((n) => inEdge.add(n))
    const loose = all(run.root, (n, p) => n.type === 'VECTOR' && !inEdge.has(n) && !(p && p.type === 'FRAME' && p.pluginData && p.pluginData['mermapix:node']))
    assert.deepEqual(loose.map((n) => n.name), [])
  })

  test(`${tag} support: 8 edges, one 'Edge: A → B' group each; sequence / reference / failure told apart by line name, suffix and marker`, async () => {
    const run = await load('agentflow', theme)
    const connectors = byName(run.root, 'Connectors')
    assert.equal(run.root.children[run.root.children.length - 1], connectors)
    const edges = connectors.children
    const rawEdges = all(run.before, (n) => n.type === 'VECTOR' && /-L_.+_\d+$/.test(n.name))
    assert.equal(rawEdges.length, 8)
    assert.equal(edges.length, 8)
    const e = (n) => edges.find((x) => x.name === n)
    assert.deepEqual(edges.map((x) => x.name).sort(), [
      'Edge: Classify request → search_orders', 'Edge: Draft reply → Refund policy (reference)', 'Edge: Draft reply → send_email',
      'Edge: Known issue? → Draft reply', 'Edge: Known issue? → Escalate to human', 'Edge: New ticket → Classify request',
      'Edge: search_orders → Known issue?', 'Edge: send_email → Escalate to human (failure)',
    ])
    const lineOf = (x) => x.children.find((k) => k.type === 'VECTOR')
    assert.equal(lineOf(e('Edge: New ticket → Classify request')).name, 'Sequence')
    assert.deepEqual(markerNames(e('Edge: New ticket → Classify request')), ['Arrowhead (end)'])
    assert.equal(lineOf(e('Edge: Draft reply → Refund policy (reference)')).name, 'Reference')
    assert.deepEqual(markerNames(e('Edge: Draft reply → Refund policy (reference)')), [], 'a reference edge has no marker')
    assert.ok(lineOf(e('Edge: Draft reply → Refund policy (reference)')).dashPattern.length > 0, 'and is dotted')
    assert.equal(lineOf(e('Edge: send_email → Escalate to human (failure)')).name, 'Failure')
    assert.deepEqual(markerNames(e('Edge: send_email → Escalate to human (failure)')), ['Cross (end)'])
    for (const x of edges) assert.equal(x.children.filter((k) => k.type === 'VECTOR').length, 1)
    // labels travel with their edge
    assert.deepEqual(e('Edge: Known issue? → Draft reply').children.filter((k) => k.type === 'FRAME').map((k) => k.name), ['Label: yes'])
    assert.deepEqual(e('Edge: Known issue? → Escalate to human').children.filter((k) => k.type === 'FRAME').map((k) => k.name), ['Label: no'])
    // every connector keeps its geometry
    const key = (b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`
    assert.deepEqual(edges.map((x) => key(rel(lineOf(x), run.root))).sort(), rawEdges.map((v) => key(rel(v, run.before))).sort())
  })

  test(`${tag} extras (LR, global node, connector, round shape, default shape, retry loop): every node converted, every edge resolved`, async () => {
    const run = await load('agentflow-extras', theme)
    assertStructured(run, tag)
    assert.deepEqual(names(run.root), ['Refdoc: GitHub', 'Task: Orders API', 'Input: Start', 'Task: Plain node', 'Task: Round', 'Action: Hex', 'Connectors'])
    const edges = byName(run.root, 'Connectors').children.map((x) => x.name).sort()
    assert.deepEqual(edges, [
      'Edge: Hex → Start', 'Edge: Plain node → GitHub (reference)', 'Edge: Plain node → Orders API', 'Edge: Plain node → Round',
      'Edge: Round → Hex (failure)', 'Edge: Start → Plain node',
    ].sort())
    assert.deepEqual(byName(run.root, 'Edge: Hex → Start').children.filter((k) => k.type === 'FRAME').map((k) => k.name), ['Label: retry'])
    assert.equal(metrics(run.root).stacked, 0)
  })
}

test('[agentflow] a payload without edges still converts its nodes and flows (no edge groups, no crash)', async () => {
  const svg = readSurveySvg('agentflow', 'dark')
  const bare = svg.replace(/<path\b[^>]*data-edge="true"[^>]*\/>/g, '').replace(/<g class="inlined-marker[^>]*>[\s\S]*?<\/g>/g, '')
  assert.notEqual(bare, svg)
  const run = await runSvg(bare, 'dark')
  assert.ok(!run.log.some((l) => l[0] === 'notify' && l[1][1] && l[1][1].error))
  assert.ok(byName(run.root, 'Task: Classify request'))
  assert.ok(byName(run.root, 'Flow: Triage agent'))
  assert.equal(all(run.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: ')).length, 0, 'no edge group; the two edge labels stay in Connectors')
})

test('[agentflow] unrecognised structure degrades to the generic fallback instead of throwing', async () => {
  const svg = readSurveySvg('agentflow', 'dark').replace(/-agentflow-/g, '-af-')
  const run = await runSvg(svg, 'dark')
  assert.ok(!run.log.some((l) => l[0] === 'notify' && l[1][1] && l[1][1].error))
  assert.equal(run.root.pluginData['mermapix:fallback'], 'agentflow')
  assert.equal(all(run.root, (n) => n.type === 'TEXT' && n.characters.trim()).length, (svg.match(/<text\b/g) || []).length)
})

test('agentflowGeometry: ids, kinds and edge semantics (pure)', () => {
  assert.equal(agentflowNodeId('mermaid-svg-0-agentflow-classify-2'), 'classify')
  assert.equal(agentflowNodeId('mermaid-svg-0-agentflow-my-node-14'), 'my-node')
  assert.equal(agentflowNodeId('mermaid-svg-0-team'), null, 'a flow container is not a node')
  assert.equal(agentflowNodeId('mermaid-svg-0-L_a_b_0'), null)
  assert.equal(agentflowNodeId('inlined-marker-1-arrowhead-end'), null)
  assert.equal(agentflowKind('Rounded Rectangle', false), 'Task')
  assert.equal(agentflowKind('Subroutine', false), 'Tool')
  assert.equal(agentflowKind('Parallelogram', false), 'Input')
  assert.equal(agentflowKind('Diamond', false), 'Decision')
  assert.equal(agentflowKind('Hexagon', false), 'Action')
  assert.equal(agentflowKind('Polygon', true), 'Refdoc')
  assert.equal(agentflowKind('Polygon', false), null, 'an unknown polygon is not guessed to be a refdoc')
  assert.equal(agentflowKind('Cylinder', false), null)
  assert.equal(markerKindOfLayer('inlined-marker-3-cross-end'), 'cross')
  assert.equal(markerKindOfLayer('inlined-marker-3-arrowhead-end'), 'arrowhead')
  assert.equal(markerKindOfLayer('Arrowhead (end)'), '')
  assert.deepEqual(agentflowEdgeStyle(['arrowhead'], false), { line: 'Sequence' })
  assert.deepEqual(agentflowEdgeStyle(['cross'], false), { line: 'Failure', suffix: ' (failure)' })
  assert.deepEqual(agentflowEdgeStyle([], true), { line: 'Reference', suffix: ' (reference)' })
  assert.equal(agentflowEdgeStyle([], false), null)
  assert.equal(agentflowEdgeStyle(['circle'], false), null)
})

// ---------------------------------------------------------------- source-linked

test('[agentflow] text context: nodes and flows carry their Mermaid id and are written back into the source', async () => {
  const src = source('45-agentflow-support')
  const s = createSession()
  const out = await s.send({ type: 'create-svg', svg: readSurveySvg('agentflow', 'light'), name: 'D', theme: 'light', themeVariables: THEMES.light, source: src })
  assert.deepEqual(out.filter((m) => m.type === 'inserted'), [{ type: 'inserted', linked: true }])
  const root = s.page.children[s.page.children.length - 1]
  const text = (c) => all(root, (n) => n.type === 'TEXT' && n.characters === c)[0]
  text('Classify request').characters = 'Classify the request'
  text('send_email').characters = 'send_mail'
  text('Triage agent').characters = 'Intake agent'
  text('Refund policy').characters = 'Refund rules'
  text('yes').characters = 'known'
  const answer = await s.send({ type: 'inspect-diagram', id: root.id })
  const changes = answer[0].changes
  const ctx = (from) => changes.texts.find((t) => t.from === from).context
  assert.deepEqual(ctx('Classify request'), { kind: 'node', id: 'classify' })
  assert.deepEqual(ctx('send_email'), { kind: 'node', id: 'send' })
  assert.deepEqual(ctx('Refund policy'), { kind: 'node', id: 'policy' })
  assert.deepEqual(ctx('Triage agent'), { kind: 'cluster', id: 'triage' })
  assert.equal(ctx('yes'), undefined, 'an edge label has no id')
  assert.equal(changes.moved, 0)
  const r = applyTextChanges(src, changes.texts)
  assert.match(r.source, /classify\["Classify the request"\]@\{ shape: task \}/)
  assert.match(r.source, /send\["send_mail"\]@\{ shape: action \}/)
  assert.match(r.source, /flow triage\["Intake agent"\]/)
  assert.match(r.source, /policy\["Refund rules"\]@\{ shape: refdoc \}/)
})
