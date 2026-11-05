import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isErdEntityName,
  markerKindFromId,
  buildMarkerLayerId,
  markerLayerName,
  isConnectorLayerName,
  isShapeLayerName,
} from '../../plugin/src/naming.ts'

test('isErdEntityName accepts real entity group names, including edge-like words', () => {
  assert.equal(isErdEntityName('mermaid-plugin-svg-2-entity-ARTICLE-1'), true)
  assert.equal(isErdEntityName('mermaid-plugin-svg-2-entity-KNOWLEDGE_BASE-0'), true)
  assert.equal(isErdEntityName('mermaid-svg-0-entity-EDGE_LABEL_MARKER-12'), true)
  assert.equal(isErdEntityName('mermaid-svg-0-entity-ORDER-LINE-3'), true)
})

test('isErdEntityName rejects relationship edges and self-relationship pieces', () => {
  assert.equal(isErdEntityName('mermaid-plugin-svg-2-id_entity-KNOWLEDGE_BASE-0_entity-ARTICLE-1_0'), false)
  assert.equal(isErdEntityName('mermaid-svg-0-entity-CATEGORY-4-cyclic-special-1'), false)
  assert.equal(isErdEntityName('mermaid-svg-0-entity-CATEGORY-4-cyclic-special-mid'), false)
  assert.equal(isErdEntityName('mermaid-svg-0-entity-CATEGORY-4-cyclic-special-2'), false)
})

test('isErdEntityName rejects unrelated names', () => {
  for (const n of ['', null, undefined, 'Group', 'root-0', 'entity-X', 'mermaid-svg-0-entity-X', 'edgePaths']) {
    assert.equal(isErdEntityName(n), false, String(n))
  }
})

test('markerKindFromId maps real Mermaid marker ids', () => {
  const cases = {
    'mermaid-svg-0_er-oneOrMoreEnd': 'crowsfoot-one-or-more',
    'mermaid-svg-0_er-oneOrMoreStart': 'crowsfoot-one-or-more',
    'mermaid-svg-0_er-onlyOneEnd': 'crowsfoot-only-one',
    'mermaid-svg-0_er-zeroOrMoreStart': 'crowsfoot-zero-or-more',
    'mermaid-svg-0_er-zeroOrOneEnd': 'crowsfoot-zero-or-one',
    'mermaid-svg-0_flowchart-v2-pointEnd': 'arrowhead',
    'mermaid-svg-0_flowchart-v2-pointStart': 'arrowhead',
    'mermaid-svg-0_flowchart-v2-crossEnd': 'cross',
    'mermaid-svg-0_flowchart-v2-circleEnd': 'circle',
    'mermaid-svg-0-arrowhead': 'arrowhead',
    'mermaid-svg-0-filled-head': 'arrowhead',
    'mermaid-svg-0-crosshead': 'cross',
    'mermaid-svg-0-solidTopArrowHead': 'arrowhead',
    'mermaid-svg-0-sequencenumber': 'sequence-number',
    'mermaid-svg-0_class-extensionStart': 'inheritance',
    'mermaid-svg-0_class-compositionEnd': 'composition',
    'mermaid-svg-0_class-aggregationStart': 'aggregation',
    'mermaid-svg-0_class-dependencyEnd': 'dependency',
    'something-else': 'marker',
  }
  for (const [id, kind] of Object.entries(cases)) assert.equal(markerKindFromId(id), kind, id)
  assert.equal(markerKindFromId(null), 'marker')
})

test('markerLayerName: flowchart pointEnd is an Arrowhead, never a Crow\'s Foot', () => {
  const id = buildMarkerLayerId(3, markerKindFromId('mermaid-svg-0_flowchart-v2-pointEnd'), 'end')
  assert.equal(markerLayerName(id), 'Arrowhead (end)')
})

test('markerLayerName covers every kind', () => {
  const name = (kind, pos = 'end') => markerLayerName(buildMarkerLayerId(1, kind, pos))
  assert.equal(name('crowsfoot-one-or-more'), "Crow's Foot: one-or-more (end)")
  assert.equal(name('crowsfoot-only-one', 'start'), "Crow's Foot: only-one (start)")
  assert.equal(name('crowsfoot-zero-or-one'), "Crow's Foot: zero-or-one (end)")
  assert.equal(name('crowsfoot-zero-or-more'), "Crow's Foot: zero-or-more (end)")
  assert.equal(name('cross'), 'Cross (end)')
  assert.equal(name('circle', 'start'), 'Circle (start)')
  assert.equal(name('sequence-number', 'start'), 'Sequence Number Badge')
  assert.equal(name('inheritance'), 'Inheritance Arrow')
  assert.equal(name('composition'), 'Composition Diamond')
  assert.equal(name('aggregation'), 'Aggregation Diamond')
  assert.equal(name('dependency'), 'Dependency Arrow')
  assert.equal(name('marker'), 'Marker')
  assert.equal(markerLayerName('inlined-marker inlined-marker-end inlined-marker'), 'Marker')
})

test('connector / shape layer name patterns are precise', () => {
  for (const n of ['edgepaths', 'edgelabel', 'mermaid-svg-0-id_entity-a-0_entity-b-1_0', 'l_a_b_0', 'x-entity-y-1-cyclic-special-1']) {
    assert.equal(isConnectorLayerName(n), true, n)
  }
  // an entity whose name merely contains "edge" is not a connector parent
  for (const n of ['mermaid-svg-0-entity-knowledge_base-0', 'knowledge', 'acknowledge']) {
    assert.equal(isConnectorLayerName(n), false, n)
  }
  assert.equal(isShapeLayerName('mermaid-svg-0-flowchart-a-0'), true)
  assert.equal(isShapeLayerName('node default'), true)
  assert.equal(isShapeLayerName('mermaid-svg-0-entity-node_type-1'), false)
})
