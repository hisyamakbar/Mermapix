// Phase 8.3 end to end: subgraphs become frames, node frames are nested into the smallest cluster,
// edges are grouped/named inside one `Connectors` group. Real built plugin/code.js on the real
// Mermaid payload SVGs (flowchart, sitemap, nested-subgraph fixture; dark + light).
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import { walk, MockNode } from '../plugin-mock/figma-mock.mjs'
import { flattenWrappers } from '../../plugin/src/cleanup.ts'
import { importSvg } from '../plugin-mock/svg-import.mjs'
import { runFixture, FLOW_EXAMPLES } from '../plugin-mock/run-fixture.mjs'
import { vectorPolyline, polylineHitsRect, rectsOverlap, distanceToPolyline, resolveEdgeEndpoints, smallestContainer, assignLabelsToEdges, edgeBodyFromName, clusterIdFromName, edgeDisplayName } from '../../plugin/src/connectorGeometry.ts'
import { parsePathData, flattenPath } from '../../plugin/src/shapeGeometry.ts'

const THEMES = ['dark', 'light']
const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol
const solidKey = (paints) => JSON.stringify((paints || []).map((p) => [p.type, p.color, p.opacity ?? 1]))
const NODE_RE = /-flowchart-(.+)-(\d+)$/
const EDGE_RE = /-L_(.+)_(\d+)$/
const CLUSTER_RE = /^mermaid-svg-\d+-(?!flowchart-|L_)(.+)$/

/** Bounds relative to the root frame (GROUPs transparent, FRAME positions accumulate). */
function rel(n, root) {
  let x = n.x, y = n.y, p = n.parent
  while (p && p !== root) { if (p.type === 'FRAME') { x += p.x; y += p.y } p = p.parent }
  return { x, y, width: n.width, height: n.height }
}
const union = (bs) => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
  return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y }
}
const descendants = (n, type) => all(n, (c) => c.type === type && c !== n)
const isNode = (n) => n.type === 'FRAME' && n.pluginData && n.pluginData['mermapix:node'] !== undefined
const isCluster = (n) => n.type === 'FRAME' && n.pluginData && n.pluginData['mermapix:cluster'] !== undefined

const runs = new Map()
async function load(example, theme) {
  const key = `${example}/${theme}`
  if (!runs.has(key)) {
    const r = await runFixture(example, theme)
    const before = importSvg({ ids: 0 }, r.svgSeen)
    // ground truth from the tree the plugin received
    const clusters = all(before, (n) => n.type === 'GROUP' && CLUSTER_RE.test(n.name) && !n.name.includes('inlined-marker') && descendants(n, 'VECTOR').length === 1)
      .map((g) => {
        const v = descendants(g, 'VECTOR')[0]
        const texts = descendants(g, 'TEXT').filter((t) => t.characters.trim())
        return { id: CLUSTER_RE.exec(g.name)[1], vec: v, bounds: rel(v, before), title: texts.map((t) => t.characters.trim()).join(' '), texts: texts.map((t) => ({ s: t.characters.trim(), c: (() => { const b = rel(t, before); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })() })) }
      })
    const nodes = all(before, (n) => n.type === 'GROUP' && NODE_RE.test(n.name)).map((g) => {
      const vs = descendants(g, 'VECTOR').filter((v) => v.width > 0 || v.height > 0)
      return { id: NODE_RE.exec(g.name)[1], bounds: union(vs.map((v) => rel(v, before))), label: descendants(g, 'TEXT').map((t) => t.characters.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ') }
    })
    const edgeVecs = all(before, (n) => n.type === 'VECTOR' && EDGE_RE.test(n.name))
    const edges = edgeVecs.map((v) => {
      const kids = v.parent.children
      const markers = []
      for (let i = kids.indexOf(v) + 1; i < kids.length && kids[i].name.includes('inlined-marker'); i++) markers.push(kids[i])
      return { vec: v, body: EDGE_RE.exec(v.name)[1], markers, bounds: rel(v, before) }
    })
    runs.set(key, { ...r, before, clusters, nodes, edges })
  }
  return runs.get(key)
}

const smallest = (rect, clusters, self) => {
  const area = (b) => b.width * b.height
  let best = null
  for (const c of clusters) {
    if (c.id === self) continue
    const b = c.bounds
    if (area(b) <= area(rect) + 1) continue
    if (rect.x >= b.x - 1 && rect.y >= b.y - 1 && rect.x + rect.width <= b.x + b.width + 1 && rect.y + rect.height <= b.y + b.height + 1) {
      if (!best || area(b) < area(best.bounds)) best = c
    }
  }
  return best
}

function endpoints(body, run) {
  const ids = new Set([...run.nodes.map((n) => n.id), ...run.clusters.map((c) => c.id)])
  const parts = body.split('_')
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join('_'), b = parts.slice(i).join('_')
    if (ids.has(a) && ids.has(b)) return [a, b]
  }
  throw new Error('cannot split ' + body)
}
const labelOfId = (id, run) => (run.nodes.find((n) => n.id === id) || run.clusters.find((c) => c.id === id)).label ?? run.clusters.find((c) => c.id === id).title

const EXPECTED_LABEL_EDGE = {
  '2-ex-flowchart': { no: 'parse_fix', yes: 'parse_preview' },
  '4-ex-sitemap': { 'featured on homepage': 'n40_n10' },
  '7-case-nested-subgraphs': { valid: 'gateway_api', denied: 'gateway_reject', dequeue: 'queue_worker' },
}

for (const theme of THEMES) {
  for (const example of FLOW_EXAMPLES) {
    const tag = `[${example}/${theme}]`

    test(`${tag} every cluster becomes a FRAME with merged paint at the exact bounds (no Auto Layout, no clipping)`, async () => {
      const run = await load(example, theme)
      assert.ok(run.clusters.length >= 1)
      const frames = all(run.root, isCluster)
      assert.equal(frames.length, run.clusters.length)
      assert.equal(all(run.root, (n) => n.type === 'GROUP' && CLUSTER_RE.test(n.name)).length, 0, 'no raw cluster groups left')
      for (const c of run.clusters) {
        const f = frames.find((x) => x.pluginData['mermapix:cluster'] === c.id)
        assert.ok(f, c.id)
        assert.equal(f.name, `Subgraph: ${c.title}`)
        const b = rel(f, run.root)
        for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(b[k], c.bounds[k]), `${c.id} ${k} ${b[k]} vs ${c.bounds[k]}`)
        assert.equal(f.layoutMode, 'NONE', 'children keep absolute positions')
        assert.equal(f.clipsContent, false)
        assert.equal(solidKey(f.fills), solidKey(c.vec.fills), `${c.id} fill`)
        assert.equal(solidKey(f.strokes), solidKey(c.vec.strokes), `${c.id} stroke`)
        assert.equal(f.strokeWeight, c.vec.strokeWeight)
        assert.equal(f.cornerRadius ?? 0, 0)
        assert.equal(f.children.filter((k) => k.type === 'VECTOR').length, 0, 'border merged into the frame, no vector left')
        // title: inside the frame, Inter, same center as Mermaid placed it
        const texts = f.children.filter((k) => k.type === 'TEXT')
        assert.deepEqual(texts.map((t) => t.characters.trim()), c.texts.map((t) => t.s))
        texts.forEach((t, i) => {
          assert.equal(t.fontName.family, 'Inter')
          assert.equal(f.children[0], texts[0], 'title is the bottom-most child')
          const tb = rel(t, run.root)
          assert.ok(near(tb.x + tb.width / 2, c.texts[i].c.x, 0.6), `${c.id} title center x`)
          assert.ok(near(tb.y + tb.height / 2, c.texts[i].c.y, 0.6), `${c.id} title center y`)
        })
      }
    })

    test(`${tag} nodes and subgraphs land in the smallest containing subgraph, absolute bounds unchanged`, async () => {
      const run = await load(example, theme)
      const nodeFrames = all(run.root, isNode)
      assert.equal(nodeFrames.length, run.nodes.length)
      const clusterFrame = (id) => all(run.root, isCluster).find((f) => f.pluginData['mermapix:cluster'] === id)
      for (const n of run.nodes) {
        const f = nodeFrames.find((x) => x.pluginData['mermapix:node'] === n.id)
        const b = rel(f, run.root)
        for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(b[k], n.bounds[k]), `${n.id} ${k}`)
        const want = smallest(n.bounds, run.clusters)
        if (want) assert.equal(f.parent, clusterFrame(want.id), `${n.id} belongs to ${want.id}`)
        else assert.equal(f.parent, run.root, `${n.id} is a loose top-level node`)
      }
      for (const c of run.clusters) {
        const f = clusterFrame(c.id)
        const want = smallest(c.bounds, run.clusters, c.id)
        if (want) assert.equal(f.parent, clusterFrame(want.id), `${c.id} nested in ${want.id}`)
        else assert.equal(f.parent, run.root, `${c.id} is top level`)
      }
    })

    test(`${tag} every edge is one "Edge: A → B" group with its line, markers and path data intact`, async () => {
      const run = await load(example, theme)
      assert.ok(run.edges.length >= 5)
      const edgeGroups = all(run.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: '))
      assert.equal(edgeGroups.length, run.edges.length)
      const used = new Set()
      for (const e of run.edges) {
        const [a, b] = endpoints(e.body, run)
        const name = `Edge: ${labelOfId(a, run)} → ${labelOfId(b, run)}`
        const g = edgeGroups.find((x) => x.name === name && !used.has(x))
        assert.ok(g, name)
        used.add(g)
        const lines = g.children.filter((c) => c.type === 'VECTOR')
        assert.equal(lines.length, 1)
        assert.equal(lines[0].name, 'Line')
        assert.equal(lines[0].vectorPaths[0].data, e.vec.vectorPaths[0].data)
        const lb = rel(lines[0], run.root)
        for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(lb[k], e.bounds[k], 0.01), `${name} ${k}`)
        const markers = g.children.filter((c) => c.type === 'GROUP')
        assert.equal(markers.length, e.markers.length, `${name} marker count`)
        markers.forEach((m, i) => {
          assert.match(m.name, /^(Arrowhead|Cross|Circle) \((start|end)\)$/)
          const mb = rel(m, run.root), ob = rel(e.markers[i], run.before)
          for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(mb[k], ob[k], 0.01), `${name} marker ${k}`)
        })
      }
    })

    test(`${tag} Connectors is the single top group holding every edge; top level is Subgraph / node frames / Connectors`, async () => {
      const run = await load(example, theme)
      const root = run.root
      const connectors = root.children.filter((c) => c.name === 'Connectors')
      assert.equal(connectors.length, 1)
      assert.equal(connectors[0].type, 'GROUP')
      assert.equal(root.children[root.children.length - 1], connectors[0], 'Connectors is the top-most layer')
      assert.equal(all(root, (n) => n.name === 'Connectors').length, 1)
      const edgeGroups = all(root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: '))
      assert.ok(edgeGroups.every((g) => g.parent === connectors[0]))
      // everything else in Connectors is a loose label, nothing else
      for (const c of connectors[0].children) assert.ok(c.name.startsWith('Edge: ') || c.name.startsWith('Label: '), c.name)
      // top level: only subgraph frames, node frames and Connectors; subgraphs below nodes below Connectors
      const kinds = root.children.map((c) => (isCluster(c) ? 'cluster' : isNode(c) ? 'node' : c.name === 'Connectors' ? 'connectors' : 'other:' + c.name))
      assert.deepEqual(kinds.filter((k) => k.startsWith('other:')), [])
      const rank = { cluster: 0, node: 1, connectors: 2 }
      assert.deepEqual(kinds.map((k) => rank[k]), kinds.map((k) => rank[k]).sort())
      // inside a subgraph: title first, nested subgraphs, then nodes
      for (const f of all(root, isCluster)) {
        const k = f.children.map((c) => (c.type === 'TEXT' ? 'title' : isCluster(c) ? 'cluster' : isNode(c) ? 'node' : 'other'))
        assert.ok(!k.includes('other'), `${f.name}: ${k}`)
        const r = { title: 0, cluster: 1, node: 2 }
        assert.deepEqual(k.map((x) => r[x]), k.map((x) => r[x]).sort(), f.name)
      }
    })

    test(`${tag} edge labels sit in the right edge group (or loose, above every edge) and never under a later edge`, async () => {
      const run = await load(example, theme)
      const labels = all(run.root, (n) => n.type === 'FRAME' && n.name.startsWith('Label: '))
      const want = EXPECTED_LABEL_EDGE[example]
      assert.deepEqual(labels.map((l) => l.name.slice(7)).sort(), Object.keys(want).sort())
      const connectors = run.root.children.find((c) => c.name === 'Connectors')
      for (const l of labels) {
        const [a, b] = endpoints(want[l.name.slice(7)], run)
        const expectName = `Edge: ${labelOfId(a, run)} → ${labelOfId(b, run)}`
        assert.equal(l.parent.name, expectName, 'label joins its own edge (unambiguous in these fixtures)')
        assert.equal(l.parent.parent, connectors)
      }
      // z-order rule: an embedded label is only allowed when no LATER edge crosses it
      const groups = connectors.children
      groups.forEach((g, gi) => {
        for (const l of (g.children || []).filter((c) => c.type === 'FRAME')) {
          const lb = rel(l, run.root)
          for (const later of groups.slice(gi + 1)) {
            const line = (later.children || []).find((c) => c.type === 'VECTOR')
            if (!line) continue
            const lnb = rel(line, run.root)
            assert.ok(!polylineHitsRect(vectorPolyline(line.vectorPaths[0].data, lnb.x, lnb.y), lb, 1), `${l.name} is crossed by later ${later.name}`)
            for (const m of later.children.filter((c) => c.type === 'GROUP')) assert.ok(!rectsOverlap(rel(m, run.root), lb), `${l.name} under marker of ${later.name}`)
          }
        }
      })
    })

    test(`${tag} Connectors above nodes is visually identical: edges/arrowheads never go deeper into a node than its own border`, async () => {
      const run = await load(example, theme)
      const sd = (p, b, r) => {
        const qx = Math.abs(p.x - (b.x + b.width / 2)) - (b.width / 2 - r), qy = Math.abs(p.y - (b.y + b.height / 2)) - (b.height / 2 - r)
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
      }
      const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c } return c }
      const lines = all(run.root, (n) => n.type === 'VECTOR' && n.name === 'Line')
      const geoms = lines.map((l) => {
        const pts = []
        const lb = rel(l, run.root)
        pts.push(...vectorPolyline(l.vectorPaths[0].data, lb.x, lb.y))
        for (const m of l.parent.children.filter((c) => c.type === 'GROUP')) for (const v of descendants(m, 'VECTOR')) { const vb = rel(v, run.root); pts.push(...vectorPolyline(v.vectorPaths[0].data, vb.x, vb.y)) }
        return pts
      })
      let worst = 0
      for (const f of all(run.root, isNode)) {
        const b = rel(f, run.root)
        const vec = f.children.find((c) => c.type === 'VECTOR')
        const weight = Number(vec ? vec.strokeWeight : f.strokeWeight) || 1
        let depth
        if (!vec) depth = (p) => Math.max(0, -sd(p, b, f.cornerRadius || 0))
        else {
          const area = (s) => { const xs = s.map((q) => q.x), ys = s.map((q) => q.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) }
          const subs = flattenPath(parsePathData(vec.vectorPaths[0].data)).subpaths.map((s) => s.map((q) => ({ x: q.x + b.x + vec.x, y: q.y + b.y + vec.y })))
          const outer = subs.sort((x, y) => area(y) - area(x))[0]
          depth = (p) => (inPoly(p, outer) ? distanceToPolyline(p, [...outer, outer[0]]) : 0)
        }
        for (const pts of geoms) for (const p of pts) {
          const d = depth(p)
          worst = Math.max(worst, d - weight / 2)
          assert.ok(d <= weight / 2 + 0.5, `${f.name}: connector reaches ${d.toFixed(2)}px into the node (border ${weight}px)`)
        }
      }
      assert.ok(worst <= 0.5)
    })

    test(`${tag} no generic or raw layer names remain, no text dropped or duplicated`, async () => {
      const run = await load(example, theme)
      const generic = all(run.root, (n) => n !== run.root && (['Vector', 'Group', 'Shape', 'Frame', 'Text', 'Rectangle', ''].includes(n.name) || /mermaid|svg-\d|inlined-marker|(^|-)L_/.test(n.name)))
      assert.deepEqual(generic.map((n) => `${n.type} ${n.name}`), [])
      const texts = (tree) => all(tree, (n) => n.type === 'TEXT' && n.characters.trim()).map((t) => t.characters.trim()).sort()
      assert.deepEqual(texts(run.root), texts(run.before))
      assert.equal(all(run.root, (n) => n.type === 'VECTOR' && n.width > 0 && n.height > 0).length > 0, true)
    })
  }

  test(`[7-case-nested-subgraphs/${theme}] two nesting levels, edges entering subgraphs, subgraph-to-subgraph edge`, async () => {
    const run = await load('7-case-nested-subgraphs', theme)
    const f = (id) => all(run.root, isCluster).find((x) => x.pluginData['mermapix:cluster'] === id)
    assert.equal(f('SERVICES').parent, f('BACKEND'))
    assert.equal(f('WORKERS').parent, f('BACKEND'))
    assert.equal(f('BACKEND').parent, run.root)
    assert.equal(f('MONITORING').parent, run.root)
    const node = (id) => all(run.root, isNode).find((x) => x.pluginData['mermapix:node'] === id)
    assert.equal(node('svc').parent, f('SERVICES'))
    assert.equal(node('worker').parent, f('WORKERS'))
    assert.equal(node('api').parent, f('BACKEND'), 'direct member sits in the outer subgraph only')
    assert.equal(node('gateway').parent, run.root)
    assert.equal(node('dash').parent, f('MONITORING'))
    const names = all(run.root, (n) => n.type === 'GROUP' && n.name.startsWith('Edge: ')).map((n) => n.name)
    assert.ok(names.includes('Edge: Services → Monitoring'), 'subgraph-to-subgraph edge named after the subgraph titles')
    assert.ok(names.includes('Edge: Auth check? → API server'))
    // absolute position of a doubly nested node: Backend + Services + own offset
    const svc = node('svc')
    const b = rel(svc, run.root)
    const orig = run.nodes.find((n) => n.id === 'svc').bounds
    assert.ok(near(b.x, orig.x) && near(b.y, orig.y))
  })

  test(`[4-ex-sitemap/${theme}] the huge mostly-empty "1.0 Home" subgraph holds exactly its one node; others pass through it`, async () => {
    const run = await load('4-ex-sitemap', theme)
    const home = all(run.root, isCluster).find((x) => x.pluginData['mermapix:cluster'] === 'S1')
    assert.deepEqual(home.children.filter(isNode).map((n) => n.pluginData['mermapix:node']), ['n10'])
    assert.equal(home.children.filter(isCluster).length, 0)
    // legend + system subgraphs hold their nodes
    const leg = all(run.root, isCluster).find((x) => x.pluginData['mermapix:cluster'] === 'LEG')
    assert.equal(leg.children.filter(isNode).length, 12)
  })
}

// ---------------------------------------------------------------- pure helpers

test('resolveEdgeEndpoints splits ids that contain underscores using the known node ids', () => {
  assert.deepEqual(resolveEdgeEndpoints('n20_n21', ['n20', 'n21']), { from: 'n20', to: 'n21', known: true })
  assert.deepEqual(resolveEdgeEndpoints('my_node_other_node', ['my_node', 'other_node']), { from: 'my_node', to: 'other_node', known: true })
  assert.deepEqual(resolveEdgeEndpoints('a_b_c', ['a', 'b_c']), { from: 'a', to: 'b_c', known: true })
  assert.deepEqual(resolveEdgeEndpoints('x_y', []), { from: 'x', to: 'y', known: false })
  assert.equal(resolveEdgeEndpoints('nounderscore', []), null)
})

test('smallestContainer picks the tightest strictly-larger rect and never itself or a same-size twin', () => {
  const outer = { x: 0, y: 0, width: 100, height: 100 }
  const inner = { x: 10, y: 10, width: 50, height: 50 }
  const item = { x: 20, y: 20, width: 10, height: 10 }
  assert.equal(smallestContainer(item, [outer, inner]), inner)
  assert.equal(smallestContainer(inner, [outer, inner]), outer)
  assert.equal(smallestContainer(outer, [outer, inner]), null)
  assert.equal(smallestContainer(item, [{ ...item }]), null, 'same size is not a container')
  assert.equal(smallestContainer({ x: 95, y: 95, width: 20, height: 20 }, [outer]), null, 'sticking out is not contained')
  assert.equal(smallestContainer({ x: -0.4, y: 0, width: 10, height: 10 }, [outer]), outer, '1px tolerance for stroke noise')
})

test('layer-name parsing: edges, clusters and display names', () => {
  assert.equal(edgeBodyFromName('mermaid-svg-0-L_n20_n21_0'), 'n20_n21')
  assert.equal(edgeBodyFromName('mermaid-plugin-svg-12-L_a_b_3'), 'a_b')
  assert.equal(edgeBodyFromName('mermaid-svg-0-id_entity-A-0_entity-B-1_0'), null)
  assert.equal(edgeBodyFromName('inlined-marker-1-arrowhead-end'), null)
  assert.equal(clusterIdFromName('mermaid-svg-0-S1'), 'S1')
  assert.equal(clusterIdFromName('mermaid-plugin-svg-4-My_Group'), 'My_Group')
  assert.equal(clusterIdFromName('mermaid-svg-0-flowchart-a-1'), null)
  assert.equal(clusterIdFromName('mermaid-svg-0-L_a_b_0'), null)
  assert.equal(clusterIdFromName('Group'), null)
  assert.equal(edgeDisplayName('A', 'B'), 'Edge: A → B')
  assert.ok(edgeDisplayName('x'.repeat(80), 'B').length < 60)
})

test('label association: nearest edge wins, far or ambiguous labels stay unassigned', () => {
  const line = (x0, y0, x1, y1) => Array.from({ length: 21 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 20, y: y0 + ((y1 - y0) * i) / 20 }))
  const edges = [{ pts: line(0, 0, 100, 0) }, { pts: line(0, 200, 100, 200) }, { pts: line(0, 210, 100, 210) }]
  assert.deepEqual(assignLabelsToEdges(edges, [{ x: 50, y: 3 }]), [0])
  assert.deepEqual(assignLabelsToEdges(edges, [{ x: 50, y: 100 }]), [-1], 'too far from every edge')
  assert.deepEqual(assignLabelsToEdges(edges, [{ x: 50, y: 205 }]), [-1], 'between two close edges = ambiguous')
  assert.deepEqual(assignLabelsToEdges([], [{ x: 0, y: 0 }]), [-1])
})

test('flattenWrappers keeps single-line "Edge:" groups and the Connectors group, still dissolves generic wrappers', () => {
  const env = { ids: 0 }
  const root = new MockNode(env, 'FRAME', { name: 'root' })
  const connectors = new MockNode(env, 'GROUP', { name: 'Connectors' })
  const edge = new MockNode(env, 'GROUP', { name: 'Edge: A → B' })
  edge.appendChild(new MockNode(env, 'VECTOR', { name: 'Line', width: 10, height: 10 }))
  connectors.appendChild(edge)
  const wrapper = new MockNode(env, 'GROUP', { name: 'Group' })
  wrapper.appendChild(new MockNode(env, 'VECTOR', { name: 'Line', width: 5, height: 5 }))
  wrapper.appendChild(new MockNode(env, 'VECTOR', { name: 'Line', width: 6, height: 6 }))
  root.appendChild(wrapper)
  root.appendChild(connectors)
  flattenWrappers(root)
  assert.deepEqual(root.children.map((c) => c.name), ['Line', 'Line', 'Connectors'])
  assert.deepEqual(connectors.children.map((c) => c.name), ['Edge: A → B'])
  assert.equal(edge.children.length, 1)
})
