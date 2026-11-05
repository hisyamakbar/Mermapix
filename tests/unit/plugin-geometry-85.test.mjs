// Phase 8.5 pure helpers: class compartments, state recognition, generic fallback rules, geometric edge ends.
import test from 'node:test'
import assert from 'node:assert/strict'
import { classIdFromName, classNoteIdFromName, isAnnotationText, splitCompartments, compartmentIndex, compartmentName, stackPadding, centerPadding } from '../../plugin/src/classGeometry.ts'
import { stateInfoFromName, pseudoStateKind, isCompositePair } from '../../plugin/src/stateGeometry.ts'
import { fallbackMode, diagramTypeFromSvg, isGenericLayerName, isRawMermaidId, cleanRawId, vectorKind, assignTextsToRects, textCenteredIn } from '../../plugin/src/genericGeometry.ts'
import { edgeBodyFromName, isAnonymousEdgeName, distanceToRectOutline, nearestTarget, resolveEdgeEndpointsByGeometry, resolveEdgeEndpoints } from '../../plugin/src/connectorGeometry.ts'
import { classifyShape } from '../../plugin/src/shapeGeometry.ts'
import { markerKindFromId, markerLayerName, buildMarkerLayerId } from '../../plugin/src/naming.ts'

test('class group / note names', () => {
  assert.equal(classIdFromName('mermaid-svg-0-classId-Shape-6'), 'Shape')
  assert.equal(classIdFromName('mermaid-svg-0-classId-My-Class-12'), 'My-Class')
  assert.equal(classIdFromName('mermaid-svg-0-Shapes'), null)
  assert.equal(classIdFromName('mermaid-svg-0-id_Animal_Duck_2'), null)
  assert.equal(classNoteIdFromName('mermaid-svg-0-note0'), 'note0')
  assert.equal(classNoteIdFromName('mermaid-svg-0-edgeNote0'), null)
  assert.ok(isAnnotationText('«interface»'))
  assert.ok(isAnnotationText('<<abstract>>'))
  assert.ok(!isAnnotationText('Shape'))
})

test('compartments tile the box exactly and dividers become inside-bottom borders', () => {
  const spans = splitCompartments(59, 233, [{ y: 174, weight: 1 }, { y: 115, weight: 1 }])
  assert.deepEqual(spans, [{ top: 59, bottom: 115.5 }, { top: 115.5, bottom: 174.5 }, { top: 174.5, bottom: 233 }])
  assert.equal(spans.reduce((a, s) => a + s.bottom - s.top, 0), 174)
  assert.deepEqual(splitCompartments(0, 40, []), [{ top: 0, bottom: 40 }])
  assert.equal(compartmentIndex(spans, 70), 0)
  assert.equal(compartmentIndex(spans, 115.5), 1)
  assert.equal(compartmentIndex(spans, 232), 2)
  assert.equal(compartmentIndex(spans, 999), 2)
  assert.deepEqual([0, 1, 2].map((i) => compartmentName(i, 3)), ['Header', 'Attributes', 'Methods'])
  assert.deepEqual([0, 1].map((i) => compartmentName(i, 2)), ['Header', 'Members'])
})

test('stack padding reproduces centers, spacing and horizontal offsets', () => {
  // two lines 19px apart, 16px tall in the new font, first center at 50 inside a span starting at 40
  assert.deepEqual(stackPadding([50, 69], [16, 16], 40), { paddingTop: 2, itemSpacing: 3 })
  assert.deepEqual(stackPadding([], [], 0), { paddingTop: 0, itemSpacing: 0 })
  assert.deepEqual(stackPadding([10], [16], 5), { paddingTop: 0, itemSpacing: 0 }, 'never negative')
  assert.deepEqual(stackPadding([30, 31], [20, 20], 0), { paddingTop: 20, itemSpacing: 0 })
  assert.deepEqual(centerPadding(140, 100, 80), { left: 0, right: 0 })
  assert.deepEqual(centerPadding(138.5, 100, 80), { left: 0, right: 3 })
  assert.deepEqual(centerPadding(141.5, 100, 80), { left: 3, right: 0 })
})

test('state group names and pseudo state kinds', () => {
  assert.deepEqual(stateInfoFromName('mermaid-svg-0-state-Idle-17'), { id: 'Idle', role: 'node' })
  assert.deepEqual(stateInfoFromName('mermaid-svg-0-state-root_start-0'), { id: 'root_start', role: 'start' })
  assert.deepEqual(stateInfoFromName('mermaid-svg-0-state-Active_end-6'), { id: 'Active_end', role: 'end' })
  assert.deepEqual(stateInfoFromName('mermaid-svg-0-state-Idle----note-17'), { id: 'Idle----note', role: 'note' })
  assert.deepEqual(stateInfoFromName('mermaid-svg-0-Idle----parent-17'), null)
  assert.deepEqual(stateInfoFromName('mermaid-svg-0-state-Idle----parent-17'), { id: 'Idle----parent', role: 'parent' })
  assert.equal(stateInfoFromName('mermaid-svg-0-edge4'), null)
  assert.equal(pseudoStateKind('Diamond', 28, 28, 'c'), 'Choice')
  assert.equal(pseudoStateKind('Rectangle', 70, 10, 'join_state'), 'Join')
  assert.equal(pseudoStateKind('Rectangle', 70, 10, 'fork_state'), 'Fork')
  assert.equal(pseudoStateKind('Rectangle', 10, 70, 'x'), 'Fork/Join')
  assert.equal(pseudoStateKind('Rectangle', 40, 30, 'x'), null)
  assert.ok(isCompositePair({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 18, width: 100, height: 82 }))
  assert.ok(!isCompositePair({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }))
  assert.ok(!isCompositePair({ x: 0, y: 0, width: 100, height: 100 }, { x: 5, y: 18, width: 90, height: 80 }))
})

test('fallback mode per diagram type', () => {
  for (const t of ['er', 'flowchart-v2', 'flowchart-elk', 'sequence', 'class', 'stateDiagram']) assert.equal(fallbackMode(t), 'skip', t)
  for (const t of ['pie', 'gantt', 'xychart', 'quadrantChart', 'sankey', 'packet', 'treemap', 'radar', 'venn', 'gitGraph', 'timeline', 'journey']) assert.equal(fallbackMode(t), 'marks', t)
  for (const t of ['block', 'c4', 'kanban', 'architecture', 'mindmap', 'requirement', 'wardley']) assert.equal(fallbackMode(t), 'nodes', t)
  assert.equal(fallbackMode(''), 'names')
  assert.equal(fallbackMode('swimlane'), 'names')
  assert.equal(fallbackMode('someFutureDiagram'), 'names')
  assert.equal(diagramTypeFromSvg('<?xml version="1.0"?><svg id="m" role="img" aria-roledescription="pie" x="1">'), 'pie')
  assert.equal(diagramTypeFromSvg('<svg><g aria-roledescription="x"/></svg>'), '')
  assert.equal(diagramTypeFromSvg(undefined), '')
})

test('layer naming helpers', () => {
  for (const n of ['', 'Vector', 'Group', 'Frame 12', 'Vector 3', 'mermaid-svg-0-Todo', 'mermaid-svg-0']) assert.ok(isGenericLayerName(n), n)
  for (const n of ['Line', 'Todo', 'Edge: A → B', 'Rectangle: API']) assert.ok(!isGenericLayerName(n), n)
  assert.ok(isRawMermaidId('mermaid-svg-0-edge_0_1'))
  assert.equal(cleanRawId('mermaid-svg-0-Create docs'), 'Create docs')
  assert.equal(cleanRawId('mermaid-svg-12-test_req2'), 'test_req2')
  assert.equal(cleanRawId('mermaid-svg-0-node-3'), 'node')
  assert.equal(cleanRawId('mermaid-svg-0'), '')
  assert.equal(vectorKind('M 0 0 L 100 0', 100, 0, false), 'Line')
  assert.equal(vectorKind('M 0 0 L 10 10 L 20 0', 20, 10, false), 'Curve')
  assert.equal(vectorKind('M 0 0 L 10 0 L 10 10 L 0 10 L 0 0 Z', 10, 10, true), 'Rectangle')
})

test('texts are assigned to the smallest vector that contains their center', () => {
  const rects = [{ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 30, height: 30 }, { x: 60, y: 60, width: 1, height: 1 }]
  const texts = [{ x: 15, y: 15, width: 10, height: 10 }, { x: 70, y: 70, width: 10, height: 10 }, { x: 500, y: 500, width: 5, height: 5 }]
  assert.deepEqual(assignTextsToRects(rects, texts), [1, 0, -1])
  assert.ok(textCenteredIn({ x: 45, y: 45, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 }))
  assert.ok(!textCenteredIn({ x: 0, y: 40, width: 20, height: 10 }, { x: 0, y: 0, width: 200, height: 100 }), 'left aligned label is not centered')
})

test('class and anonymous edge names, geometric endpoints', () => {
  assert.equal(edgeBodyFromName('mermaid-svg-0-id_Animal_Duck_2'), 'Animal_Duck')
  assert.equal(edgeBodyFromName('mermaid-svg-0-L_A_B_0'), 'A_B')
  assert.equal(edgeBodyFromName('mermaid-svg-0-id_entity-A-0_entity-B-1_0'), null, 'ERD relationships stay out')
  assert.equal(edgeBodyFromName('mermaid-svg-0-edge4'), null)
  for (const n of ['mermaid-svg-0-edge4', 'mermaid-svg-0-edgeNote0', 'mermaid-svg-0-Idle-Idle----note-17']) assert.ok(isAnonymousEdgeName(n), n)
  for (const n of ['mermaid-svg-0-state-Idle-17', 'mermaid-svg-0-L_A_B_0', 'mermaid-svg-0-edge_0_1']) assert.ok(!isAnonymousEdgeName(n), n)
  assert.deepEqual(resolveEdgeEndpoints('Animal_Duck', ['Animal', 'Duck']), { from: 'Animal', to: 'Duck', known: true })
  const A = { id: 'A', rect: { x: 0, y: 0, width: 50, height: 30 } }
  const B = { id: 'B', rect: { x: 0, y: 100, width: 50, height: 30 } }
  assert.equal(distanceToRectOutline({ x: 25, y: 30 }, A.rect), 0)
  assert.equal(distanceToRectOutline({ x: 25, y: 40 }, A.rect), 10)
  assert.equal(distanceToRectOutline({ x: 25, y: 15 }, A.rect), 15, 'inside: distance to the nearest side')
  assert.equal(nearestTarget({ x: 25, y: 38 }, [A, B]).id, 'A')
  assert.equal(nearestTarget({ x: 25, y: 65 }, [A, B], 20), null, 'too far from both')
  assert.deepEqual(resolveEdgeEndpointsByGeometry([{ x: 25, y: 31 }, { x: 25, y: 60 }, { x: 25, y: 99 }], [A, B]), { from: 'A', to: 'B' })
  assert.equal(resolveEdgeEndpointsByGeometry([{ x: 25, y: 31 }, { x: 400, y: 400 }], [A, B]), null)
  // the smaller container wins a tie (composite outer vs. a state sharing its border)
  const big = { id: 'big', rect: { x: 0, y: 0, width: 100, height: 100 } }
  const small = { id: 'small', rect: { x: 0, y: 0, width: 50, height: 30 } }
  assert.equal(nearestTarget({ x: 0, y: 10 }, [big, small]).id, 'small')
})

test('classify: the open 4-corner polygon of a rough rect is a Rectangle, other polygons are unchanged', () => {
  assert.deepEqual(classifyShape('M 0 0 L 155 0 L 155 174 L 0 174', 155, 174), { kind: 'Rectangle', rectLike: true, cornerRadius: 0 })
  assert.deepEqual(classifyShape('M 0 0 L 155 0 L 155 174 L 0 174 L 0 0 Z', 155, 174), { kind: 'Rectangle', rectLike: true, cornerRadius: 0 })
  assert.equal(classifyShape('M 0 0 L 70 0 L 70 10 L 0 10', 70, 10).rectLike, true)
  assert.equal(classifyShape('M 20 0 L 100 0 L 80 30 L 0 30 Z', 100, 30).kind, 'Parallelogram')
  assert.equal(classifyShape('M 50 0 L 100 25 L 50 50 L 0 25 Z', 100, 50).kind, 'Diamond')
  assert.equal(classifyShape('M 0 0 L 100 0 L 100 40 L 0 40 L 0 20', 100, 40).rectLike, false)
})

test('marker kinds added in 8.5: barb / arrow / contains', () => {
  assert.equal(markerKindFromId('mermaid-svg-0_stateDiagram-barbEnd'), 'arrowhead')
  assert.equal(markerKindFromId('mermaid-svg-0_requirement-requirement_arrowEnd'), 'arrowhead')
  assert.equal(markerKindFromId('mermaid-svg-0_requirement-requirement_containsStart'), 'contains')
  assert.equal(markerKindFromId('mermaid-svg-0_class-compositionStart'), 'composition')
  assert.equal(markerLayerName(buildMarkerLayerId(3, 'contains', 'start')), 'Contains Marker')
  assert.equal(markerLayerName(buildMarkerLayerId(1, 'arrowhead', 'end')), 'Arrowhead (end)')
})
