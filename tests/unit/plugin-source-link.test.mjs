// Phase 11: source-linked diagrams. Pure helpers (plugin/src/sourceLink.ts, update.ts) are imported directly;
// the end-to-end tests drive the bundled sandbox (plugin/code.js, rebuild with `pnpm build:plugin`) on a mock Figma.
// Set MERMAPIX_CODE=<other bundle> to run the end-to-end part against another build.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { MockNode, serialize } from '../plugin-mock/figma-mock.mjs'
import { createSession, IMPORT_FAILURE, OPTIMIZE_FAILURE } from '../plugin-mock/session.mjs'
import { fixturePath, THEMES } from '../plugin-mock/run-fixture.mjs'
import {
  DIAGRAM_KEY,
  FINGERPRINT_KEY,
  MAX_ENTRY_BYTES,
  decodeDiagram,
  editability,
  encodeDiagram,
  findDiagramRoot,
  fingerprint,
  readDiagram,
  storeDiagram,
  utf8Length,
} from '../../plugin/src/sourceLink.ts'
import { transplantDiagram } from '../../plugin/src/update.ts'

// ---------------------------------------------------------------- helpers

const env = () => ({ ids: 0 })
const frame = (e, props = {}) => new MockNode(e, 'FRAME', props)
const text = (e, characters, props = {}) => new MockNode(e, 'TEXT', { characters, ...props })
const solid = (r, g, b) => ({ type: 'SOLID', color: { r, g, b } })

/** root (200x100) > card (frame) > [label text, box vector]; returns the named parts. */
function sampleTree() {
  const e = env()
  const root = frame(e, { name: 'Diagram', x: 40, y: 60, width: 200, height: 100 })
  const card = frame(e, { name: 'Card', x: 10, y: 10, width: 80, height: 40 })
  const label = text(e, 'Hello', { name: 'Label', x: 4, y: 4, width: 30, height: 12 })
  const box = new MockNode(e, 'VECTOR', { name: 'Box', x: 0, y: 30, width: 80, height: 10, fills: [solid(1, 0, 0)] })
  root.appendChild(card)
  card.appendChild(label)
  card.appendChild(box)
  return { e, root, card, label, box }
}

// ---------------------------------------------------------------- store / find / decode

test('storeDiagram writes the entry, fingerprint and relaunch data; findDiagramRoot finds it from a deeply nested child', () => {
  const e = env()
  const root = frame(e, { name: 'Diagram' })
  let n = root
  for (let i = 0; i < 6; i++) {
    const c = frame(e, { name: `L${i}` })
    n.appendChild(c)
    n = c
  }
  const leaf = text(e, 'deep')
  n.appendChild(leaf)

  assert.equal(findDiagramRoot(leaf), null, 'nothing linked yet')
  assert.equal(storeDiagram(root, { source: 'flowchart TD\n  A --> B', theme: 'dark', type: 'flowchart-v2' }), true)
  assert.equal(findDiagramRoot(leaf), root)
  assert.equal(findDiagramRoot(root), root)
  assert.deepEqual(readDiagram(root), { v: 1, source: 'flowchart TD\n  A --> B', theme: 'dark', type: 'flowchart-v2' })
  assert.match(root.getPluginData(FINGERPRINT_KEY), /^[0-9a-f]{16}$/)
  assert.ok(root.relaunchData && typeof root.relaunchData.edit === 'string')
  assert.equal(findDiagramRoot(frame(e)), null, 'an unrelated node has no diagram')
  assert.equal(findDiagramRoot(null), null)
})

test('findDiagramRoot returns the nearest linked ancestor', () => {
  const e = env()
  const outer = frame(e)
  const inner = frame(e)
  const leaf = text(e, 'x')
  outer.appendChild(inner)
  inner.appendChild(leaf)
  storeDiagram(outer, { source: 'a', theme: 'light' })
  storeDiagram(inner, { source: 'b', theme: 'light' })
  assert.equal(findDiagramRoot(leaf), inner)
})

test('decodeDiagram tolerates garbage and unknown versions', () => {
  for (const bad of [undefined, null, 42, {}, '', 'not json', '{', 'null', '[]', '"x"', '{"v":2,"source":"a","theme":"light"}', '{"v":1}', '{"v":1,"source":5,"theme":"light"}', '{"v":1,"source":"a","theme":"blue"}', '{"source":"a","theme":"light"}']) {
    assert.equal(decodeDiagram(bad), null, JSON.stringify(bad))
  }
  const ok = decodeDiagram(encodeDiagram({ source: 'erDiagram\n  A ||--o{ B : "ü 😀"', theme: 'light', type: 'erDiagram' }))
  assert.equal(ok.source, 'erDiagram\n  A ||--o{ B : "ü 😀"')
  assert.equal(decodeDiagram('{"v":1,"source":"a","theme":"dark"}').type, '', 'type is optional')
  // A node whose data is garbage is simply not a diagram.
  const e = env()
  const n = frame(e)
  n.setPluginData(DIAGRAM_KEY, '{oops')
  assert.equal(findDiagramRoot(n), null)
  assert.equal(readDiagram({ getPluginData() { throw new Error('boom') } }), null)
})

test('utf8Length counts bytes by hand', () => {
  assert.equal(utf8Length('abc'), 3)
  assert.equal(utf8Length('é'), 2)
  assert.equal(utf8Length('€'), 3)
  assert.equal(utf8Length('😀'), 4)
  assert.equal(utf8Length('\ud83d'), 3, 'lone surrogate')
  for (const s of ['', 'plain', 'ünï', '日本語', 'a😀b€', '{"v":1}']) assert.equal(utf8Length(s), Buffer.byteLength(s, 'utf8'), s)
})

test('an oversize source is not stored', () => {
  const e = env()
  const big = frame(e)
  assert.equal(encodeDiagram({ source: 'a'.repeat(95000), theme: 'light' }), null)
  assert.equal(storeDiagram(big, { source: 'a'.repeat(95000), theme: 'light' }), false)
  assert.equal(big.getPluginData(DIAGRAM_KEY), '')
  assert.equal(big.getPluginData(FINGERPRINT_KEY), '', 'no fingerprint without a link')
  assert.equal(big.relaunchData, undefined)

  // Counted in bytes, not characters: 40k euro signs are 40k characters but 120 kB.
  assert.equal(encodeDiagram({ source: '€'.repeat(40000), theme: 'light' }), null)

  // Just under the limit still goes through.
  const fits = encodeDiagram({ source: 'a'.repeat(80000), theme: 'light' })
  assert.ok(fits && utf8Length(DIAGRAM_KEY) + utf8Length(fits) <= MAX_ENTRY_BYTES)
  assert.equal(storeDiagram(frame(e), { source: 'a'.repeat(80000), theme: 'light' }), true)
})

test('storeDiagram works on a node without setRelaunchData (FigJam, mock)', () => {
  const e = env()
  const n = frame(e)
  n.setRelaunchData = undefined
  assert.equal(storeDiagram(n, { source: 'a', theme: 'light' }), true)
  assert.equal(n.relaunchData, undefined)
})

// ---------------------------------------------------------------- editability

test('a root inside a component instance is not editable (reason: instance)', () => {
  const e = env()
  const inst = frame(e)
  inst.type = 'INSTANCE'
  const root = frame(e)
  const leaf = text(e, 'x')
  inst.appendChild(root)
  root.appendChild(leaf)
  assert.deepEqual(editability(root), { editable: false, reason: 'instance' })
  assert.deepEqual(editability(leaf), { editable: false, reason: 'instance' })
  assert.deepEqual(editability(frame(e)), { editable: true })

  const asRoot = frame(e)
  asRoot.type = 'INSTANCE'
  assert.deepEqual(editability(asRoot), { editable: false, reason: 'instance' }, 'the root itself may be the instance')

  const comp = frame(e)
  comp.type = 'COMPONENT'
  assert.deepEqual(editability(comp), { editable: true }, 'a main component is editable')
})

// ---------------------------------------------------------------- fingerprint

test('fingerprint is stable and ignores the root position and name, but not its size', () => {
  const { root } = sampleTree()
  const a = fingerprint(root)
  assert.equal(fingerprint(root), a)
  assert.match(a, /^[0-9a-f]{16}$/)

  root.x += 500
  root.y -= 70
  assert.equal(fingerprint(root), a, 'moving the whole diagram is not an edit')
  root.type = 'COMPONENT'
  assert.equal(fingerprint(root), a, 'turning the frame into a component is not an edit')
  root.name = 'Renamed by the user'
  assert.equal(fingerprint(root), a, 'renaming the whole diagram is not an edit')
  root.width += 1
  assert.notEqual(fingerprint(root), a, 'resizing the root is')
})

test('fingerprint changes when a child moves, text is edited, a fill is recolored or a layer is deleted', () => {
  const variants = {
    'move a child': ({ card }) => { card.x += 5 },
    'move a nested child': ({ box }) => { box.y += 3 },
    'edit text': ({ label }) => { label.characters = 'Hello!' },
    'recolor a fill': ({ box }) => { box.fills = [solid(0, 1, 0)] },
    'delete a layer': ({ box }) => { box.remove() },
    'rename a child': ({ card }) => { card.name = 'Card 2' },
    'resize a child': ({ box }) => { box.width += 4 },
  }
  const base = fingerprint(sampleTree().root)
  assert.equal(fingerprint(sampleTree().root), base, 'identical trees hash alike')
  const seen = new Set([base])
  for (const [what, edit] of Object.entries(variants)) {
    const t = sampleTree()
    edit(t)
    const fp = fingerprint(t.root)
    assert.notEqual(fp, base, what)
    seen.add(fp)
  }
  assert.equal(seen.size, Object.keys(variants).length + 1, 'every edit gives its own hash')
})

test('fingerprint rounds bounds to integers and skips unreadable values', () => {
  const t = sampleTree()
  const base = fingerprint(t.root)
  t.card.x += 0.2
  t.box.width += 0.3
  assert.equal(fingerprint(t.root), base, 'sub-pixel jitter is not an edit')

  const mixed = Symbol('figma.mixed')
  t.box.fills = mixed
  t.label.fills = mixed
  t.card.x = mixed
  assert.doesNotThrow(() => fingerprint(t.root))
  assert.match(fingerprint(t.root), /^[0-9a-f]{16}$/)
})

// ---------------------------------------------------------------- transplant

function pageWith(e) {
  const page = frame(e, { name: 'Page' })
  page.type = 'PAGE'
  const before = frame(e, { name: 'Before' })
  const after = frame(e, { name: 'After' })
  page.appendChild(before)
  return { page, before, after }
}

function target(e) {
  const t = frame(e, { name: 'My Diagram', x: 100, y: 50, width: 300, height: 200, fills: [solid(1, 0, 0)] })
  t.layoutMode = 'VERTICAL'
  t.clipsContent = false
  t.appendChild(text(e, 'old a', { name: 'old a' }))
  t.appendChild(text(e, 'old b', { name: 'old b' }))
  t.setPluginData('mermapix:diagram', 'OLD')
  t.setPluginData('mermapix:stale', 'remove me')
  t.setPluginData('other-plugin:key', 'keep')
  return t
}

function fresh(e) {
  const f = frame(e, { name: 'Fresh', x: 9, y: 9, width: 500, height: 400, fills: [solid(1, 1, 1)], strokes: [solid(0, 0, 1)] })
  f.strokeWeight = 2
  f.cornerRadius = 8
  f.clipsContent = true
  const a = text(e, 'new a', { name: 'new a', x: 11, y: 22 })
  const b = new MockNode(e, 'VECTOR', { name: 'new b', x: 33, y: 44, width: 5, height: 6 })
  const g = new MockNode(e, 'GROUP', { name: 'new c', x: 55, y: 66, width: 7, height: 8 })
  f.appendChild(a)
  f.appendChild(b)
  f.appendChild(g)
  f.setPluginData('mermapix:diagram', 'NEW')
  f.setPluginData('mermapix:fallback', 'x')
  return f
}

test('transplantDiagram keeps the root (id, position, name, parent index) and swaps content, size and background', () => {
  const e = env()
  const { page, after } = pageWith(e)
  const t = target(e)
  page.appendChild(t)
  page.appendChild(after)
  const f = fresh(e)
  page.appendChild(f)
  const id = t.id
  const oldKids = [...t.children]
  const newKids = [...f.children]
  const index = page.children.indexOf(t)

  transplantDiagram(t, f)

  assert.equal(t.id, id)
  assert.equal(t.parent, page)
  assert.equal(page.children.indexOf(t), index, 'z-order kept')
  assert.equal(t.name, 'My Diagram')
  assert.equal(t.x, 100)
  assert.equal(t.y, 50)
  assert.deepEqual(t.children, newKids, 'new children in the same order')
  assert.deepEqual(t.children.map((c) => [c.x, c.y]), [[11, 22], [33, 44], [55, 66]], 'internal coordinates unchanged')
  assert.ok(newKids.every((c) => c.parent === t))
  assert.ok(oldKids.every((c) => c.removed), 'old children deleted')
  assert.equal(t.layoutMode, 'NONE')
  assert.equal(t.width, 500)
  assert.equal(t.height, 400)
  assert.deepEqual(t.fills, [solid(1, 1, 1)])
  assert.deepEqual(t.strokes, [solid(0, 0, 1)])
  assert.equal(t.strokeWeight, 2)
  assert.equal(t.cornerRadius, 8)
  assert.equal(t.clipsContent, true)
  assert.equal(t.getPluginData('mermapix:diagram'), 'NEW')
  assert.equal(t.getPluginData('mermapix:fallback'), 'x')
  assert.equal(t.getPluginData('mermapix:stale'), '', 'stale mermapix keys cleared')
  assert.equal(t.getPluginData('other-plugin:key'), 'keep', 'foreign plugin data untouched')
  assert.equal(f.removed, true, 'emptied fresh root removed')
  assert.ok(!page.children.includes(f))
})

test('transplantDiagram works on a COMPONENT and refuses anything else', () => {
  const e = env()
  const comp = target(e)
  comp.type = 'COMPONENT'
  transplantDiagram(comp, fresh(e))
  assert.equal(comp.type, 'COMPONENT')
  assert.equal(comp.children.length, 3)

  const group = new MockNode(e, 'GROUP', { name: 'G' })
  assert.throws(() => transplantDiagram(group, fresh(e)), /frame or component/)
  const gone = target(e)
  gone.remove()
  assert.throws(() => transplantDiagram(gone, fresh(e)), /frame or component/)
})

test('transplantDiagram leaves the target as it was when moving the new children fails', () => {
  const e = env()
  const { page } = pageWith(e)
  const t = target(e)
  page.appendChild(t)
  const f = fresh(e)
  page.appendChild(f)
  const oldKids = [...t.children]
  const realAppend = t.appendChild.bind(t)
  let calls = 0
  t.appendChild = (c) => {
    if (++calls === 2) throw new Error('append refused')
    realAppend(c)
  }
  assert.throws(() => transplantDiagram(t, f), /append refused/)
  assert.deepEqual(t.children, oldKids, 'old content kept')
  assert.ok(oldKids.every((c) => !c.removed))
  assert.equal(t.layoutMode, 'VERTICAL', 'layout mode restored')
  assert.equal(t.width, 300)
  assert.equal(t.getPluginData('mermapix:diagram'), 'OLD')
})

// ---------------------------------------------------------------- end to end through the bundle

const svgOf = (example, theme = 'light') => fs.readFileSync(fixturePath(example, theme), 'utf8')
const FLOW = svgOf('2-ex-flowchart')
const SEQ = svgOf('3-ex-sequence')
const SRC_FLOW = 'flowchart TD\n  A[Start] --> B[End]'
const SRC_SEQ = 'sequenceDiagram\n  Alice->>Bob: Hi'

function msgs(list, type) {
  return list.filter((m) => m.type === type)
}

async function inserted(s, svg = FLOW, source = SRC_FLOW, extra = {}) {
  const out = await s.send({ type: 'create-svg', svg, name: 'Flow', theme: 'light', themeVariables: THEMES.light, source, ...extra })
  assert.deepEqual(msgs(out, 'inserted'), [{ type: 'inserted', linked: true }], JSON.stringify(out))
  return s.page.children[s.page.children.length - 1]
}

function descendants(n, out = []) {
  for (const c of n.children || []) { out.push(c); descendants(c, out) }
  return out
}

test('e2e: insert stores the source, relaunch data and fingerprint on the root, positioned after creation', async () => {
  const s = createSession()
  const root = await inserted(s)
  const stored = decodeDiagram(root.getPluginData(DIAGRAM_KEY))
  assert.equal(stored.source, SRC_FLOW)
  assert.equal(stored.theme, 'light')
  assert.ok(stored.type.length > 0, 'diagram type recorded')
  assert.deepEqual(Object.keys(root.relaunchData), ['edit'])
  assert.equal(root.getPluginData(FINGERPRINT_KEY), fingerprint(root), 'main.ts moved the node after creation; the fingerprint is position independent')
  assert.deepEqual(s.page.selection, [root])
  assert.ok(!s.notifications().some((m) => /cannot be re-edited/.test(m)))
})

test('e2e: insert without source answers linked:false; oversize source answers linked:false and notifies', async () => {
  const s = createSession()
  const out = await s.send({ type: 'create-svg', svg: FLOW, name: 'Flow', themeVariables: THEMES.light })
  assert.deepEqual(msgs(out, 'inserted'), [{ type: 'inserted', linked: false }])
  const plain = s.page.children[0]
  assert.equal(plain.getPluginData(DIAGRAM_KEY), '')
  assert.equal(plain.relaunchData, undefined)
  assert.ok(!s.notifications().some((m) => /cannot be re-edited/.test(m)))

  const out2 = await s.send({ type: 'create-svg', svg: FLOW, name: 'Big', theme: 'light', themeVariables: THEMES.light, source: 'x'.repeat(100000) })
  assert.deepEqual(msgs(out2, 'inserted'), [{ type: 'inserted', linked: false }])
  assert.equal(s.page.children[1].getPluginData(DIAGRAM_KEY), '')
  assert.ok(s.notifications().some((m) => /cannot be re-edited/.test(m)), s.notifications().join('|'))
})

test('e2e: selection messages (request-selection, selectionchange, autoEdit only first and only for the relaunch command)', async () => {
  const s = createSession({ command: 'edit' })
  const root = await inserted(s)
  s.posted.length = 0

  const first = await s.send({ type: 'request-selection' })
  assert.equal(first.length, 1)
  assert.equal(first[0].type, 'selection')
  assert.equal(first[0].autoEdit, true)
  assert.deepEqual({ ...first[0].diagram }, { id: root.id, name: 'Flow', source: SRC_FLOW, theme: 'light', editable: true })
  const second = await s.send({ type: 'request-selection' })
  assert.equal(second[0].autoEdit, undefined, 'autoEdit goes out once')

  // A selection change posts on its own; a layer deep inside resolves to the root.
  const leaf = descendants(root).find((n) => n.type === 'TEXT')
  s.posted.length = 0
  s.select([leaf])
  assert.equal(s.posted.length, 1)
  assert.equal(s.posted[0].diagram.id, root.id)
  assert.equal(s.posted[0].autoEdit, undefined)

  s.posted.length = 0
  s.select([])
  assert.deepEqual(s.posted, [{ type: 'selection', diagram: null }])

  const plain = createSession()
  const r = await plain.send({ type: 'request-selection' })
  assert.deepEqual(r, [{ type: 'selection', diagram: null }], 'no command, no autoEdit')
})

test('e2e: a selected root inside an instance is reported as not editable', async () => {
  const s = createSession()
  const root = await inserted(s)
  const inst = new MockNode(s.env, 'FRAME', { name: 'Instance' })
  inst.type = 'INSTANCE'
  s.page.appendChild(inst)
  inst.appendChild(root)
  s.select([root])
  const d = s.posted[s.posted.length - 1].diagram
  assert.equal(d.editable, false)
  assert.equal(d.reason, 'instance')
  assert.equal(d.source, SRC_FLOW)
})

test('e2e: update-svg regenerates in place: same root id/position/name/index, new children, new source', async () => {
  const s = createSession()
  const sibling = new MockNode(s.env, 'FRAME', { name: 'Sibling' })
  s.page.appendChild(sibling)
  const root = await inserted(s)
  const top = new MockNode(s.env, 'FRAME', { name: 'On top' })
  s.page.appendChild(top)
  root.name = 'Renamed by user'
  root.x = 1234
  root.y = -321
  const index = s.page.children.indexOf(root)
  const id = root.id
  const oldKids = [...root.children]
  const oldSize = [root.width, root.height]
  const pageCount = s.page.children.length
  s.posted.length = 0

  const out = await s.send({ type: 'update-svg', targetId: id, svg: SEQ, source: SRC_SEQ, theme: 'light', themeVariables: THEMES.light })

  const done = msgs(out, 'updated')
  assert.equal(done.length, 1, JSON.stringify(out.filter((m) => m.type !== 'selection')))
  assert.equal(done[0].id, id)
  assert.equal(typeof done[0].ms, 'number', 'the update reports how long it took (Phase 13 live update)')
  assert.equal(root.id, id)
  assert.equal(root.removed, false)
  assert.equal(s.page.children.indexOf(root), index)
  assert.equal(s.page.children.length, pageCount, 'the temp node is gone')
  assert.deepEqual([root.name, root.x, root.y], ['Renamed by user', 1234, -321])
  assert.ok(oldKids.every((c) => c.removed))
  assert.ok(root.children.length > 0 && root.children.every((c) => c.parent === root))
  assert.notDeepEqual([root.width, root.height], oldSize, 'resized to the sequence diagram')
  assert.equal(readDiagram(root).source, SRC_SEQ)
  assert.equal(root.getPluginData(FINGERPRINT_KEY), fingerprint(root), 'fingerprint matches the new tree')
  assert.deepEqual(Object.keys(root.relaunchData), ['edit'])
  assert.deepEqual(s.page.selection, [root])
  assert.ok(s.notifications().includes('Mermapix diagram updated'))
  // The UI is told about the new state right after.
  const sel = out.filter((m) => m.type === 'selection').pop()
  assert.equal(sel.diagram.source, SRC_SEQ)
})

test('e2e: a manual change in Figma needs confirmation; force replaces it', async () => {
  const s = createSession()
  const root = await inserted(s)
  const id = root.id

  // Untouched: no prompt.
  const clean = await s.send({ type: 'update-svg', targetId: id, svg: FLOW, source: SRC_FLOW + '\n  B --> C', theme: 'light', themeVariables: THEMES.light })
  assert.equal(msgs(clean, 'updated').length, 1)

  // Moving or renaming the whole diagram is not a manual edit.
  root.x += 40
  root.name = 'moved'
  const moved = await s.send({ type: 'update-svg', targetId: id, svg: FLOW, source: SRC_FLOW, theme: 'light', themeVariables: THEMES.light })
  assert.equal(msgs(moved, 'updated').length, 1, JSON.stringify(moved.filter((m) => m.type !== 'selection')))

  // Edit one layer by hand.
  const victim = descendants(root).find((n) => n.type === 'TEXT')
  victim.characters = 'edited by hand'
  const before = serialize(root)
  s.posted.length = 0
  const asked = await s.send({ type: 'update-svg', targetId: id, svg: SEQ, source: SRC_SEQ, theme: 'light', themeVariables: THEMES.light })
  // Phase 12: the question says what was changed (here one edited text layer).
  assert.equal(asked.length, 1)
  assert.deepEqual({ ...asked[0], changes: undefined }, { type: 'update-needs-confirm', id, changes: undefined })
  assert.equal(asked[0].changes.texts.length, 1)
  assert.equal(asked[0].changes.texts[0].to, 'edited by hand')
  assert.deepEqual({ ...asked[0].changes, texts: [] }, { texts: [], moved: 0, restyled: 0, added: 0, removed: 0, other: false })
  assert.deepEqual(serialize(root), before, 'nothing touched while waiting for the answer')
  assert.equal(readDiagram(root).source, SRC_FLOW)

  const forced = await s.send({ type: 'update-svg', targetId: id, svg: SEQ, source: SRC_SEQ, theme: 'light', themeVariables: THEMES.light, force: true })
  assert.equal(msgs(forced, 'updated').length, 1)
  assert.equal(readDiagram(root).source, SRC_SEQ)
  assert.ok(!descendants(root).some((n) => n.characters === 'edited by hand'))

  // A missing stored fingerprint counts as not modified (diagram from an older build).
  victim.characters = 'again'
  root.setPluginData(FINGERPRINT_KEY, '')
  const legacy = await s.send({ type: 'update-svg', targetId: id, svg: FLOW, source: SRC_FLOW, theme: 'light', themeVariables: THEMES.light })
  assert.equal(msgs(legacy, 'updated').length, 1)
})

test('e2e: update-failed missing (unknown id, removed root, no source) and instance', async () => {
  const s = createSession()
  const root = await inserted(s)
  const upd = (targetId) => s.send({ type: 'update-svg', targetId, svg: SEQ, source: SRC_SEQ, theme: 'light', themeVariables: THEMES.light })
  const reason = (out) => msgs(out, 'update-failed').map((m) => m.reason)

  assert.deepEqual(reason(await upd('9999:9999')), ['missing'])

  const plain = new MockNode(s.env, 'FRAME', { name: 'no source' })
  s.page.appendChild(plain)
  assert.deepEqual(reason(await upd(plain.id)), ['missing'])

  const inst = new MockNode(s.env, 'FRAME', { name: 'Instance' })
  inst.type = 'INSTANCE'
  s.page.appendChild(inst)
  inst.appendChild(root)
  const kids = [...root.children]
  assert.deepEqual(reason(await upd(root.id)), ['instance'])
  assert.deepEqual(root.children, kids, 'instance content untouched')

  root.remove()
  const out = await upd(root.id)
  assert.deepEqual(reason(out), ['missing'])
  assert.equal(out[0].id, root.id)
})

for (const [label, marker] of [['the importer throws', IMPORT_FAILURE], ['the optimizer throws after the temp node exists', OPTIMIZE_FAILURE]]) {
  test(`e2e: update is transactional, the target is untouched when ${label}`, async () => {
    const s = createSession()
    const root = await inserted(s)
    const before = JSON.stringify(serialize(root))
    const kids = [...root.children]
    const pageBefore = [...s.page.children]
    s.posted.length = 0

    const bad = SEQ.replace('<svg', `<!-- ${marker} --><svg`)
    const out = await s.send({ type: 'update-svg', targetId: root.id, svg: bad, source: SRC_SEQ, theme: 'light', themeVariables: THEMES.light })

    const fails = msgs(out, 'update-failed')
    assert.equal(fails.length, 1, JSON.stringify(out))
    assert.equal(fails[0].reason, 'error')
    assert.equal(fails[0].id, root.id)
    assert.ok(fails[0].message.length > 0)
    assert.equal(msgs(out, 'updated').length, 0)
    assert.equal(JSON.stringify(serialize(root)), before, 'target serialized identically')
    assert.deepEqual(root.children, kids)
    assert.ok(kids.every((c) => !c.removed))
    assert.deepEqual(s.page.children, pageBefore, 'no temp node left on the page')
    assert.equal(readDiagram(root).source, SRC_FLOW)

    // And the target is still usable afterwards.
    const again = await s.send({ type: 'update-svg', targetId: root.id, svg: SEQ, source: SRC_SEQ, theme: 'light', themeVariables: THEMES.light })
    assert.equal(msgs(again, 'updated').length, 1)
  })
}

test('e2e: an oversize source on update fails with error and leaves the diagram linked', async () => {
  const s = createSession()
  const root = await inserted(s)
  const out = await s.send({ type: 'update-svg', targetId: root.id, svg: SEQ, source: 'x'.repeat(100000), theme: 'light', themeVariables: THEMES.light })
  assert.equal(msgs(out, 'update-failed')[0].reason, 'error')
  assert.equal(readDiagram(root).source, SRC_FLOW)
})

test('e2e: a diagram turned into a COMPONENT keeps its id through an update', async () => {
  const s = createSession()
  const root = await inserted(s)
  root.type = 'COMPONENT'
  const out = await s.send({ type: 'update-svg', targetId: root.id, svg: SEQ, source: SRC_SEQ, theme: 'light', themeVariables: THEMES.light })
  assert.equal(msgs(out, 'updated').length, 1)
  assert.equal(root.type, 'COMPONENT')
  assert.equal(readDiagram(root).source, SRC_SEQ)
})
