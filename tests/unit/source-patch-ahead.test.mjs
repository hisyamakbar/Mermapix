// Phase 13.11: canvas text edits while the editor is ahead of the diagram. The canvas report is relative
// to the code the diagram was generated from (the reference); the editor may have moved on. An edit lands
// in the editor only where the reference and the editor agree on its place, else it is unresolved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTextChanges, applyCanvasEdits } from '../../src/plugin/sourcePatch.ts'
import { pendingEdits } from '../../src/plugin/changeSummary.ts'

const attr = (entity, row, col, from, to) => ({ from, to, context: { kind: 'erd-attr', entity, row, col } })
const entity = (name, to) => ({ from: name, to, context: { kind: 'erd-entity', entity: name } })
const node = (id, from, to) => ({ from, to, context: { kind: 'node', id } })

const BASE = `erDiagram
  CUSTOMER {
    uuid id PK
    string email
    string full_name
  }
  ORDER {
    uuid id PK
    string email
  }
  CUSTOMER ||--o{ ORDER : places
`

const lines = (s) => s.split('\n')

test('why the guard exists: applied by row number to an editor that is ahead, a type edit lands on another row', () => {
  // The user typed a row at the top of CUSTOMER; the diagram still has email at row 1 (string).
  const editor = BASE.replace('    uuid id PK\n    string email\n    string full_name', '    uuid id PK\n    string nickname\n    string email\n    string full_name')
  // Canvas: type of `email` (row 1) string -> text. Row 1 in the editor is now `string nickname`.
  const r = applyTextChanges(editor, [attr('CUSTOMER', 1, 'type', 'string', 'text')])
  assert.equal(r.unresolved.length, 0, 'the unguarded patcher takes the wrong row')
  assert.match(r.source, /text nickname/)
})

test('editor ahead: a row inserted above the edited one does not move the edit to another row', () => {
  const editor = BASE.replace('    string email\n    string full_name', '    string nickname\n    string email\n    string full_name')
  const r = applyCanvasEdits(BASE, editor, [attr('CUSTOMER', 1, 'type', 'string', 'text')])
  // Placed on the real `email` row, never on `nickname`.
  assert.deepEqual(r.unresolved, [])
  assert.equal(r.source, editor.replace('string email', 'text email'))
})

test('editor ahead: a row inserted at the top, the name edit of email lands on email', () => {
  const editor = BASE.replace('    uuid id PK\n    string email', '    string nickname\n    uuid id PK\n    string email')
  const r = applyCanvasEdits(BASE, editor, [attr('CUSTOMER', 1, 'name', 'email', 'mail')])
  assert.deepEqual(r.unresolved, [])
  assert.equal(r.source, editor.replace('    string email\n    string full_name', '    string mail\n    string full_name'))
  // The reference (what the canvas shows) has the same edit.
  assert.equal(r.reference, BASE.replace('    string email\n    string full_name', '    string mail\n    string full_name'))
})

test('editor ahead: an attribute deleted above the edited row', () => {
  const editor = BASE.replace('    uuid id PK\n    string email\n    string full_name', '    string email\n    string full_name')
  const r = applyCanvasEdits(BASE, editor, [attr('CUSTOMER', 1, 'type', 'string', 'text')])
  assert.deepEqual(r.unresolved, [])
  assert.match(r.source, /text email/)
  assert.doesNotMatch(r.source, /text full_name/)
})

test('editor ahead: the edited attribute itself was deleted or changed in the editor', () => {
  const deleted = BASE.replace('    string email\n    string full_name', '    string full_name')
  const r1 = applyCanvasEdits(BASE, deleted, [attr('CUSTOMER', 1, 'type', 'string', 'text')])
  assert.equal(r1.source, deleted)
  assert.equal(r1.unresolved.length, 1)
  const changed = BASE.replace('    string email\n    string full_name', '    string email_address\n    string full_name')
  const r2 = applyCanvasEdits(BASE, changed, [attr('CUSTOMER', 1, 'type', 'string', 'text')])
  assert.equal(r2.source, changed)
  assert.equal(r2.unresolved.length, 1)
})

test('editor ahead: an entity renamed in the editor: its rows are not matched, they are reported', () => {
  const editor = BASE.replace(/CUSTOMER/g, 'CLIENT')
  const r = applyCanvasEdits(BASE, editor, [attr('CUSTOMER', 1, 'name', 'email', 'mail')])
  assert.equal(r.source, editor)
  assert.equal(r.unresolved.length, 1)
})

test('editor ahead: rows of another table that the editor merged into the edited one are not matched', () => {
  // The editor removed the ORDER header: its rows now belong to CUSTOMER.
  const editor = BASE.replace('  }\n  ORDER {\n', '')
  const r = applyCanvasEdits(BASE, editor, [attr('ORDER', 1, 'name', 'email', 'mail')])
  assert.equal(r.source, editor)
  assert.equal(r.unresolved.length, 1)
})

test('editor ahead: a row duplicated next to the edited one is ambiguous, not guessed', () => {
  const editor = BASE.replace('    string email\n    string full_name', '    string email\n    string email\n    string full_name')
  const r = applyCanvasEdits(BASE, editor, [attr('CUSTOMER', 1, 'name', 'email', 'mail')])
  assert.equal(r.source, editor)
  assert.equal(r.unresolved.length, 1)
})

test('editor ahead: an entity rename on the canvas is unresolved when the editor changed the references', () => {
  const editor = BASE.replace('  CUSTOMER ||--o{ ORDER : places\n', '  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER ||--o{ INVOICE : owns\n')
  const r = applyCanvasEdits(BASE, editor, [entity('CUSTOMER', 'CLIENT')])
  assert.equal(r.source, editor)
  assert.equal(r.unresolved.length, 1)
})

test('editor ahead: an entity rename on the canvas is applied when the references did not change', () => {
  const editor = BASE.replace('    string full_name\n', '    string full_name\n    string phone\n')
  const r = applyCanvasEdits(BASE, editor, [entity('CUSTOMER', 'CLIENT')])
  assert.deepEqual(r.unresolved, [])
  assert.equal(r.source, editor.replace(/CUSTOMER/g, 'CLIENT'))
})

test('editor in sync: same result as applyTextChanges', () => {
  const changes = [attr('CUSTOMER', 1, 'name', 'email', 'mail'), entity('ORDER', 'PURCHASE')]
  const a = applyTextChanges(BASE, changes)
  const b = applyCanvasEdits(BASE, BASE, changes)
  assert.equal(b.source, a.source)
  assert.equal(b.reference, a.source)
  assert.deepEqual(b.applied, a.applied)
  assert.deepEqual(b.unresolved, a.unresolved)
})

test('editor ahead: two changes, one lands and one is reported, none is dropped', () => {
  const editor = BASE.replace('    string email\n    string full_name', '    string email\n    string full_name!')
  // full_name was changed in the editor (bang), email was not.
  const r = applyCanvasEdits(BASE, editor, [attr('CUSTOMER', 1, 'name', 'email', 'mail'), attr('CUSTOMER', 2, 'name', 'full_name', 'name')])
  assert.equal(r.applied.length, 1)
  assert.equal(r.unresolved.length, 1)
  assert.match(r.source, /string mail/)
})

const FLOW = `flowchart TD
  A[Login] --> B[Home]
  B --> C[Settings]
`

test('editor ahead: flowchart node label by id; editor added another node with the same label', () => {
  const editor = FLOW + '  D[Login]\n'
  const r = applyCanvasEdits(FLOW, editor, [node('A', 'Login', 'Sign in')])
  assert.deepEqual(r.unresolved, [])
  assert.match(r.source, /A\[Sign in\]/)
  assert.match(r.source, /D\[Login\]/)
})

test('editor ahead: a node label edit without context is unresolved when the editor repeated the label', () => {
  const editor = FLOW + '  B --> E[Home]\n'
  const r = applyCanvasEdits(FLOW, editor, [{ from: 'Home', to: 'Start' }])
  assert.equal(r.source, editor)
  assert.equal(r.unresolved.length, 1)
})

test('editor ahead: a node id reused by the editor for another node is not patched blindly', () => {
  // The editor renamed id A to X and defined a new A elsewhere. The canvas node A (label Login) is now X.
  const editor = `flowchart TD
  X[Login] --> B[Home]
  B --> C[Settings]
  B --> A[Other]
`
  const r = applyCanvasEdits(FLOW, editor, [node('A', 'Login', 'Sign in')])
  assert.equal(r.source, editor)
  assert.equal(r.unresolved.length, 1)
})

test('pendingEdits + applyCanvasEdits as the plugin composes them: edit, re-edit, editor ahead', () => {
  const editor = BASE.replace('    uuid id PK\n    string email', '    string nickname\n    uuid id PK\n    string email')
  const changes = { texts: [attr('CUSTOMER', 1, 'name', 'email', 'mail')], moved: 0, restyled: 0, added: 0, removed: 0 }
  const pend = pendingEdits(changes, [])
  const r = applyCanvasEdits(BASE, editor, pend.map((p) => p.patch))
  assert.deepEqual(r.unresolved, [])
  assert.match(r.source, /string nickname\n {4}uuid id PK\n {4}string mail/)
  // Second edit of the same layer is restated from the applied text and resolved against the new reference.
  const handled = r.applied.length ? pend.map((p) => p.layer) : []
  const again = { ...changes, texts: [attr('CUSTOMER', 1, 'name', 'email', 'email2')] }
  const pend2 = pendingEdits(again, handled)
  const r2 = applyCanvasEdits(r.reference, r.source, pend2.map((p) => p.patch))
  assert.deepEqual(r2.unresolved, [])
  assert.match(r2.source, /string email2/)
  assert.equal(lines(r2.reference).length, lines(BASE).length)
})
