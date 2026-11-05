// Pure helpers of the generic shape engine: path classification, pair matching, paint merge, text style.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePathData,
  classifyShape,
  groupStackedBounds,
  sameBounds,
  mergePaints,
  isRealDash,
  interStyleForWeight,
  offsetToPadding,
  simplifyClosed,
} from '../../plugin/src/shapeGeometry.ts'

const K = 0.5522847498
const circlePath = (r) =>
  `M ${2 * r} ${r} C ${2 * r} ${r + K * r} ${r + K * r} ${2 * r} ${r} ${2 * r} C ${r - K * r} ${2 * r} 0 ${r + K * r} 0 ${r} C 0 ${r - K * r} ${r - K * r} 0 ${r} 0 C ${r + K * r} 0 ${2 * r} ${r - K * r} ${2 * r} ${r} Z`
const stadium = (w, h) => {
  const r = h / 2
  return `M ${r} 0 L ${w - r} 0 C ${w - r + K * r} 0 ${w} ${r - K * r} ${w} ${r} C ${w} ${r + K * r} ${w - r + K * r} ${h} ${w - r} ${h} L ${r} ${h} C ${r - K * r} ${h} 0 ${r + K * r} 0 ${r} C 0 ${r - K * r} ${r - K * r} 0 ${r} 0 Z`
}
const roundedRect = (w, h, r) =>
  `M ${r} 0 L ${w - r} 0 C ${w - r + K * r} 0 ${w} ${r - K * r} ${w} ${r} L ${w} ${h - r} C ${w} ${h - r + K * r} ${w - r + K * r} ${h} ${w - r} ${h} L ${r} ${h} C ${r - K * r} ${h} 0 ${h - r + K * r} 0 ${h - r} L 0 ${r} C 0 ${r - K * r} ${r - K * r} 0 ${r} 0 Z`

test('parsePathData reads M L C Q Z, implicit repeats, exponents; rejects arcs and relative commands', () => {
  assert.deepEqual(parsePathData('M 0 0 L 10 0 10 5 Z').map((c) => c.c), ['M', 'L', 'L', 'Z'])
  assert.equal(parsePathData('M 2.3e-14 13.66 C 1 2 3 4 5 6').length, 2)
  assert.equal(parsePathData('M 0 0 A 5 5 0 0 0 10 0'), null)
  assert.equal(parsePathData('m 0 0 l 1 1'), null)
  assert.equal(parsePathData(''), null)
  assert.equal(parsePathData(undefined), null)
})

test('rect / rounded rect / stadium / circle become frame-able shapes with the right radius', () => {
  const rect = classifyShape('M 0 0 L 169.125 0 L 169.125 56 L 0 56 L 0 0 Z', 169.125, 56)
  assert.deepEqual(rect, { kind: 'Rectangle', rectLike: true, cornerRadius: 0 })

  const rr = classifyShape(roundedRect(150, 65, 3), 150, 65)
  assert.equal(rr.kind, 'Rounded Rectangle')
  assert.ok(rr.rectLike)
  assert.ok(Math.abs(rr.cornerRadius - 3) < 0.3, String(rr.cornerRadius))

  const st = classifyShape(stadium(155, 36), 155, 36)
  assert.equal(st.kind, 'Stadium')
  assert.ok(st.rectLike)
  assert.equal(st.cornerRadius, 18)

  const ci = classifyShape(circlePath(54), 108, 108)
  assert.equal(ci.kind, 'Circle')
  assert.ok(ci.rectLike)
  assert.equal(ci.cornerRadius, 54)
})

test('rough rect drawn with collinear curves is still a rectangle', () => {
  const d = 'M 0 0 C 50 0 100 0 139 0 C 139 18 139 38 139 56 C 100 56 50 56 0 56 C 0 38 0 18 0 0 Z'
  assert.equal(classifyShape(d, 139, 56).kind, 'Rectangle')
})

test('complex shapes are named and not rect-like', () => {
  const diamond = classifyShape('M 68.34 136.69 L 136.69 68.34 L 68.34 0 L 0 68.34 L 68.34 136.69 Z', 136.69, 136.69)
  assert.deepEqual([diamond.kind, diamond.rectLike], ['Diamond', false])
  assert.equal(classifyShape('M 9 36 L 119 36 L 128 18 L 119 0 L 9 0 L 0 18 L 9 36 Z', 128, 36).kind, 'Hexagon')
  assert.equal(classifyShape('M 0 36 L 145.94 36 L 163.94 0 L 18 0 L 0 36 Z', 163.94, 36).kind, 'Parallelogram')
  assert.equal(classifyShape('M 10 36 L 90 36 L 100 0 L 0 0 L 10 36 Z', 100, 36).kind, 'Trapezoid')
  assert.equal(classifyShape('M 8 36 L 104.95 36 L 104.95 0 L 8 0 L 8 36 L 0 36 L 112.95 36 L 112.95 0 L 0 0 L 0 36 Z', 112.95, 36).kind, 'Subroutine')
  assert.equal(classifyShape('M 0 0 L 100 0 L 100 36 L 0 36 L 12 18 L 0 0 Z', 100, 36).kind, 'Flag')
  const cyl = 'M 0 13.66 C 0 21.2 33.7 27.3 75.3 27.3 C 117 27.3 150.7 21.2 150.7 13.66 C 150.7 6.1 117 0 75.3 0 C 33.7 0 0 6.1 0 13.66 L 0 63.3 C 0 70.8 33.7 77 75.3 77 C 117 77 150.7 70.8 150.7 63.3 L 150.7 13.66'
  assert.equal(classifyShape(cyl, 150.7, 77).kind, 'Cylinder')
  const ellipse = `M 100 25 C 100 38.8 77.6 50 50 50 C 22.4 50 0 38.8 0 25 C 0 11.2 22.4 0 50 0 C 77.6 0 100 11.2 100 25 Z`
  assert.equal(classifyShape(ellipse, 100, 50).kind, 'Ellipse')
  assert.equal(classifyShape(ellipse, 100, 50).rectLike, false)
})

test('degenerate / unsupported data falls back to a complex Shape', () => {
  assert.deepEqual(classifyShape('M 0 0 A 5 5 0 0 0 10 0', 10, 10), { kind: 'Shape', rectLike: false, cornerRadius: 0 })
  assert.equal(classifyShape('M 0 0 L 10 0', 10, 0).rectLike, false)
  assert.equal(classifyShape(undefined, 10, 10).rectLike, false)
})

test('a plain triangle is never mistaken for a rectangle', () => {
  assert.equal(classifyShape('M 0 40 L 40 40 L 20 0 Z', 40, 40).rectLike, false)
})

test('groupStackedBounds pairs identical-bounds vectors (fill path + outline path)', () => {
  const v = (x, y, w, h) => ({ x, y, width: w, height: h })
  const groups = groupStackedBounds([v(0, 0, 155, 36), v(0.2, 0, 155.3, 36), v(200, 0, 50, 36), v(0, 0, 80, 20)])
  assert.deepEqual(groups.map((g) => g.length), [2, 1, 1])
  assert.ok(sameBounds(v(0, 0, 10, 10), v(0.4, -0.4, 10.3, 9.8)))
  assert.ok(!sameBounds(v(0, 0, 10, 10), v(0, 0, 11, 10)))
})

test('mergePaints keeps fill, stroke weight and dash pattern across a pair', () => {
  const fillOnly = { hasFill: true, hasStroke: false, strokeWeight: 0, dashPattern: [] }
  const strokeOnly = { hasFill: false, hasStroke: true, strokeWeight: 3, dashPattern: [6, 4] }
  assert.deepEqual(mergePaints([fillOnly, strokeOnly]), { fillFrom: 0, strokeFrom: 1, dash: [6, 4] })
  assert.deepEqual(mergePaints([strokeOnly, fillOnly]), { fillFrom: 1, strokeFrom: 0, dash: [6, 4] })
  // two filled+stroked near-duplicates: first wins, a dash that only the second has is kept
  const a = { hasFill: true, hasStroke: true, strokeWeight: 2, dashPattern: [0, 0] }
  const b = { hasFill: true, hasStroke: true, strokeWeight: 2, dashPattern: [2, 2] }
  assert.deepEqual(mergePaints([a, b]), { fillFrom: 0, strokeFrom: 0, dash: [2, 2] })
  assert.deepEqual(mergePaints([fillOnly]), { fillFrom: 0, strokeFrom: -1, dash: [] })
})

test('isRealDash only accepts patterns that draw gaps', () => {
  assert.ok(isRealDash([6, 4]))
  assert.ok(isRealDash([3]))
  assert.ok(!isRealDash([]))
  assert.ok(!isRealDash([0, 0]))
  assert.ok(!isRealDash([1, 0]))
  assert.ok(!isRealDash(undefined))
})

test('interStyleForWeight maps 400/500/600/700+ to Inter styles', () => {
  assert.equal(interStyleForWeight(400), 'Regular')
  assert.equal(interStyleForWeight(300), 'Regular')
  assert.equal(interStyleForWeight(500), 'Medium')
  assert.equal(interStyleForWeight(600), 'Semi Bold')
  assert.equal(interStyleForWeight(700), 'Bold')
  assert.equal(interStyleForWeight(900), 'Bold')
  assert.equal(interStyleForWeight(undefined), 'Regular')
})

test('offsetToPadding reproduces a vertical label offset with one-sided padding', () => {
  assert.deepEqual(offsetToPadding(0.5), { start: 0, end: 0 })
  assert.deepEqual(offsetToPadding(5.33), { start: 10.66, end: 0 })
  assert.deepEqual(offsetToPadding(-4), { start: 0, end: 8 })
})

test('simplifyClosed reduces a densely sampled polygon to its corners', () => {
  const pts = []
  for (let i = 0; i <= 50; i++) pts.push({ x: i * 2, y: 0 })
  for (let i = 1; i <= 18; i++) pts.push({ x: 100, y: i * 2 })
  for (let i = 1; i <= 50; i++) pts.push({ x: 100 - i * 2, y: 36 })
  for (let i = 1; i <= 18; i++) pts.push({ x: 0, y: 36 - i * 2 })
  assert.equal(simplifyClosed(pts, 1).length, 4)
})
