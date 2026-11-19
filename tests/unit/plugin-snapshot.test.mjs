// Phase 12: per-layer stamps and the change report (plugin/src/snapshot.ts).
// Everything runs through the bundled sandbox (plugin/code.js, rebuild with `pnpm build:plugin`) on the mock Figma:
// the UI side only ever sees `inspect-diagram` / `diagram-changes` / `update-needs-confirm`, so those are what is tested.
// Set MERMAPIX_CODE=<other bundle> to run against another build (used to prove the tests red against mutants).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { MockNode } from '../plugin-mock/figma-mock.mjs'
import { createSession } from '../plugin-mock/session.mjs'
import { fixturePath, readSurveySvg, SURVEY_TYPES, THEMES } from '../plugin-mock/run-fixture.mjs'
import { COUNT_KEY, SNAP_KEY, TEXT_KEY } from '../../plugin/src/snapshot.ts'
import { FINGERPRINT_KEY } from '../../plugin/src/sourceLink.ts'

// ---------------------------------------------------------------- helpers

const svgOf = (example, theme = 'light') => fs.readFileSync(fixturePath(example, theme), 'utf8')
const CLEAN = { texts: [], moved: 0, restyled: 0, added: 0, removed: 0, other: false }
const solid = (r, g, b) => ({ type: 'SOLID', color: { r, g, b } })
const SRC = 'flowchart TD\n  A[Start] --> B[End]'

function descendants(n, out = []) {
  for (const c of n.children || []) { out.push(c); descendants(c, out) }
  return out
}

async function insert(s, svg, theme = 'light') {
  const out = await s.send({ type: 'create-svg', svg, name: 'D', theme, themeVariables: THEMES[theme], source: SRC })
  assert.deepEqual(out.filter((m) => m.type === 'inserted'), [{ type: 'inserted', linked: true }], JSON.stringify(out))
  return s.page.children[s.page.children.length - 1]
}

async function inspect(s, root) {
  const out = await s.send({ type: 'inspect-diagram', id: root.id })
  assert.equal(out.length, 1, JSON.stringify(out))
  assert.equal(out[0].type, 'diagram-changes')
  assert.equal(out[0].id, root.id)
  return out[0].changes
}

async function fresh(example, theme = 'light') {
  const s = createSession()
  const root = await insert(s, svgOf(example, theme), theme)
  return { s, root }
}

/** The text layer of an ERD cell, found by structure (card name, column name, cell index), independent of the stamps. */
function erdCell(root, entity, col, row) {
  const card = descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:kind') === 'ERD Table' && n.name === entity)
  assert.ok(card, `ERD table ${entity}`)
  const content = card.children.find((c) => c.name === 'Content')
  const column = content.children.find((c) => c.name === `Column: ${col}`)
  const cell = column.children[row]
  return { card, content, column, cell, text: cell.children.find((c) => c.type === 'TEXT') }
}

const textNamed = (root, characters) => descendants(root).find((n) => n.type === 'TEXT' && n.characters === characters)

/** Deep copy of a node (like Figma's duplicate): new ids, same plugin data. */
function clone(env, n) {
  const c = new MockNode(env, n.type, { name: n.name, x: n.x, y: n.y, width: n.width, height: n.height, fills: n.fills && [...n.fills], strokes: n.strokes && [...n.strokes], characters: n.characters })
  if (n.layoutMode !== undefined) c.layoutMode = n.layoutMode
  for (const k of n.getPluginDataKeys()) c.setPluginData(k, n.getPluginData(k))
  for (const k of n.children || []) c.appendChild(clone(env, k))
  return c
}

// ---------------------------------------------------------------- untouched diagrams

const FAMILIES = [
  '1-ex-erd', '2-ex-flowchart', '3-ex-sequence', '4-ex-sitemap', '7-case-nested-subgraphs', '8-case-sequence-full', '9-case-class',
  '10-case-state', '35-case-class-extras', '36-case-state-extras', '37-case-treemap', '38-case-railroad', '39-case-railroad-ebnf',
  '40-case-eventmodeling-cart', '41-case-gantt', '42-case-state-order',
]

// Dark payloads differ only in colors: a few families are enough, the rest runs light only (each insert takes a while on the mock).
const DARK_TOO = new Set(['1-ex-erd', '2-ex-flowchart', '3-ex-sequence', '9-case-class', '10-case-state'])

for (const example of FAMILIES) {
  for (const theme of DARK_TOO.has(example) ? ['light', 'dark'] : ['light']) {
    if (!fs.existsSync(fixturePath(example, theme))) continue // a few fixtures exist in one theme only
    test(`untouched ${example} (${theme}) reports no changes`, async () => {
      const { s, root } = await fresh(example, theme)
      assert.deepEqual(await inspect(s, root), CLEAN)
      // Moving the whole diagram is not an edit either.
      root.x += 300
      root.y -= 40
      assert.deepEqual(await inspect(s, root), CLEAN)
    })
  }
}

test('untouched diagrams of every surveyed Mermaid type report no changes', async () => {
  for (const type of SURVEY_TYPES) {
    const s = createSession()
    const root = await insert(s, readSurveySvg(type, 'light'))
    assert.deepEqual(await inspect(s, root), CLEAN, type)
  }
})

// ---------------------------------------------------------------- what gets written

test('stamps: every descendant has a short snap, texts have their generated characters, the root has the count', async () => {
  const { root } = await fresh('1-ex-erd')
  const all = descendants(root)
  assert.equal(root.getPluginData(COUNT_KEY), String(all.length))
  assert.equal(root.getPluginData(SNAP_KEY), '', 'the root itself is not stamped')
  for (const n of all) {
    const snap = n.getPluginData(SNAP_KEY)
    assert.match(snap, /^-?\d+,-?\d+,\d+,\d+(\|[0-9a-f@h,]*(\|[0-9a-f@h,]+)?)?$/, `${n.type} ${n.name}: ${snap}`)
    assert.ok(snap.length < 80, snap)
    if (n.type === 'TEXT') assert.equal(JSON.parse(n.getPluginData(TEXT_KEY)).t, n.characters)
    else assert.equal(n.getPluginData(TEXT_KEY), '')
  }
  // Format spot check on a layer with a fill and a stroke (the ERD table card).
  const card = descendants(root).find((n) => n.getPluginData('mermapix:kind') === 'ERD Table')
  const [box, fills, strokes] = card.getPluginData(SNAP_KEY).split('|')
  assert.equal(box, [card.x, card.y, card.width, card.height].map(Math.round).join(','))
  assert.match(fills, /^[0-9a-f]{6}$/)
  assert.match(strokes, /^[0-9a-f]{6}$/)
  // The context rides inside the text stamp.
  const title = erdCell(root, 'CUSTOMER', 'Field Name', 1).text
  assert.deepEqual(JSON.parse(title.getPluginData(TEXT_KEY)), { t: 'email', x: { kind: 'erd-attr', entity: 'CUSTOMER', row: 1, col: 'name' } })
})

test('no stamps without a source: a diagram inserted unlinked has none', async () => {
  const s = createSession()
  await s.send({ type: 'create-svg', svg: svgOf('2-ex-flowchart'), name: 'Plain', themeVariables: THEMES.light })
  const root = s.page.children[0]
  assert.equal(root.getPluginData(COUNT_KEY), '')
  assert.ok(descendants(root).every((n) => n.getPluginData(SNAP_KEY) === ''))
})

test('stamps: the tags the converters write are the ones snapshot.ts reads (drift check)', async () => {
  const { root } = await fresh('2-ex-flowchart')
  const all = descendants(root)
  assert.ok(all.some((n) => n.getPluginData('mermapix:node') !== ''), 'node tag')
  assert.ok(all.some((n) => n.getPluginData('mermapix:cluster') !== ''), 'cluster tag')
  const e = await fresh('1-ex-erd')
  assert.ok(descendants(e.root).some((n) => n.getPluginData('mermapix:kind') === 'ERD Table'), 'ERD kind tag')
})

// ---------------------------------------------------------------- text edits and their context

test('ERD: a column that shares its name with a column in another table is reported with entity, row and column', async () => {
  const { s, root } = await fresh('1-ex-erd')
  // CUSTOMER, ORDER, PRODUCT, CATEGORY and PAYMENT all have `id` in row 0; only PRODUCT's is edited.
  const ids = ['CUSTOMER', 'ORDER', 'PRODUCT', 'CATEGORY', 'PAYMENT'].map((e) => erdCell(root, e, 'Field Name', 0).text)
  assert.ok(ids.every((t) => t.characters === 'id'))
  erdCell(root, 'PRODUCT', 'Field Name', 0).text.characters = 'product_id'

  const changes = await inspect(s, root)
  assert.deepEqual(changes.texts, [{ from: 'id', to: 'product_id', context: { kind: 'erd-attr', entity: 'PRODUCT', row: 0, col: 'name' } }])
  assert.deepEqual({ ...changes, texts: [] }, CLEAN)
})

test('ERD: type, key and comment cells carry their row and column; a key cell without part', async () => {
  const { s, root } = await fresh('1-ex-erd')
  erdCell(root, 'ORDER_ITEM', 'Type', 2).text.characters = 'bigint'
  erdCell(root, 'ORDER_ITEM', 'Key', 1).text.characters = 'PK'
  erdCell(root, 'ORDER_ITEM', 'Comment', 3).text.characters = 'price when paid'
  const { texts } = await inspect(s, root)
  const byCol = Object.fromEntries(texts.map((t) => [t.context.col, t]))
  assert.deepEqual(byCol.type, { from: 'int', to: 'bigint', context: { kind: 'erd-attr', entity: 'ORDER_ITEM', row: 2, col: 'type' } })
  assert.deepEqual(byCol.key, { from: 'PK,FK', to: 'PK', context: { kind: 'erd-attr', entity: 'ORDER_ITEM', row: 1, col: 'key' } })
  assert.deepEqual(byCol.comment, { from: 'price at checkout', to: 'price when paid', context: { kind: 'erd-attr', entity: 'ORDER_ITEM', row: 3, col: 'comment' } })
  assert.equal(texts.length, 3)
})

test('ERD: the table title is reported as erd-entity with the title as generated', async () => {
  const { s, root } = await fresh('1-ex-erd')
  const title = textNamed(root, 'CUSTOMER')
  title.characters = 'CLIENT'
  const { texts } = await inspect(s, root)
  assert.deepEqual(texts, [{ from: 'CUSTOMER', to: 'CLIENT', context: { kind: 'erd-entity', entity: 'CUSTOMER' } }])
  // The attribute rows still name the original entity: that is what the source says.
  erdCell(root, 'CUSTOMER', 'Field Name', 0).text.characters = 'uid'
  const after = (await inspect(s, root)).texts.find((t) => t.to === 'uid')
  assert.equal(after.context.entity, 'CUSTOMER')
})

test('ERD: an edited relationship label has no context', async () => {
  const { s, root } = await fresh('1-ex-erd')
  textNamed(root, 'places').characters = 'buys'
  const { texts } = await inspect(s, root)
  assert.deepEqual(texts, [{ from: 'places', to: 'buys' }])
  assert.ok(!('context' in texts[0]))
})

test('flowchart: a node label gets the node id, a subgraph title the cluster id', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  textNamed(root, 'Copy to Figma').characters = 'Copy to the canvas'
  textNamed(root, 'Export').characters = 'Outputs'
  const { texts } = await inspect(s, root)
  assert.equal(texts.length, 2)
  assert.deepEqual(texts.find((t) => t.from === 'Copy to Figma'), { from: 'Copy to Figma', to: 'Copy to the canvas', context: { kind: 'node', id: 'copy' } })
  assert.deepEqual(texts.find((t) => t.from === 'Export'), { from: 'Export', to: 'Outputs', context: { kind: 'cluster', id: 'EXPORT' } })
})

test('flowchart: an edge label has no context', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  textNamed(root, 'yes').characters = 'sure'
  const { texts } = await inspect(s, root)
  assert.deepEqual(texts, [{ from: 'yes', to: 'sure' }])
})

test('sequence: a message text and a participant name have no context', async () => {
  const { s, root } = await fresh('3-ex-sequence')
  textNamed(root, 'POST /orders').characters = 'POST /v2/orders'
  textNamed(root, 'Storefront').characters = 'Shop'
  const { texts } = await inspect(s, root)
  assert.equal(texts.length, 2)
  for (const t of texts) assert.ok(!('context' in t), JSON.stringify(t))
})

test('class: member texts of a class box have no context (many texts under one id)', async () => {
  const { s, root } = await fresh('9-case-class')
  textNamed(root, '+double radius').characters = '+float radius'
  const { texts } = await inspect(s, root)
  assert.deepEqual(texts, [{ from: '+double radius', to: '+float radius' }])
})

test('a deleted text layer is `removed`, not an edited text', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  textNamed(root, 'no').remove()
  assert.deepEqual(await inspect(s, root), { ...CLEAN, removed: 1 })
})

// ---------------------------------------------------------------- geometry that follows a text edit

test('ERD: growth that follows a text edit (cell, column, card, shifted siblings) does not count as moved', async () => {
  const { s, root } = await fresh('1-ex-erd')
  const { card, content, column, cell, text } = erdCell(root, 'PRODUCT', 'Field Name', 3)
  text.characters = 'product_name_with_a_much_longer_label'
  text.width += 120
  text.height += 6
  // Auto Layout hugs the text: every ancestor grows and pushes what follows it.
  cell.width += 120
  cell.height += 6
  column.width += 120
  const rowIndex = column.children.indexOf(cell)
  for (const below of column.children.slice(rowIndex + 1)) below.y += 6
  const col = content.children.indexOf(column)
  for (const right of content.children.slice(col + 1)) right.x += 120
  content.width += 120
  card.width += 120
  card.height += 6

  const changes = await inspect(s, root)
  assert.equal(changes.texts.length, 1)
  assert.deepEqual({ ...changes, texts: [] }, CLEAN, 'no moved, no restyled, nothing else')
})

test('flowchart: editing a label inside a centered Auto Layout node frame does not count as moved', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const label = textNamed(root, 'Valid syntax?')
  const node = label.parent
  assert.equal(node.layoutMode, 'HORIZONTAL', 'precondition: the node frame is Auto Layout')
  label.characters = 'Is the syntax valid at all?'
  label.x -= 20
  label.width += 40
  node.width += 40
  const changes = await inspect(s, root)
  assert.equal(changes.texts.length, 1)
  assert.deepEqual({ ...changes, texts: [] }, CLEAN)
})

test('geometry that does NOT follow the text edit still counts (the exclusion is narrow)', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  textNamed(root, 'Valid syntax?').characters = 'Valid?'
  const other = descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:node') === 'preview')
  other.x += 30
  const changes = await inspect(s, root)
  assert.equal(changes.texts.length, 1)
  assert.equal(changes.moved, 1)
})

// ---------------------------------------------------------------- structure and style edits

test('moving one frame counts once', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const node = descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:node') === 'svg')
  node.x += 25
  node.y -= 10
  assert.deepEqual(await inspect(s, root), { ...CLEAN, moved: 1 })
})

test('moving a group counts once, not once per descendant', async () => {
  const { s, root } = await fresh('3-ex-sequence')
  const group = descendants(root).find((n) => n.type === 'GROUP' && n.name.startsWith('Message 2:'))
  const inside = descendants(group).length
  assert.ok(inside >= 2, 'precondition: the group has several descendants')
  group.x += 60
  group.y += 15
  assert.ok(descendants(group).every((c) => c.x !== undefined))
  assert.deepEqual(await inspect(s, root), { ...CLEAN, moved: 1 })
})

test('moving a child inside a group counts that child only (the group re-fits around it, siblings did not move)', async () => {
  const { s, root } = await fresh('3-ex-sequence')
  const group = descendants(root).find((n) => n.type === 'GROUP' && n.name.startsWith('Message 2:'))
  assert.ok(group.children.length >= 2, 'precondition: the group has siblings of the moved child')
  const text = group.children.find((c) => c.type === 'TEXT')
  text.x -= 9
  // Real Figma re-fits the group to its children: its origin moves and its size grows, the other children stay.
  group.setBoundsRaw(group.x - 9, group.y, group.width + 9, group.height)
  assert.deepEqual(await inspect(s, root), { ...CLEAN, moved: 1 })
})

test('resizing a frame counts once', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const node = descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:node') === 'png')
  node.width += 14
  assert.deepEqual(await inspect(s, root), { ...CLEAN, moved: 1 })
})

test('recoloring a fill and recoloring a stroke are each one restyled layer', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const frames = descendants(root).filter((n) => n.type === 'FRAME' && n.getPluginData('mermapix:node') !== '')
  const filled = frames.find((n) => n.fills.some((p) => p.type === 'SOLID'))
  const stroked = frames.find((n) => n !== filled && n.strokes.some((p) => p.type === 'SOLID'))
  assert.ok(filled && stroked)
  filled.fills = [solid(1, 0, 0)]
  assert.deepEqual(await inspect(s, root), { ...CLEAN, restyled: 1 })
  stroked.strokes = [solid(0, 0.5, 1)]
  assert.deepEqual(await inspect(s, root), { ...CLEAN, restyled: 2 })
})

test('deleting a layer counts as removed', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const vector = descendants(root).find((n) => n.type === 'VECTOR')
  vector.remove()
  assert.deepEqual(await inspect(s, root), { ...CLEAN, removed: 1 })
  // A deleted frame takes its subtree with it.
  const node = descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:node') === 'fix')
  const size = 1 + descendants(node).length
  node.remove()
  assert.deepEqual(await inspect(s, root), { ...CLEAN, removed: 1 + size })
})

test('an unstamped subtree counts once, wherever it was added', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const extra = new MockNode(s.env, 'FRAME', { name: 'Sticky', x: 5, y: 5, width: 50, height: 50 })
  extra.appendChild(new MockNode(s.env, 'TEXT', { characters: 'note' }))
  const inner = new MockNode(s.env, 'FRAME', { name: 'Inner' })
  inner.appendChild(new MockNode(s.env, 'TEXT', { characters: 'deep' }))
  extra.appendChild(inner)
  root.appendChild(extra)
  const lone = new MockNode(s.env, 'VECTOR', { name: 'Line' })
  const cluster = descendants(root).find((n) => n.getPluginData('mermapix:cluster') !== '')
  cluster.appendChild(lone)
  assert.deepEqual(await inspect(s, root), { ...CLEAN, added: 2 })
})

test('duplicating a stamped layer counts as added (more stamped layers than the stamped count)', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const node = descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:node') === 'copy')
  const kids = 1 + descendants(node).length
  node.parent.appendChild(clone(s.env, node))
  // The copy sits exactly on the original, so it is not "moved" either.
  assert.deepEqual(await inspect(s, root), { ...CLEAN, added: kids })
})

test('a renamed layer is explained by nothing else: other', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  descendants(root).find((n) => n.type === 'FRAME').name = 'Renamed by hand'
  assert.deepEqual(await inspect(s, root), { ...CLEAN, other: true })
})

test('reordering layers is explained by nothing else: other', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  root.appendChild(root.children[0])
  assert.deepEqual(await inspect(s, root), { ...CLEAN, other: true })
})

test('texts, moves and deletions are reported together and `other` stays false', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  textNamed(root, 'Live preview').characters = 'Preview'
  descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:node') === 'png').x += 8
  descendants(root).find((n) => n.type === 'VECTOR').remove()
  const changes = await inspect(s, root)
  assert.equal(changes.texts.length, 1)
  assert.equal(changes.moved, 1)
  assert.equal(changes.removed, 1)
  assert.equal(changes.other, false)
})

// ---------------------------------------------------------------- diagrams from the Phase 11 build

test('a diagram without mermapix:count is clean while its fingerprint matches and `other` once it differs', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  root.setPluginData(COUNT_KEY, '')
  assert.deepEqual(await inspect(s, root), CLEAN)

  textNamed(root, 'Live preview').characters = 'Preview'
  assert.deepEqual(await inspect(s, root), { ...CLEAN, other: true }, 'no per-layer stamps are trusted without the count')

  // Nothing stored at all (an even older build) counts as not modified, like in Phase 11.
  root.setPluginData(FINGERPRINT_KEY, '')
  assert.deepEqual(await inspect(s, root), CLEAN)
})

test('an unreadable count is treated like a missing one', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  root.setPluginData(COUNT_KEY, 'lots')
  textNamed(root, 'Live preview').characters = 'Preview'
  assert.deepEqual(await inspect(s, root), { ...CLEAN, other: true })
})

// ---------------------------------------------------------------- copies

test('a duplicated diagram keeps working: edits on the copy are reported on the copy only', async () => {
  const { s, root } = await fresh('1-ex-erd')
  const copy = clone(s.env, root)
  s.page.appendChild(copy)
  assert.deepEqual(await inspect(s, copy), CLEAN)

  erdCell(copy, 'PRODUCT', 'Field Name', 0).text.characters = 'sku_id'
  assert.deepEqual((await inspect(s, copy)).texts, [{ from: 'id', to: 'sku_id', context: { kind: 'erd-attr', entity: 'PRODUCT', row: 0, col: 'name' } }])
  assert.deepEqual(await inspect(s, root), CLEAN, 'the original is untouched')
})

// ---------------------------------------------------------------- inspect-diagram answers

test('inspect-diagram answers null for an unknown id, a removed root and a node without a source', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const ask = async (id) => (await s.send({ type: 'inspect-diagram', id }))[0]
  assert.deepEqual(await ask('9999:1'), { type: 'diagram-changes', id: '9999:1', changes: null })
  const plain = new MockNode(s.env, 'FRAME', { name: 'plain' })
  s.page.appendChild(plain)
  assert.deepEqual(await ask(plain.id), { type: 'diagram-changes', id: plain.id, changes: null })
  const id = root.id
  root.remove()
  assert.deepEqual(await ask(id), { type: 'diagram-changes', id, changes: null })
})

test('inspect-diagram does not change anything on the canvas', async () => {
  const { s, root } = await fresh('1-ex-erd')
  textNamed(root, 'places').characters = 'buys'
  const before = JSON.stringify(descendants(root).map((n) => [n.id, n.x, n.y, n.width, n.height, n.characters, n.pluginData]))
  await inspect(s, root)
  assert.equal(JSON.stringify(descendants(root).map((n) => [n.id, n.x, n.y, n.width, n.height, n.characters, n.pluginData])), before)
})

// ---------------------------------------------------------------- update

const upd = (s, root, svg, extra = {}) => s.send({ type: 'update-svg', targetId: root.id, svg, source: SRC + '\n  B --> C', theme: 'light', themeVariables: THEMES.light, ...extra })

test('update-needs-confirm carries the same changes inspect-diagram reports', async () => {
  const { s, root } = await fresh('1-ex-erd')
  erdCell(root, 'PRODUCT', 'Field Name', 0).text.characters = 'product_id'
  descendants(root).find((n) => n.getPluginData('mermapix:kind') === 'ERD Table' && n.name === 'PAYMENT').x += 40
  const reported = await inspect(s, root)
  assert.equal(reported.texts.length, 1)
  assert.equal(reported.moved, 1)

  const out = await upd(s, root, svgOf('1-ex-erd'))
  const asked = out.filter((m) => m.type === 'update-needs-confirm')
  assert.equal(asked.length, 1, JSON.stringify(out))
  assert.equal(asked[0].id, root.id)
  assert.deepEqual(asked[0].changes, reported)
})

test('a stroke-only recolor asks before updating, although the root fingerprint does not hash strokes', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const stroked = descendants(root).find((n) => n.type === 'FRAME' && (n.strokes || []).some((p) => p.type === 'SOLID'))
  assert.ok(stroked)
  stroked.strokes = [{ type: 'SOLID', color: { r: 0, g: 0.5, b: 1 } }]
  const reported = await inspect(s, root)
  assert.equal(reported.restyled, 1)
  assert.equal(reported.other, false)

  const out = await upd(s, root, svgOf('2-ex-flowchart'))
  const asked = out.filter((m) => m.type === 'update-needs-confirm')
  assert.equal(asked.length, 1, JSON.stringify(out.filter((m) => m.type !== 'selection')))
  assert.deepEqual(asked[0].changes, reported)
  assert.equal(out.filter((m) => m.type === 'updated').length, 0)
})

test('an untouched diagram updates without a question', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  const out = await upd(s, root, svgOf('2-ex-flowchart'))
  assert.equal(out.filter((m) => m.type === 'update-needs-confirm').length, 0)
  assert.equal(out.filter((m) => m.type === 'updated').length, 1)
})

test('after update-svg with force the diagram is clean again, with fresh stamps and a matching count', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  textNamed(root, 'Live preview').characters = 'Preview'
  descendants(root).find((n) => n.type === 'VECTOR').remove()
  assert.notDeepEqual(await inspect(s, root), CLEAN)

  // Regenerate as a different diagram type: new children, new size, new stamps.
  const out = await upd(s, root, svgOf('1-ex-erd'), { force: true })
  assert.equal(out.filter((m) => m.type === 'updated').length, 1, JSON.stringify(out.filter((m) => m.type !== 'selection')))
  const all = descendants(root)
  assert.equal(root.getPluginData(COUNT_KEY), String(all.length), 'count describes the NEW tree')
  assert.ok(all.every((n) => n.getPluginData(SNAP_KEY) !== ''), 'every new layer is stamped')
  assert.equal(root.getPluginData(FINGERPRINT_KEY).length, 16)
  assert.deepEqual(await inspect(s, root), CLEAN)

  // The new texts carry their context: an ERD cell of the regenerated diagram is reported with its place.
  erdCell(root, 'PRODUCT', 'Field Name', 0).text.characters = 'x'
  assert.deepEqual((await inspect(s, root)).texts[0].context, { kind: 'erd-attr', entity: 'PRODUCT', row: 0, col: 'name' })
})

test('a stale count from before the update cannot survive it', async () => {
  const { s, root } = await fresh('1-ex-erd')
  const oldCount = root.getPluginData(COUNT_KEY)
  await upd(s, root, svgOf('3-ex-sequence'))
  assert.notEqual(root.getPluginData(COUNT_KEY), oldCount)
  assert.equal(root.getPluginData(COUNT_KEY), String(descendants(root).length))
  assert.deepEqual(await inspect(s, root), CLEAN)
})

test('an update from a diagram with a missing count (Phase 11 build) writes the count', async () => {
  const { s, root } = await fresh('2-ex-flowchart')
  root.setPluginData(COUNT_KEY, '')
  const out = await upd(s, root, svgOf('2-ex-flowchart'))
  assert.equal(out.filter((m) => m.type === 'updated').length, 1)
  assert.equal(root.getPluginData(COUNT_KEY), String(descendants(root).length))
  assert.deepEqual(await inspect(s, root), CLEAN)
})
