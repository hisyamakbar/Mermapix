// Phase 12 round trip: an edit made on the (mock) Figma canvas -> the sandbox's change report
// (plugin/code.js, `inspect-diagram`) -> written back into the real example source by the UI's patcher
// (src/plugin/sourcePatch.ts). The two halves have their own suites (plugin-snapshot, source-patch); this
// one guards the seam between them: the context the sandbox records must be what the patcher understands.
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createSession } from '../plugin-mock/session.mjs'
import { fixturePath, THEMES } from '../plugin-mock/run-fixture.mjs'
import { applyTextChanges } from '../../src/plugin/sourcePatch.ts'

const example = (name) => fs.readFileSync(new URL(`../../src/examples/${name}.mmd`, import.meta.url), 'utf8')
const svgOf = (fixture) => fs.readFileSync(fixturePath(fixture, 'light'), 'utf8')

function descendants(n, out = []) {
  for (const c of n.children || []) { out.push(c); descendants(c, out) }
  return out
}

/** Inserts a payload with its real source, lets `edit(root)` change the canvas, returns the reported text changes. */
async function editedTexts(fixture, source, edit) {
  const s = createSession()
  const out = await s.send({ type: 'create-svg', svg: svgOf(fixture), name: 'D', theme: 'light', themeVariables: THEMES.light, source })
  assert.deepEqual(out.filter((m) => m.type === 'inserted'), [{ type: 'inserted', linked: true }])
  const root = s.page.children[s.page.children.length - 1]
  edit(root)
  const answer = await s.send({ type: 'inspect-diagram', id: root.id })
  assert.equal(answer[0].type, 'diagram-changes')
  return answer[0].changes.texts
}

/** The text layer of an ERD cell, found by structure (table name, column frame, row index). */
function erdCellText(root, entity, column, row) {
  const card = descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:kind') === 'ERD Table' && n.name === entity)
  assert.ok(card, `ERD table ${entity}`)
  const col = card.children.find((c) => c.name === 'Content').children.find((c) => c.name === `Column: ${column}`)
  assert.ok(col, `column ${column} of ${entity}`)
  const text = col.children[row].children.find((c) => c.type === 'TEXT')
  assert.ok(text, `text in ${entity} / ${column} / row ${row}`)
  return text
}

const textWith = (root, characters) => {
  const t = descendants(root).find((n) => n.type === 'TEXT' && n.characters === characters)
  assert.ok(t, `text layer "${characters}"`)
  return t
}

/** Exactly the given line replacements, nothing else. */
function assertOnlyLinesChanged(before, after, expected) {
  const a = before.split('\n')
  const b = after.split('\n')
  assert.equal(b.length, a.length, 'line count unchanged')
  const changed = []
  a.forEach((line, i) => { if (line !== b[i]) changed.push([line.trim(), b[i].trim()]) })
  assert.deepEqual(changed, expected)
}

const ERD = example('erd')
const FLOW = example('flowchart')

test('ERD: a column renamed in one table reaches only that table, though every table has an `id` column', async () => {
  const texts = await editedTexts('1-ex-erd', ERD, (root) => {
    erdCellText(root, 'PRODUCT', 'Field Name', 0).characters = 'product_id'
  })
  assert.equal(texts.length, 1)
  const r = applyTextChanges(ERD, texts)
  assert.deepEqual(r.unresolved, [])
  assert.equal(r.applied.length, 1)
  assertOnlyLinesChanged(ERD, r.source, [['uuid id PK', 'uuid product_id PK']])
  // ...and it is the PRODUCT block that changed.
  assert.match(r.source, /PRODUCT \{\s*\n\s*uuid product_id PK/)
})

test('ERD: type and comment edits land on the right attribute line', async () => {
  const texts = await editedTexts('1-ex-erd', ERD, (root) => {
    erdCellText(root, 'PAYMENT', 'Type', 3).characters = 'numeric'
    erdCellText(root, 'CATEGORY', 'Comment', 1).characters = 'empty for root'
  })
  assert.equal(texts.length, 2)
  const r = applyTextChanges(ERD, texts)
  assert.deepEqual(r.unresolved, [])
  assertOnlyLinesChanged(ERD, r.source, [
    ['uuid parent_id FK "null for root"', 'uuid parent_id FK "empty for root"'],
    ['decimal amount', 'numeric amount'],
  ])
})

test('ERD: a renamed table title renames the entity in its block and in every relationship', async () => {
  const texts = await editedTexts('1-ex-erd', ERD, (root) => {
    const card = descendants(root).find((n) => n.getPluginData('mermapix:kind') === 'ERD Table' && n.name === 'PAYMENT')
    const title = descendants(card.children.find((c) => c.name.startsWith('Header:'))).find((n) => n.type === 'TEXT')
    title.characters = 'INVOICE'
  })
  assert.equal(texts.length, 1)
  const r = applyTextChanges(ERD, texts)
  assert.deepEqual(r.unresolved, [])
  assert.ok(!/\bPAYMENT\b/.test(r.source), 'no PAYMENT left')
  assert.match(r.source, /ORDER \|\|--o\| INVOICE : "paid by"/)
  assert.match(r.source, /\n\s*INVOICE \{/)
})

test('ERD: a multi-key cell is one text layer, so its edit replaces the whole key list of that row', async () => {
  // PAYMENT.order_id is `FK, UK`. The plugin renders that cell as a single text (`FK,UK`), without `part`.
  const texts = await editedTexts('1-ex-erd', ERD, (root) => {
    erdCellText(root, 'PAYMENT', 'Key', 1).characters = 'FK'
  })
  assert.equal(texts.length, 1)
  assert.equal(texts[0].context.part, undefined)
  const r = applyTextChanges(ERD, texts)
  assert.deepEqual(r.unresolved, [])
  assertOnlyLinesChanged(ERD, r.source, [['uuid order_id FK, UK', 'uuid order_id FK']])
})

test('ERD: a key cell edited into something that is not a key list stays unresolved and leaves the source alone', async () => {
  const texts = await editedTexts('1-ex-erd', ERD, (root) => {
    erdCellText(root, 'PAYMENT', 'Key', 1).characters = 'primary'
  })
  const r = applyTextChanges(ERD, texts)
  assert.equal(r.unresolved.length, 1)
  assert.equal(r.source, ERD)
})

test('flowchart: a node label and the subgraph title edited on the canvas are written to their definitions', async () => {
  const texts = await editedTexts('2-ex-flowchart', FLOW, (root) => {
    textWith(root, 'Live preview').characters = 'Preview'
    textWith(root, 'Export').characters = 'Share'
  })
  assert.equal(texts.length, 2)
  const r = applyTextChanges(FLOW, texts)
  assert.deepEqual(r.unresolved, [])
  assertOnlyLinesChanged(FLOW, r.source, [
    ['parse -->|yes| preview[["Live preview"]]', 'parse -->|yes| preview[["Preview"]]'],
    ['subgraph EXPORT["Export"]', 'subgraph EXPORT["Share"]'],
  ])
})

test('flowchart: an edge label that occurs once is applied; nothing else in the source moves', async () => {
  const texts = await editedTexts('2-ex-flowchart', FLOW, (root) => {
    textWith(root, 'yes').characters = 'ok'
  })
  assert.equal(texts.length, 1)
  const r = applyTextChanges(FLOW, texts)
  assert.deepEqual(r.unresolved, [])
  assertOnlyLinesChanged(FLOW, r.source, [['parse -->|yes| preview[["Live preview"]]', 'parse -->|ok| preview[["Live preview"]]']])
})

test('an untouched canvas reports no text changes, so nothing is offered', async () => {
  assert.deepEqual(await editedTexts('1-ex-erd', ERD, () => {}), [])
  assert.deepEqual(await editedTexts('2-ex-flowchart', FLOW, () => {}), [])
})
