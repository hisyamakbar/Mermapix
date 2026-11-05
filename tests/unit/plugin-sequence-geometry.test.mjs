// Phase 8.4 pure helpers (sequenceGeometry.ts) + the cleanup/importer pieces the sequence step relies on.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isLifelineName,
  inlinedMarkerKind,
  isSequenceGroupName,
  messageName,
  pathEnds,
  nearestIndex,
  pickBlockBorder,
  stackedLinePitch,
  hexOfPaint,
} from '../../plugin/src/sequenceGeometry.ts'
import { elevateSequenceNumbers } from '../../plugin/src/cleanup.ts'
import { MockNode } from '../plugin-mock/figma-mock.mjs'
import { importSvg } from '../plugin-mock/svg-import.mjs'

test('lifeline and marker layer names', () => {
  assert.equal(isLifelineName('actor3'), true)
  assert.equal(isLifelineName('actor-man-torso0'), false)
  assert.equal(isLifelineName('Lifeline: A'), false)
  assert.deepEqual(inlinedMarkerKind('inlined-marker-12-sequence-number-start'), { kind: 'sequence-number', position: 'start' })
  assert.deepEqual(inlinedMarkerKind('inlined-marker-3-arrowhead-end'), { kind: 'arrowhead', position: 'end' })
  assert.equal(inlinedMarkerKind('Group'), null)
})

test('sequence group names are protected from wrapper dissolving', () => {
  for (const n of ['Participants (bottom)', 'Lifelines', 'Participants (top)', 'Actors', 'Activations', 'Notes', 'Blocks', 'Messages', 'Message 1: Hi (A → B)']) assert.equal(isSequenceGroupName(n), true, n)
  for (const n of ['Group', 'root-1', '', 'Edge: A → B']) assert.equal(isSequenceGroupName(n), false, n)
})

test('messageName keeps the label and participants short', () => {
  assert.equal(messageName(1, 'Checkout cart', 'Customer', 'Storefront'), 'Message 1: Checkout cart (Customer → Storefront)')
  assert.equal(messageName('7', '', 'A', 'B'), 'Message 7 (A → B)')
  assert.equal(messageName(2, 'Hi', '', ''), 'Message 2: Hi')
  const long = messageName(3, 'x'.repeat(80), 'y'.repeat(50), 'z'.repeat(50))
  assert.ok(long.length < 120)
  assert.ok(long.includes('…'))
})

test('pathEnds gives the start and end point (direction of a message)', () => {
  assert.deepEqual(pathEnds('M 0 0 L 214 0', 132, 131), { start: { x: 132, y: 131 }, end: { x: 346, y: 131 } })
  assert.deepEqual(pathEnds('M 309 0 L 0 0', 354, 231), { start: { x: 663, y: 231 }, end: { x: 354, y: 231 } })
  const loop = pathEnds('M 0 1.6 C 60 -8.4 60 31.6 0 21.6', 630, 229.4)
  assert.ok(Math.abs(loop.start.x - loop.end.x) < 0.01, 'self message starts and ends on the same x')
  assert.equal(pathEnds('', 0, 0), null)
})

test('nearestIndex maps an x to a lifeline within a tolerance', () => {
  assert.equal(nearestIndex(230, [225, 425, 625]), 0)
  assert.equal(nearestIndex(430, [225, 425, 625], 10), 1)
  assert.equal(nearestIndex(500, [225, 425, 625], 10), -1)
})

const seg = (id, x1, y1, x2, y2) => ({ id, x1, y1, x2, y2 })

test('pickBlockBorder finds the 4 border lines and the dividers (alt / else)', () => {
  const b = pickBlockBorder([
    seg(0, 114, 291, 893, 291), seg(1, 893, 291, 893, 631), seg(2, 114, 631, 893, 631), seg(3, 114, 291, 114, 631),
    seg(4, 114, 491, 893, 491),
  ])
  assert.deepEqual(b.rect, { x: 114, y: 291, width: 779, height: 340 })
  assert.deepEqual([b.top, b.right, b.bottom, b.left], [0, 1, 2, 3])
  assert.deepEqual(b.dividers, [4])
  assert.deepEqual(b.extras, [])
})

test('pickBlockBorder is order independent, keeps unknown lines as extras and rejects open boxes', () => {
  const b = pickBlockBorder([
    seg(0, 0, 0, 0, 100), seg(1, 0, 100, 200, 100), seg(2, 200, 0, 200, 100), seg(3, 0, 0, 200, 0), seg(4, 50, 40, 90, 40),
  ])
  assert.deepEqual([b.top, b.right, b.bottom, b.left], [3, 2, 1, 0])
  assert.deepEqual(b.dividers, [], 'a short inner line is not a divider')
  assert.deepEqual(b.extras, [4])
  assert.equal(pickBlockBorder([seg(0, 0, 0, 200, 0), seg(1, 0, 100, 200, 100), seg(2, 0, 0, 0, 100)]), null, 'only 3 sides')
  assert.equal(pickBlockBorder([]), null)
})

test('stackedLinePitch recognizes lines of one multi-line label only', () => {
  const r = (x, y, w, h = 19) => ({ x, y, width: w, height: h })
  assert.equal(stackedLinePitch([r(463, 533, 116), r(473, 553, 97)]), 20)
  assert.equal(stackedLinePitch([r(463, 533, 116), r(473, 553, 97), r(470, 573, 100)]), 20)
  assert.equal(stackedLinePitch([r(100, 100, 50)]), null)
  assert.equal(stackedLinePitch([r(100, 100, 50), r(400, 120, 50)]), null, 'far apart horizontally = two labels')
  assert.equal(stackedLinePitch([r(100, 100, 50), r(100, 105, 50)]), null, 'overlapping lines')
  assert.equal(stackedLinePitch([r(100, 100, 50), r(100, 120, 50), r(100, 160, 50)]), null, 'uneven spacing')
})

test('hexOfPaint', () => {
  assert.equal(hexOfPaint([{ type: 'SOLID', color: { r: 40 / 255, g: 60 / 255, b: 90 / 255 } }]), '#283c5a')
  assert.equal(hexOfPaint([]), '')
  assert.equal(hexOfPaint(undefined), '')
})

// ---------------------------------------------------------------- cleanup: number inside its badge

test('elevateSequenceNumbers leaves a number inside its Badge frame alone but still lifts loose numbers', () => {
  const env = { ids: 0 }
  const root = new MockNode(env, 'FRAME', { name: 'root' })
  const badge = new MockNode(env, 'FRAME', { name: 'Badge 1', width: 24, height: 24 })
  badge.setPluginData('mermapix:kind', 'Sequence Badge')
  const num = new MockNode(env, 'TEXT', { characters: '1', width: 8, height: 14 })
  const other = new MockNode(env, 'TEXT', { characters: 'x', width: 8, height: 14 })
  badge.appendChild(num)
  badge.appendChild(other)
  const loose = new MockNode(env, 'TEXT', { characters: '7', width: 8, height: 14 })
  const circle = new MockNode(env, 'VECTOR', { width: 24, height: 24 })
  root.appendChild(loose)
  root.appendChild(circle)
  root.appendChild(badge)
  elevateSequenceNumbers(root)
  assert.deepEqual(badge.children.map((c) => c.characters ?? c.name), ['1', 'x'], 'order inside the badge untouched')
  assert.equal(root.children[root.children.length - 1], loose, 'a loose number is moved above the vector')
})

// ---------------------------------------------------------------- mock importer fidelity for the new SVG element kinds

const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">${inner}</svg>`
const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number)

test('mock importer: <rect rx> becomes the rounded path Figma produces (straight edges + one cubic per corner)', () => {
  const root = importSvg({ ids: 0 }, wrap('<rect x="10" y="20" width="150" height="65" rx="3" ry="3" fill="#1e293b" stroke="#38bdf8"/>'))
  const v = root.children[0]
  assert.equal(v.type, 'VECTOR')
  assert.deepEqual([v.x, v.y, v.width, v.height], [10, 20, 150, 65])
  const d = v.vectorPaths[0].data
  assert.ok(d.startsWith('M 3 0 L 147 0 C 148.65'), d) // real Figma: M 3 0 L 147 0 C 148.66 0 150 1.34 150 3 L 150 ...
  assert.equal((d.match(/C/g) || []).length, 4)
  assert.ok(d.endsWith('Z'))
})

test('mock importer: a plain rect keeps its square path; polygon closes back to its first point like Figma', () => {
  const root = importSvg({ ids: 0 }, wrap('<rect x="0" y="0" width="10" height="5" fill="#fff"/><polygon points="0,0 50,0 50,13 41.6,20 0,20" fill="#0f172a" stroke="#38bdf8"/>'))
  assert.equal(root.children[0].vectorPaths[0].data, 'M 0 0 L 10 0 L 10 5 L 0 5 L 0 0 Z')
  assert.equal(root.children[1].vectorPaths[0].data, 'M 0 0 L 50 0 L 50 13 L 41.6 20 L 0 20 L 0 0 Z')
})

test('mock importer: lines, circles and text become VECTOR / TEXT with the right bounds and dash', () => {
  const root = importSvg({ ids: 0 }, wrap('<line id="actor1" x1="100" y1="65" x2="100" y2="685" stroke="#475569" stroke-width="2"/><line x1="0" y1="10" x2="776" y2="10" stroke="#38bdf8" stroke-dasharray="3, 3"/><circle cx="125" cy="60" r="15" fill="#1e293b" stroke="#38bdf8"/><text><tspan x="10" y="30">Hi</tspan></text>'))
  const [ll, dashed, head, text] = root.children
  assert.equal(ll.name, 'actor1')
  assert.deepEqual([ll.x, ll.y, ll.width, ll.height], [100, 65, 0, 620])
  assert.deepEqual(dashed.dashPattern, [3, 3])
  assert.deepEqual([head.x, head.y, head.width, head.height], [110, 45, 30, 30])
  assert.equal(text.type, 'TEXT')
})

test('mock Figma: moving a GROUP moves its contents (like Figma), moving a FRAME does not', () => {
  const env = { ids: 0 }
  const frame = new MockNode(env, 'FRAME', { x: 0, y: 0 })
  const group = new MockNode(env, 'GROUP')
  const a = new MockNode(env, 'VECTOR', { x: 10, y: 10, width: 5, height: 5 })
  frame.appendChild(group)
  group.appendChild(a)
  group.x = 30
  assert.equal(a.x, 40)
  const f2 = new MockNode(env, 'FRAME', { x: 0, y: 0 })
  const b = new MockNode(env, 'VECTOR', { x: 10, y: 10 })
  f2.appendChild(b)
  f2.x = 100
  assert.equal(b.x, 10)
})
