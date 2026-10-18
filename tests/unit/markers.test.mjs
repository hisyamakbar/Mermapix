import test from 'node:test'
import assert from 'node:assert/strict'
import { inlineSvgMarkers } from '../../src/export/markers.ts'

test('inlineSvgMarkers inlines crow foot marker on path elements', () => {
  const inputSvg = `
<svg>
  <defs>
    <marker id="test-crowsfoot" refX="0" refY="5" markerWidth="10" markerHeight="10">
      <path d="M 0 0 L 10 5 L 0 10" />
    </marker>
  </defs>
  <path d="M 10 20 L 100 20" stroke="#38bdf8" marker-end="url(#test-crowsfoot)" />
</svg>`

  const output = inlineSvgMarkers(inputSvg)
  assert.ok(output.includes('inlined-marker inlined-marker-end'))
  assert.ok(output.includes('transform="translate(100, 20) rotate(0) translate(0, -5)"'))
  assert.ok(output.includes('<path d="M 0 0 L 10 5 L 0 10" />'))
})

test('inlineSvgMarkers inlines sequence diagram message line arrowheads', () => {
  const inputSvg = `
<svg>
  <defs>
    <marker id="mermaid-arrowhead" refX="7.9" refY="5" markerWidth="12" markerHeight="12">
      <path d="M -1 0 L 10 5 L 0 10 z" />
    </marker>
  </defs>
  <line x1="100" y1="150" x2="300" y2="150" stroke="#1f2733" marker-end="url(#mermaid-arrowhead)" />
</svg>`

  const output = inlineSvgMarkers(inputSvg)
  assert.ok(output.includes('inlined-marker inlined-marker-end inlined-arrowhead'))
  assert.ok(output.includes('transform="translate(300, 150) rotate(0) translate(-7.9, -5)"'))
  assert.ok(output.includes('fill="#1f2733"'))
  assert.ok(output.includes('stroke="#1f2733"'))
})

test('inlineSvgMarkers inlines sequence autonumber circle badges on point lines', () => {
  const inputSvg = `
<svg>
  <defs>
    <marker id="mermaid-sequencenumber" refX="15" refY="15" markerWidth="60" markerHeight="40">
      <circle cx="15" cy="15" r="6" />
    </marker>
  </defs>
  <line x1="200" y1="120" x2="200" y2="120" stroke-width="0" stroke="#1f2733" marker-start="url(#mermaid-sequencenumber)" />
</svg>`

  const output = inlineSvgMarkers(inputSvg)
  assert.ok(output.includes('inlined-marker inlined-marker-start inlined-sequence-number-badge'))
  assert.ok(output.includes('transform="translate(200, 120) rotate(0) translate(-15, -15)"'))
  assert.ok(output.includes('stroke="none"'))
  assert.ok(output.includes('fill="#1f2733"'))
  assert.ok(output.includes('<circle cx="15" cy="15" r="6" />'))
})

test('inlineSvgMarkers inlines class diagram generalization extension arrows with exact d endpoints', () => {
  const inputSvg = `
<svg>
  <defs>
    <marker id="classDiagram-extensionStart" class="extension" refX="18" refY="7" markerWidth="20" markerHeight="28" orient="auto">
      <path d="M 1,7 L18,13 V 1 Z" />
    </marker>
  </defs>
  <path d="M188.08,133.587C170.83,142.17 148.5,153.25 100,200" stroke="#38bdf8" marker-start="url(#classDiagram-extensionStart)" />
</svg>`

  const output = inlineSvgMarkers(inputSvg)
  assert.ok(output.includes('inlined-marker inlined-marker-start inlined-extension-arrow'))
  assert.ok(output.includes('translate(188.08, 133.587)'))
  assert.ok(output.includes('translate(-18, -7)'))
  assert.ok(output.includes('stroke="#38bdf8"'))
  assert.ok(output.includes('fill="#1e293b"'))
})
