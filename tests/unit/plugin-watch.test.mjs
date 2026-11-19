// Phase 12, edits made while the plugin is open. Two halves:
//  1. the sandbox (plugin/code.js) keeps reporting a watched diagram after every change on the canvas
//     (`watch-diagram`, page `nodechange`, debounced);
//  2. the UI's bookkeeping (src/plugin/changeSummary.ts: pendingEdits, settleHandled) restates each new
//     report against the code as it is after earlier "Apply to code" clicks, so the patcher
//     (src/plugin/sourcePatch.ts) still finds the right place.
// The scenario tests run both halves the way AppPlugin.tsx does: report -> pendingEdits -> applyTextChanges.
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createSession } from '../plugin-mock/session.mjs'
import { fixturePath, THEMES } from '../plugin-mock/run-fixture.mjs'
import { applyTextChanges } from '../../src/plugin/sourcePatch.ts'
import { pendingEdits, remainingChanges, isNothingLeft, settleHandled } from '../../src/plugin/changeSummary.ts'

const example = (name) => fs.readFileSync(new URL(`../../src/examples/${name}.mmd`, import.meta.url), 'utf8')
const svgOf = (fixture) => fs.readFileSync(fixturePath(fixture, 'light'), 'utf8')
const ERD = example('erd')
const FLOW = example('flowchart')

function descendants(n, out = []) {
  for (const c of n.children || []) { out.push(c); descendants(c, out) }
  return out
}

const textWith = (root, characters) => {
  const t = descendants(root).find((n) => n.type === 'TEXT' && n.characters === characters)
  assert.ok(t, `text layer "${characters}"`)
  return t
}

function erdCellText(root, entity, column, row) {
  const card = descendants(root).find((n) => n.type === 'FRAME' && n.getPluginData('mermapix:kind') === 'ERD Table' && n.name === entity)
  assert.ok(card, `ERD table ${entity}`)
  const col = card.children.find((c) => c.name === 'Content').children.find((c) => c.name === `Column: ${column}`)
  return col.children[row].children.find((c) => c.type === 'TEXT')
}

function erdTitleText(root, entity) {
  const card = descendants(root).find((n) => n.getPluginData('mermapix:kind') === 'ERD Table' && n.name === entity)
  assert.ok(card, `ERD table ${entity}`)
  return descendants(card.children.find((c) => c.name.startsWith('Header:'))).find((n) => n.type === 'TEXT')
}

async function insert(s, fixture, source) {
  const out = await s.send({ type: 'create-svg', svg: svgOf(fixture), name: 'D', theme: 'light', themeVariables: THEMES.light, source })
  assert.deepEqual(out.filter((m) => m.type === 'inserted'), [{ type: 'inserted', linked: true }])
  return s.page.children[s.page.children.length - 1]
}

/** Insert a diagram and start watching it, like entering edit mode. */
async function watched(fixture, source) {
  const s = createSession()
  const root = await insert(s, fixture, source)
  const first = await s.send({ type: 'watch-diagram', id: root.id })
  assert.equal(first.length, 1)
  assert.equal(first[0].type, 'diagram-changes')
  assert.deepEqual(first[0].changes.texts, [])
  return { s, root }
}

/** Edit a text layer on the canvas the way a user does: the change, then Figma's `nodechange`, then the debounce. */
async function typeOnCanvas(s, node, characters) {
  node.characters = characters
  s.nodeChange([node])
  const out = await s.flushTimers()
  assert.equal(out.length, 1, 'one report per settled edit')
  assert.equal(out[0].type, 'diagram-changes')
  return out[0].changes
}

/** The UI's side of an edit session, reduced to its state: code, handled, ignored. */
function uiSession(source) {
  const state = { code: source, handled: [], ignored: [] }
  return {
    state,
    pending: (report) => pendingEdits(report, state.handled, state.ignored),
    /** "Apply to code": returns the unresolved patches. */
    apply(report) {
      const pending = pendingEdits(report, state.handled, state.ignored)
      const patched = applyTextChanges(state.code, pending.map((p) => p.patch))
      const unresolved = new Set(patched.unresolved)
      state.code = patched.source
      state.handled = settleHandled(state.handled, pending.filter((p) => !unresolved.has(p.patch)).map((p) => p.layer))
      state.ignored = [...state.ignored, ...pending.filter((p) => unresolved.has(p.patch)).map((p) => p.layer)]
      return patched.unresolved
    },
  }
}

function changedLines(before, after) {
  const a = before.split('\n')
  const b = after.split('\n')
  assert.equal(b.length, a.length, 'line count unchanged')
  const changed = []
  a.forEach((line, i) => { if (line !== b[i]) changed.push([line.trim(), b[i].trim()]) })
  return changed
}

// ---------------------------------------------------------------- sandbox: watch-diagram

test('watch: a text edited on the canvas while the diagram is watched is reported without asking again', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const report = await typeOnCanvas(s, textWith(root, 'Live preview'), 'Preview')
  assert.deepEqual(report.texts.map((t) => [t.from, t.to]), [['Live preview', 'Preview']])
})

test('watch: one report after a burst of changes (typing fires an event per keystroke)', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const label = textWith(root, 'Live preview')
  for (const step of ['P', 'Pr', 'Pre', 'Prev']) {
    label.characters = step
    s.nodeChange([label])
  }
  assert.equal(s.pendingTimers(), 1)
  const out = await s.flushTimers()
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].changes.texts.map((t) => t.to), ['Prev'])
})

test('watch: a change elsewhere on the page is not reported; a deletion is checked because it cannot be placed', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const other = await insert(s, '1-ex-erd', ERD)
  s.nodeChange([textWith(other, 'PRODUCT')])
  assert.equal(s.pendingTimers(), 0)
  const victim = textWith(root, 'yes')
  victim.remove()
  s.nodeChange([victim], 'DELETE')
  const out = await s.flushTimers()
  assert.equal(out.length, 1)
  assert.equal(out[0].id, root.id)
  assert.equal(out[0].changes.removed, 1)
})

test('watch: `id: null` stops it, and watching another diagram replaces the first', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const other = await insert(s, '1-ex-erd', ERD)
  await s.send({ type: 'watch-diagram', id: other.id })
  assert.equal(s.pageListeners.length, 1)
  s.nodeChange([textWith(root, 'yes')])
  assert.equal(s.pendingTimers(), 0, 'the first diagram is no longer watched')

  const label = textWith(root, 'Live preview')
  label.characters = 'x'
  await s.send({ type: 'watch-diagram', id: root.id })
  s.nodeChange([label])
  assert.equal(s.pendingTimers(), 1)
  assert.deepEqual(await s.send({ type: 'watch-diagram', id: null }), [])
  assert.equal(s.pageListeners.length, 0)
  assert.equal(s.pendingTimers(), 0, 'a pending report is dropped with the watch')
})

test('watch: after an update in place the same diagram is still watched and reports clean', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const report = await typeOnCanvas(s, textWith(root, 'Live preview'), 'Preview')
  const ui = uiSession(FLOW)
  assert.deepEqual(ui.apply(report), [])
  const out = await s.send({ type: 'update-svg', targetId: root.id, svg: svgOf('2-ex-flowchart'), source: ui.state.code, theme: 'light', themeVariables: THEMES.light, force: true })
  assert.ok(out.some((m) => m.type === 'updated'))
  // The root node is kept, so the watch survives; the regenerated layers are the new baseline. (Canvas events
  // right after an update are the update's own and are skipped; wait that moment out.)
  await new Promise((r) => setTimeout(r, 450))
  const again = await typeOnCanvas(s, textWith(root, 'Live preview'), 'Preview 2')
  assert.deepEqual(again.texts.map((t) => [t.from, t.to]), [['Live preview', 'Preview 2']])
})

test('watch: a diagram that is gone answers null once and leaves nothing behind', async () => {
  const s = createSession()
  const out = await s.send({ type: 'watch-diagram', id: '999:999' })
  assert.deepEqual(out, [{ type: 'diagram-changes', id: '999:999', changes: null }])
  assert.equal(s.pageListeners.length, 0)
})

// ---------------------------------------------------------------- scenarios: canvas -> report -> code, repeatedly

test('apply, then edit another label on the canvas: only the new edit is offered and both end up in the code', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const ui = uiSession(FLOW)

  const first = await typeOnCanvas(s, textWith(root, 'Live preview'), 'Preview')
  assert.equal(ui.pending(first).length, 1)
  assert.deepEqual(ui.apply(first), [])
  assert.deepEqual(ui.pending(first), [], 'nothing is offered again after applying')

  // The plugin stays open; another label is edited in Figma.
  const second = await typeOnCanvas(s, textWith(root, 'Export'), 'Share')
  assert.equal(second.texts.length, 2, 'the sandbox reports the full state, not a delta')
  const offer = ui.pending(second)
  assert.deepEqual(offer.map((p) => [p.patch.from, p.patch.to]), [['Export', 'Share']])
  assert.deepEqual(ui.apply(second), [])
  assert.deepEqual(changedLines(FLOW, ui.state.code), [
    ['parse -->|yes| preview[["Live preview"]]', 'parse -->|yes| preview[["Preview"]]'],
    ['subgraph EXPORT["Export"]', 'subgraph EXPORT["Share"]'],
  ])
  // Update then has nothing left to ask about.
  assert.ok(isNothingLeft(remainingChanges(second, ui.state.handled)))
})

test('apply, then edit the SAME label again: the second edit starts from the applied text', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const ui = uiSession(FLOW)
  const label = textWith(root, 'Live preview')
  assert.deepEqual(ui.apply(await typeOnCanvas(s, label, 'Preview')), [])

  const second = await typeOnCanvas(s, label, 'Quick look')
  // The sandbox still compares with what was generated...
  assert.deepEqual(second.texts.map((t) => [t.from, t.to]), [['Live preview', 'Quick look']])
  // ...the offer is against the code as it is now.
  assert.deepEqual(ui.pending(second).map((p) => [p.patch.from, p.patch.to]), [['Preview', 'Quick look']])
  assert.deepEqual(ui.apply(second), [])
  assert.deepEqual(changedLines(FLOW, ui.state.code), [
    ['parse -->|yes| preview[["Live preview"]]', 'parse -->|yes| preview[["Quick look"]]'],
  ])
  assert.equal(ui.state.handled.length, 1)
  assert.ok(isNothingLeft(remainingChanges(second, ui.state.handled)))
})

test('apply, then type the original text back: the reverse edit is offered and the code returns to the source', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const ui = uiSession(FLOW)
  const label = textWith(root, 'Live preview')
  assert.deepEqual(ui.apply(await typeOnCanvas(s, label, 'Preview')), [])
  assert.notEqual(ui.state.code, FLOW)

  const back = await typeOnCanvas(s, label, 'Live preview')
  assert.deepEqual(back.texts, [])
  assert.deepEqual(ui.pending(back).map((p) => [p.patch.from, p.patch.to]), [['Preview', 'Live preview']])
  assert.deepEqual(ui.apply(back), [])
  assert.equal(ui.state.code, FLOW)
  assert.deepEqual(ui.state.handled, [])
  assert.deepEqual(ui.pending(back), [])
})

test('ERD: a table renamed and applied, then a column edited in that table: the column is found under the new name', async () => {
  const { s, root } = await watched('1-ex-erd', ERD)
  const ui = uiSession(ERD)
  assert.deepEqual(ui.apply(await typeOnCanvas(s, erdTitleText(root, 'PAYMENT'), 'INVOICE')), [])
  assert.match(ui.state.code, /\n\s*INVOICE \{/)

  // The stamped context of the cell still names the table as generated (PAYMENT).
  const second = await typeOnCanvas(s, erdCellText(root, 'PAYMENT', 'Type', 3), 'numeric')
  const offer = ui.pending(second)
  assert.equal(offer.length, 1)
  assert.equal(offer[0].layer.context.entity, 'PAYMENT')
  assert.equal(offer[0].patch.context.entity, 'INVOICE')
  const afterRename = ui.state.code
  assert.deepEqual(ui.apply(second), [])
  assert.deepEqual(changedLines(afterRename, ui.state.code), [['decimal amount', 'numeric amount']])

  // Renaming the table once more starts from the applied name, in the block and in the relationship.
  const third = await typeOnCanvas(s, erdTitleText(root, 'PAYMENT'), 'BILL')
  assert.deepEqual(ui.pending(third).map((p) => [p.patch.from, p.patch.to, p.patch.context.entity]), [['INVOICE', 'BILL', 'INVOICE']])
  assert.deepEqual(ui.apply(third), [])
  assert.ok(!/\b(PAYMENT|INVOICE)\b/.test(ui.state.code))
  assert.match(ui.state.code, /ORDER \|\|--o\| BILL : "paid by"/)
  assert.ok(isNothingLeft(remainingChanges(third, ui.state.handled)))
})

test('an edit that cannot be placed is shown once, then not offered again on every later change', async () => {
  const { s, root } = await watched('1-ex-erd', ERD)
  const ui = uiSession(ERD)
  const first = await typeOnCanvas(s, erdCellText(root, 'PAYMENT', 'Key', 1), 'primary')
  assert.equal(ui.apply(first).length, 1)
  assert.equal(ui.state.code, ERD)

  const second = await typeOnCanvas(s, erdCellText(root, 'PRODUCT', 'Field Name', 0), 'product_id')
  assert.deepEqual(ui.pending(second).map((p) => p.patch.to), ['product_id'])
  // It still counts when updating: that edit is not in the code.
  assert.equal(remainingChanges(second, ui.state.handled).texts.length, 2)
})

// ---------------------------------------------------------------- pendingEdits: the rules, without a canvas

const report = (texts, extra = {}) => ({ texts, moved: 0, restyled: 0, added: 0, removed: 0, other: false, ...extra })

test('pendingEdits: two layers with the same generated text and no context are never restated', () => {
  // `participant A as Alice`: the name is drawn at the top and at the bottom, once in the code.
  const handled = [{ from: 'Alice', to: 'Alicia' }]
  // Both layers follow the code: nothing to offer.
  assert.deepEqual(pendingEdits(report([{ from: 'Alice', to: 'Alicia' }, { from: 'Alice', to: 'Alicia' }]), handled), [])
  // The second layer says something else: which one was edited again is unknown, so the edit keeps its
  // generated `from`, which the code no longer contains: the patcher reports it instead of guessing.
  const p = pendingEdits(report([{ from: 'Alice', to: 'Alicia' }, { from: 'Alice', to: 'Ali' }]), handled)
  assert.deepEqual(p.map((e) => e.patch), [{ from: 'Alice', to: 'Ali' }])
  const r = applyTextChanges('sequenceDiagram\n  participant A as Alicia\n  A->>B: hi', p.map((e) => e.patch))
  assert.equal(r.unresolved.length, 1)
})

test('pendingEdits: no reverse edit is invented when layers were deleted', () => {
  const handled = [{ from: 'Live preview', to: 'Preview', context: { kind: 'node', id: 'preview' } }]
  assert.equal(pendingEdits(report([]), handled).length, 1)
  assert.deepEqual(pendingEdits(report([], { removed: 1 }), handled), [])
})

test('pendingEdits: ignored edits stay away until the layer is edited again', () => {
  const edit = { from: 'yes', to: 'ok' }
  assert.deepEqual(pendingEdits(report([edit]), [], [edit]), [])
  assert.equal(pendingEdits(report([{ from: 'yes', to: 'okay' }]), [], [edit]).length, 1)
})

test('settleHandled: one entry per layer, a reverted layer leaves the list', () => {
  const ctx = { kind: 'node', id: 'a' }
  let handled = settleHandled([], [{ from: 'A', to: 'B', context: ctx }])
  handled = settleHandled(handled, [{ from: 'A', to: 'C', context: ctx }])
  assert.deepEqual(handled, [{ from: 'A', to: 'C', context: ctx }])
  assert.deepEqual(settleHandled(handled, [{ from: 'A', to: 'A', context: ctx }]), [])
})

// ---------------------------------------------------------------- sandbox: live (quiet) updates, Phase 13

async function liveUpdate(s, root, source, extra = {}) {
  return s.send({ type: 'update-svg', targetId: root.id, svg: svgOf('2-ex-flowchart'), source, theme: 'light', themeVariables: THEMES.light, quiet: true, ...extra })
}

test('quiet update: no toast, the selection stays where the user left it, the duration is reported', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const elsewhere = await insert(s, '1-ex-erd', ERD)
  s.select([elsewhere])
  const toastsBefore = s.notifications().length
  const out = await liveUpdate(s, root, FLOW.replace('Live preview', 'Preview'))
  const done = out.filter((m) => m.type === 'updated')
  assert.equal(done.length, 1, JSON.stringify(out))
  assert.equal(typeof done[0].ms, 'number')
  assert.ok(done[0].ms >= 0)
  assert.equal(s.notifications().length, toastsBefore, 'no "diagram updated" toast while typing')
  assert.deepEqual(s.page.selection, [elsewhere])
  assert.match(root.getPluginData('mermapix:diagram'), /Preview/)
})

test('quiet update: still asks before replacing a diagram edited in Figma, and a failure has no toast', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const node = descendants(root).find((n) => n.type !== 'TEXT' && n.width > 20)
  node.x += 40
  const out = await liveUpdate(s, root, FLOW)
  assert.deepEqual(out.map((m) => m.type), ['update-needs-confirm'])
  assert.ok(out[0].changes.moved >= 1)

  const toastsBefore = s.notifications().length
  const failed = await liveUpdate(s, root, FLOW, { svg: 'MOCK_IMPORT_FAILURE <svg/>', force: true })
  assert.deepEqual(failed.map((m) => m.type), ['update-failed'])
  assert.equal(s.notifications().length, toastsBefore)
})

test('every update ends with one undo step (figma.commitUndo), so Cmd+Z takes back one update', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const commits = () => s.log.filter((l) => l[0] === 'commitUndo').length
  const before = commits()
  await liveUpdate(s, root, FLOW.replace('Live preview', 'A'))
  await liveUpdate(s, root, FLOW.replace('Live preview', 'B'))
  assert.equal(commits(), before + 2)
})

test('an edit made on the canvas while the update was loading fonts is caught, not overwritten', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const label = textWith(root, 'Export')
  const load = s.figma.loadFontAsync
  let once = false
  s.figma.loadFontAsync = async (f) => {
    if (!once) { once = true; label.characters = 'Typed meanwhile' }
    return load(f)
  }
  const out = await liveUpdate(s, root, FLOW.replace('Live preview', 'Preview'))
  s.figma.loadFontAsync = load
  assert.deepEqual(out.map((m) => m.type), ['update-needs-confirm'])
  assert.deepEqual(out[0].changes.texts.map((t) => t.to), ['Typed meanwhile'])
  assert.equal(label.removed, false)
})

test('the update\'s own canvas changes are not reported again; a later edit is', async () => {
  const { s, root } = await watched('2-ex-flowchart', FLOW)
  const out = await liveUpdate(s, root, FLOW.replace('Live preview', 'Preview'))
  assert.ok(out.some((m) => m.type === 'updated'))
  // Figma fires nodechange for the layers the update just replaced: no extra walk of the diagram.
  s.nodeChange(root.children.slice(0, 3))
  assert.equal(s.pendingTimers(), 0)
  // Once that moment has passed (the sandbox clock is real), an edit by the user is reported as usual.
  await new Promise((r) => setTimeout(r, 450))
  const report = await typeOnCanvas(s, textWith(root, 'Export'), 'Share')
  assert.deepEqual(report.texts.map((t) => t.to), ['Share'])
})
