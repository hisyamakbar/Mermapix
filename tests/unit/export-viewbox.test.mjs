// Phase 10.1: viewBox padding of buildExportSvg (src/export/svg.ts, padViewBoxAxis). The old code moved the box
// to -24/-16 but only widened it for an origin of 0, so diagrams with a positive origin lost their right/bottom.
import test from 'node:test'
import assert from 'node:assert/strict'
import { padViewBoxAxis } from '../../src/export/svg.ts'

/** The pre-10.1 formula, kept here to prove an origin of 0 (and everything at or below it) is byte-identical. */
const oldAxis = (min, size, pad) => (min > -pad ? { min: -pad, size: size + (pad - min) + 12 } : { min, size })

test('an origin of 0 gives exactly the old result (ERD, flowchart, sequence x)', () => {
  assert.deepEqual(padViewBoxAxis(0, 309.125, 24), { min: -24, size: 309.125 + 36 })
  assert.deepEqual(padViewBoxAxis(0, 633, 16), { min: -16, size: 633 + 28 })
  for (const [min, size, pad] of [[0, 100, 24], [0, 800, 16], [-10, 421, 16], [-8, 887, 24], [-0.25, 216, 24], [-50, 676, 24], [-150, 1206, 24], [-310, 132, 16]]) {
    assert.deepEqual(padViewBoxAxis(min, size, pad), oldAxis(min, size, pad), `${min} ${size} ${pad}`)
  }
})

test('a positive origin is padded around itself: the far side widens (treemap 2,27 / kanban 90 / timeline 100 / mindmap 5)', () => {
  for (const [min, size, pad] of [[2, 996, 24], [27, 371, 16], [90, 540, 24], [100, 1002, 24], [5, 569, 24], [5, 405, 16]]) {
    const out = padViewBoxAxis(min, size, pad)
    assert.equal(out.min, min - pad, 'margin before = pad')
    assert.equal(out.min + out.size, min + size + 12, 'margin after = 12')
  }
})

test('never shrinks and always keeps the margins around Mermaid\'s box when it had to move', () => {
  for (let min = -60; min <= 120; min += 3.5) {
    for (const [size, pad] of [[300, 24], [300, 16]]) {
      const out = padViewBoxAxis(min, size, pad)
      assert.ok(out.min <= min, `${min}: start does not move inward`)
      assert.ok(out.min + out.size >= min + size, `${min}: end does not move inward (never cropped)`)
      if (min > 0) assert.ok(out.min <= min - pad && out.min + out.size >= min + size + 12 - 1e-9, `${min}: margins`)
    }
  }
})
