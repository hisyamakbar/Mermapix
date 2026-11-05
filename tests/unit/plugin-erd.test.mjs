import test from 'node:test'
import assert from 'node:assert/strict'
import { computeColumnWidths, CELL_PADDING_X, COLUMN_SLACK } from '../../plugin/src/erdLayout.ts'
import { collectEntityVectors, extractErdPaints } from '../../plugin/src/erdPaints.ts'

const base = { type: 0, name: 0, key: 0, comment: 0, hasType: false, hasKey: false, hasComment: false }

test('computeColumnWidths: columns fit content (+padding) and sum to tableWidth', () => {
  const w = computeColumnWidths(300, { ...base, type: 33, name: 60, key: 20, hasType: true, hasKey: true })
  assert.ok(w.type >= 33 + CELL_PADDING_X, 'type cell holds the 33px text (regression: 33px text in 29px cell)')
  assert.ok(w.key >= 20 + CELL_PADDING_X)
  assert.ok(w.name >= 60 + CELL_PADDING_X)
  assert.equal(w.type + w.name + w.key + w.comment, 300)
  assert.equal(w.comment, 0)
  assert.equal(w.type, 33 + CELL_PADDING_X + COLUMN_SLACK)
})

test('computeColumnWidths: shrinks proportionally but keeps the table width when content cannot fit', () => {
  const w = computeColumnWidths(150, { ...base, type: 100, name: 100, comment: 100, hasType: true, hasComment: true })
  assert.equal(w.type + w.name + w.key + w.comment, 150)
  assert.ok(w.type >= 24 && w.name >= 24 && w.comment >= 24)
})

test('computeColumnWidths: only a name column takes the whole table', () => {
  const w = computeColumnWidths(200, { ...base, name: 40 })
  assert.deepEqual(w, { type: 0, key: 0, comment: 0, name: 200 })
})

const solid = (r, g, b) => [{ type: 'SOLID', color: { r, g, b } }]
const vec = (o) => ({ type: 'VECTOR', name: 'Vector', width: 100, height: 30, fills: [], strokes: [], ...o })
const grp = (children) => ({ type: 'GROUP', children })

test('extractErdPaints: header <- pair 0 fill, row i <- pair i+1 fill, border <- outline stroke', () => {
  const H = solid(0.9, 0.9, 0.95), R0 = solid(1, 1, 1), R1 = solid(0.99, 0.96, 0.96), B = solid(0.5, 0.5, 0.6)
  const entity = grp([
    grp([vec({ fills: H }), vec({ strokes: B })]),
    grp([vec({ fills: R0 }), vec({ strokes: solid(0.1, 0.1, 0.1) })]),
    grp([vec({ fills: R1 }), vec({ strokes: solid(0.1, 0.1, 0.1) })]),
    vec({ strokes: solid(0.2, 0.2, 0.2) }),
  ])
  const p = extractErdPaints(collectEntityVectors(entity), 2)
  assert.equal(p.headerFill, H)
  assert.equal(p.rowFills[0], R0)
  assert.equal(p.rowFills[1], R1)
  assert.equal(p.border, B)
  assert.deepEqual(p.fromSvg, { header: true, rows: [true, true], border: true })
})

test('extractErdPaints: falls back to theme tokens per missing part', () => {
  const theme = { primaryColor: '#112233', attributeBackgroundColorOdd: '#ffffff', attributeBackgroundColorEven: '#000000', primaryBorderColor: '#ff0000' }
  const only = grp([vec({ fills: solid(0.9, 0.9, 0.9) })]) // header fill only
  const p = extractErdPaints(collectEntityVectors(only), 2, theme)
  assert.equal(p.fromSvg.header, true)
  assert.deepEqual(p.fromSvg.rows, [false, false])
  assert.equal(p.fromSvg.border, false)
  assert.deepEqual(p.rowFills[0][0].color, { r: 1, g: 1, b: 1 })
  assert.deepEqual(p.rowFills[1][0].color, { r: 0, g: 0, b: 0 })
  assert.deepEqual(p.border[0].color, { r: 1, g: 0, b: 0 })

  const none = extractErdPaints([], 1, theme)
  assert.equal(none.fromSvg.header, false)
  assert.deepEqual(none.headerFill[0].color, { r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255 })
})
