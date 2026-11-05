// Phase 8.4 end to end: sequence diagrams become native Figma structure. The real built
// plugin/code.js runs on the real Mermaid payload SVGs (the built-in sequence example and the full
// fixture tests/figma-fixtures/08-sequence-full.mmd, dark + light) through the mock SVG importer.
// Expectations are derived independently from the tree the plugin received (the "before" tree).
// Requires an up-to-date bundle: run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { importSvg } from '../plugin-mock/svg-import.mjs'
import { runFixture } from '../plugin-mock/run-fixture.mjs'

const THEMES = ['dark', 'light']
const EXAMPLES = ['3-ex-sequence', '8-case-sequence-full']
const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol
const solidKey = (paints) => JSON.stringify((paints || []).map((p) => [p.type, p.color, p.opacity ?? 1]))
const descendants = (n, type) => all(n, (c) => c.type === type && c !== n)
const kind = (n) => (n.pluginData || {})['mermapix:kind']

/** Bounds relative to the root frame (GROUPs transparent, FRAME positions accumulate). */
function rel(n, root) {
  let x = n.x, y = n.y, p = n.parent
  while (p && p !== root) { if (p.type === 'FRAME') { x += p.x; y += p.y } p = p.parent }
  return { x, y, width: n.width, height: n.height }
}
const union = (bs) => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
  return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y }
}
const sameRect = (a, b, tol = 0.5) => ['x', 'y', 'width', 'height'].every((k) => near(a[k], b[k], tol))

const runs = new Map()
async function load(example, theme) {
  const key = `${example}/${theme}`
  if (!runs.has(key)) {
    const r = await runFixture(example, theme)
    const before = importSvg({ ids: 0 }, r.svgSeen)
    runs.set(key, { ...r, before, truth: groundTruth(before) })
  }
  return runs.get(key)
}

// ---------------------------------------------------------------- ground truth from the raw import

const isLine = (v) => (v.width < 0.01 || v.height < 0.01) && (v.width > 0.01 || v.height > 0.01) && v.strokes.length && !v.fills.length
const isRectPath = (v) => /^M [\d. ]+ L [\d. ]+ L [\d. ]+ L [\d. ]+/.test(v.vectorPaths[0].data) || /^M [\d. -]+ L [\d. ]+ C/.test(v.vectorPaths[0].data)

function groundTruth(before) {
  const lifelines = all(before, (n) => n.type === 'VECTOR' && /^actor\d+$/.test(n.name) && n.width < 0.01).map((v) => ({ v, b: rel(v, before) }))
  const groups = all(before, (n) => n.type === 'GROUP' && !n.name.includes('inlined-marker'))
  const boxes = [], blocks = [], figures = [], rectGroups = []
  for (const g of groups) {
    const vs = descendants(g, 'VECTOR'), ts = descendants(g, 'TEXT').filter((t) => t.characters.trim())
    if (g.children.some((c) => c.type === 'GROUP' && !c.name.includes('inlined-marker'))) continue
    if (vs.some((v) => v.name.startsWith('actor-man-'))) { figures.push({ g, vs, ts, b: union([...vs, ...ts].map((x) => rel(x, before))) }); continue }
    const lines = vs.filter(isLine)
    if (lines.length >= 4 && ts.length) { blocks.push({ g, vs, ts, lines }); continue }
    if (vs.length === 1 && vs[0].fills.length && isRectPath(vs[0])) {
      if (ts.length) boxes.push({ g, v: vs[0], ts, b: rel(vs[0], before) })
      else rectGroups.push({ v: vs[0], b: rel(vs[0], before) })
    }
  }
  const loose = all(before, (n) => n.type === 'VECTOR' && n.fills.length && !n.parent.name.includes('inlined-marker') && n.parent === before && n.width >= 1)
    .map((v) => ({ v, b: rel(v, before) }))
  const touches = (b, ll) => near(b.x + b.width / 2, ll.b.x, 1.5) && (near(b.y + b.height, ll.b.y, 2) ? 'top' : near(b.y, ll.b.y + ll.b.height, 2) ? 'bottom' : null)
  const participants = [], notes = []
  for (const bx of boxes) {
    let side = null
    for (const ll of lifelines) { const s = touches(bx.b, ll); if (s) side = s }
    ;(side ? participants : notes).push({ ...bx, side })
  }
  const badgeGroups = all(before, (n) => n.type === 'GROUP' && /sequence-number/.test(n.name))
  return { lifelines, boxes, blocks, figures, participants, notes, rectGroups, loose, badgeGroups }
}

const blockFrames = (root) => all(root, (n) => n.type === 'FRAME' && kind(n) === 'Block')

// ---------------------------------------------------------------- tests

for (const theme of THEMES) {
  for (const example of EXAMPLES) {
    const tag = `[${example}/${theme}]`
    const full = example.startsWith('8-')

    test(`${tag} the ground truth has what the fixture promises`, async () => {
      const { truth } = await load(example, theme)
      assert.ok(truth.lifelines.length >= 4)
      assert.ok(truth.participants.length >= 6)
      assert.equal(truth.figures.length, 2)
      assert.ok(truth.blocks.length >= 1)
      if (full) {
        assert.equal(truth.blocks.length, 7)
        assert.equal(truth.notes.length, 5)
        assert.equal(truth.rectGroups.length, 3)
        assert.equal(truth.loose.length, 1, 'one rect highlight')
      }
    })

    test(`${tag} participants: Auto Layout frames, FIXED size, merged paint + radius, (top)/(bottom)`, async () => {
      const { root, truth } = await load(example, theme)
      const frames = all(root, (n) => n.type === 'FRAME' && kind(n) === 'Participant')
      assert.equal(frames.length, truth.participants.length)
      for (const p of truth.participants) {
        const label = p.ts.map((t) => t.characters.trim()).join(' ')
        const f = frames.find((x) => x.name === `Participant: ${label} (${p.side})`)
        assert.ok(f, `frame for ${label} (${p.side})`)
        assert.ok(sameRect(rel(f, root), p.b), `${label} bounds ${JSON.stringify(rel(f, root))} vs ${JSON.stringify(p.b)}`)
        assert.equal(f.layoutMode, 'HORIZONTAL')
        assert.equal(f.primaryAxisSizingMode, 'FIXED')
        assert.equal(f.counterAxisSizingMode, 'FIXED')
        assert.equal(solidKey(f.fills), solidKey(p.v.fills))
        assert.equal(solidKey(f.strokes), solidKey(p.v.strokes))
        assert.equal(f.strokeWeight, p.v.strokeWeight)
        assert.ok(near(f.cornerRadius, 3, 0.01), `radius ${f.cornerRadius}`)
        const texts = f.children.filter((c) => c.type === 'TEXT')
        assert.equal(texts.length, 1)
        assert.equal(texts[0].fontName.family, 'Inter')
        assert.equal(texts[0].textAlignHorizontal, 'CENTER')
        assert.equal(f.children.filter((c) => c.type === 'VECTOR').length, 0, 'no separate outline vector')
      }
    })

    test(`${tag} stick-figure actors: wrapper frame keeps every vector at its exact position`, async () => {
      const { root, truth, before } = await load(example, theme)
      const frames = all(root, (n) => n.type === 'FRAME' && kind(n) === 'Actor')
      assert.equal(frames.length, truth.figures.length)
      for (const fig of truth.figures) {
        const label = fig.ts.map((t) => t.characters.trim()).join(' ')
        const side = fig.b.y < truth.lifelines[0].b.y ? 'top' : 'bottom'
        const f = frames.find((x) => x.name === `Actor: ${label} (${side})`)
        assert.ok(f, `${label} ${side}`)
        assert.ok(sameRect(rel(f, root), fig.b, 0.01))
        assert.equal(f.layoutMode, 'NONE')
        assert.equal(f.fills.length, 0)
        assert.equal(f.strokes.length, 0)
        const vecs = f.children.filter((c) => c.type === 'VECTOR')
        assert.equal(vecs.length, fig.vs.length)
        for (const ov of fig.vs) {
          const m = vecs.find((v) => v.vectorPaths[0].data === ov.vectorPaths[0].data && sameRect(rel(v, root), rel(ov, before), 0.01))
          assert.ok(m, `vector ${ov.name} ${ov.vectorPaths[0].data}`)
          assert.equal(solidKey(m.strokes), solidKey(ov.strokes))
          assert.equal(m.strokeWeight, ov.strokeWeight)
        }
        assert.deepEqual(vecs.map((v) => v.name).sort(), ['Arms', 'Head', 'Left Leg', 'Right Leg', 'Torso'])
        // the name text keeps its center across the Arial -> Inter switch
        const ot = fig.ts[0], nt = f.children.find((c) => c.type === 'TEXT')
        const ob = rel(ot, root), nb = rel(nt, root)
        assert.ok(near(ob.x + ob.width / 2, nb.x + nb.width / 2, 0.6) && near(ob.y + ob.height / 2, nb.y + nb.height / 2, 0.6))
        assert.equal(nt.fontName.family, 'Inter')
      }
    })

    test(`${tag} lifelines stay vectors (same path + bounds), named after their participant`, async () => {
      const { root, truth } = await load(example, theme)
      const lls = all(root, (n) => n.type === 'VECTOR' && n.name.startsWith('Lifeline'))
      assert.equal(lls.length, truth.lifelines.length)
      for (const l of truth.lifelines) {
        const m = lls.find((v) => v.vectorPaths[0].data === l.v.vectorPaths[0].data && sameRect(rel(v, root), l.b, 0.01))
        assert.ok(m, l.v.name)
        assert.match(m.name, /^Lifeline: .+/, 'mapped to a participant by x')
        assert.equal(solidKey(m.strokes), solidKey(l.v.strokes))
      }
      assert.equal(new Set(lls.map((v) => v.name)).size, lls.length, 'distinct names')
    })

    test(`${tag} notes: Auto Layout frames at exact bounds, multi-line text keeps its lines`, async () => {
      const { root, truth } = await load(example, theme)
      const frames = all(root, (n) => n.type === 'FRAME' && kind(n) === 'Note')
      assert.equal(frames.length, truth.notes.length)
      for (const n of truth.notes) {
        const f = frames.find((x) => sameRect(rel(x, root), n.b))
        assert.ok(f, `note ${n.ts[0].characters}`)
        assert.equal(f.layoutMode, 'HORIZONTAL')
        assert.equal(f.primaryAxisSizingMode, 'FIXED')
        assert.equal(f.counterAxisSizingMode, 'FIXED')
        assert.equal(solidKey(f.fills), solidKey(n.v.fills))
        assert.equal(solidKey(f.strokes), solidKey(n.v.strokes))
        assert.equal(f.children.filter((c) => c.type === 'VECTOR').length, 0)
        const texts = f.children.filter((c) => c.type === 'TEXT')
        assert.equal(texts.length, 1)
        const lines = n.ts.map((t) => t.characters.trim())
        assert.deepEqual(texts[0].characters.split('\n'), lines)
        assert.equal(f.name, `Note: ${lines.join(' ')}`.slice(0, 46))
      }
      // text wider than its box is allowed to overflow (as in the web preview): the frame never clips
      for (const f of frames) assert.equal(f.clipsContent, false)
    })

    test(`${tag} activations and rect highlights are filled frames, highlights sit below everything`, async () => {
      const { root, truth } = await load(example, theme)
      const acts = all(root, (n) => n.type === 'FRAME' && kind(n) === 'Activation')
      const hls = all(root, (n) => n.type === 'FRAME' && kind(n) === 'Highlight')
      const wantActs = truth.rectGroups.filter((g) => g.v.strokes.length)
      assert.equal(acts.length, wantActs.length)
      for (const a of wantActs) {
        const f = acts.find((x) => sameRect(rel(x, root), a.b, 0.01))
        assert.ok(f, 'activation bounds')
        assert.match(f.name, /^Activation: .+/)
        assert.equal(solidKey(f.fills), solidKey(a.v.fills))
        assert.equal(solidKey(f.strokes), solidKey(a.v.strokes))
        assert.equal(f.children.length, 0)
      }
      const wantHls = [...truth.loose, ...truth.rectGroups.filter((g) => !g.v.strokes.length)]
      assert.equal(hls.length, wantHls.length)
      for (const h of wantHls) {
        const f = hls.find((x) => sameRect(rel(x, root), h.b, 0.01))
        assert.ok(f)
        assert.equal(f.strokes.length, 0)
        assert.equal(solidKey(f.fills), solidKey(h.v.fills))
        assert.equal(root.children.indexOf(f), hls.indexOf(f), 'highlights are the bottom-most layers')
      }
    })

    test(`${tag} blocks: ONE frame per block, no fill, border lines merged into its stroke, dividers + tab + conditions inside`, async () => {
      const { root, truth, before } = await load(example, theme)
      const frames = blockFrames(root)
      assert.equal(frames.length, truth.blocks.length)
      for (const b of truth.blocks) {
        const box = union(b.lines.map((l) => rel(l, before)))
        const f = frames.find((x) => sameRect(rel(x, root), box, 0.01))
        assert.ok(f, `block frame at ${JSON.stringify(box)}`)
        assert.equal(f.layoutMode, 'NONE')
        assert.equal(f.fills.length, 0, 'transparent')
        assert.equal(f.clipsContent, false)
        const top = b.lines.find((l) => l.height < 0.01 && near(rel(l, before).y, box.y, 0.01))
        assert.equal(solidKey(f.strokes), solidKey(top.strokes), 'stroke color')
        assert.equal(f.strokeWeight, top.strokeWeight, 'stroke weight')
        assert.deepEqual(f.dashPattern, top.dashPattern, 'stroke dash')
        assert.equal(f.strokeAlign, 'CENTER')
        // the four border lines are gone: no VECTOR anywhere with a border line's exact rect + path
        const borderLines = b.lines.filter((l) => {
          const r = rel(l, before)
          return (l.height < 0.01 && (near(r.y, box.y, 0.01) || near(r.y, box.y + box.height, 0.01)) && near(r.width, box.width, 0.01)) ||
            (l.width < 0.01 && (near(r.x, box.x, 0.01) || near(r.x, box.x + box.width, 0.01)) && near(r.height, box.height, 0.01))
        })
        assert.equal(borderLines.length, 4)
        const dividers = b.lines.filter((l) => !borderLines.includes(l))
        const kids = f.children
        assert.deepEqual(kids.filter((c) => c.type === 'VECTOR').map((v) => v.name), dividers.map(() => 'Divider'))
        for (const d of dividers) {
          const m = kids.find((v) => v.type === 'VECTOR' && sameRect(rel(v, root), rel(d, before), 0.01))
          assert.ok(m, 'divider kept at its exact position')
          assert.deepEqual(m.dashPattern, d.dashPattern)
        }
        // label tab = wrapper frame (complex polygon) with the tab vector + the block word
        const tab = kids.find((c) => c.type === 'FRAME' && kind(c) === 'Block Label')
        assert.ok(tab, 'label tab frame')
        assert.equal(tab.children.filter((c) => c.type === 'VECTOR').length, 1)
        assert.equal(tab.children.filter((c) => c.type === 'TEXT').length, 1)
        assert.match(tab.name, /^Block Label: \w+/)
        // all original texts of this block live inside it (nested blocks / notes / messages aside)
        for (const t of b.ts) {
          const inside = all(f, (n) => n.type === 'TEXT' && n.characters.trim() === t.characters.trim())
          assert.ok(inside.length >= 1, `text ${t.characters} inside ${f.name}`)
        }
        assert.match(f.name, /^Block: \w+/)
      }
    })

    test(`${tag} nested blocks nest by containment, content moves into the smallest block that contains it`, async () => {
      const { root } = await load(example, theme)
      const frames = blockFrames(root)
      for (const f of frames) {
        const p = f.parent
        if (p.type === 'FRAME' && p !== root) {
          assert.equal(kind(p), 'Block', `${f.name} nests only in blocks`)
          const a = rel(f, root), o = rel(p, root)
          assert.ok(a.x >= o.x - 1 && a.y >= o.y - 1 && a.x + a.width <= o.x + o.width + 1 && a.y + a.height <= o.y + o.height + 1)
          assert.ok(a.width * a.height < o.width * o.height)
        }
      }
      for (const m of all(root, (n) => n.type === 'GROUP' && n.name.startsWith('Message '))) {
        // any message below a block frame is inside that frame's bounds
        const owners = []
        for (let p = m.parent; p && p !== root; p = p.parent) if (p.type === 'FRAME') owners.push(p)
        const mb = union(m.children.filter((c) => c.type !== 'FRAME').map((c) => rel(c, root)))
        for (const o of owners) {
          const ob = rel(o, root)
          assert.ok(mb.x >= ob.x - 1 && mb.y >= ob.y - 1 && mb.x + mb.width <= ob.x + ob.width + 1 && mb.y + mb.height <= ob.y + ob.height + 1, `${m.name} inside ${o.name}`)
        }
      }
      if (full) {
        const byName = (re) => frames.find((f) => re.test(f.name))
        const alt = byName(/^Block: alt/), opt = byName(/^Block: opt/)
        assert.equal(opt.parent, alt, 'opt nests in alt')
        assert.ok(all(alt, (n) => n.type === 'FRAME' && /^Block: loop/.test(n.name)).length === 1, 'loop nests in alt')
        assert.ok(all(opt, (n) => n.type === 'GROUP' && /Receipt link/.test(n.name)).length === 1, 'message nests in the smallest block (opt, not alt)')
      }
    })

    test(`${tag} messages: one group per message with line + markers + label + Badge frame holding the number`, async () => {
      const { root, truth } = await load(example, theme)
      const msgs = all(root, (n) => n.type === 'GROUP' && /^Message \d+/.test(n.name))
      assert.equal(msgs.length, truth.badgeGroups.length)
      const nums = msgs.map((m) => Number(/^Message (\d+)/.exec(m.name)[1])).sort((a, b) => a - b)
      assert.deepEqual(nums, nums.map((_, i) => i + 1), 'autonumber order 1..n')
      for (const m of msgs) {
        const n = /^Message (\d+)/.exec(m.name)[1]
        const lines = m.children.filter((c) => c.type === 'VECTOR')
        assert.equal(lines.length, 1)
        assert.equal(lines[0].name, 'Line')
        assert.ok(m.children.some((c) => c.type === 'TEXT'), 'label')
        const marks = m.children.filter((c) => c.type === 'GROUP')
        assert.ok(marks.length >= 1 && marks.every((g) => /^(Arrowhead|Cross|Circle|Marker)/.test(g.name)), marks.map((g) => g.name).join())
        for (const g of marks) assert.ok(g.children.every((c) => c.type === 'VECTOR' && c.name === 'Marker Path'))
        const badge = m.children.find((c) => c.type === 'FRAME')
        assert.equal(badge.name, `Badge ${n}`)
        assert.equal(kind(badge), 'Sequence Badge')
        assert.equal(badge.layoutMode, 'HORIZONTAL')
        assert.equal(badge.primaryAxisSizingMode, 'FIXED')
        assert.equal(badge.counterAxisSizingMode, 'FIXED')
        assert.ok(near(badge.width, 24) && near(badge.height, 24))
        assert.ok(near(badge.cornerRadius, badge.width / 2, 0.01), 'circle')
        assert.equal(badge.fills.length, 1)
        assert.equal(badge.children.length, 1, 'the number is INSIDE its badge')
        assert.equal(badge.children[0].type, 'TEXT')
        assert.equal(badge.children[0].characters, n)
        assert.equal(badge.children[0].textAlignHorizontal, 'CENTER')
        assert.equal(badge.primaryAxisAlignItems, 'CENTER')
        assert.equal(badge.counterAxisAlignItems, 'CENTER')
        assert.match(m.name, /^Message \d+: .+ \(.+ → .+\)$/)
        assert.equal(m.pluginData['mermapix:from'] && m.pluginData['mermapix:to'] && true, true)
      }
      // no number text is left loose anywhere
      const loose = all(root, (n) => n.type === 'TEXT' && /^\d{1,3}$/.test(n.characters.trim()) && !(n.parent.type === 'FRAME' && kind(n.parent) === 'Sequence Badge'))
      assert.equal(loose.length, 0, 'numbers only inside badges')
    })

    test(`${tag} message endpoints are resolved by x position (direction follows the path)`, async () => {
      const { root, truth } = await load(example, theme)
      const names = new Map(all(root, (n) => n.type === 'FRAME' && kind(n) === 'Participant' && /\(top\)$/.test(n.name)).map((f) => [Math.round(rel(f, root).x + f.width / 2), f.pluginData['mermapix:participant']]))
      const actors = all(root, (n) => n.type === 'FRAME' && kind(n) === 'Actor' && /\(top\)$/.test(n.name)).map((f) => [Math.round(rel(f, root).x + f.width / 2 + 0), f.pluginData['mermapix:participant']])
      const xs = [...truth.lifelines.map((l) => l.b.x)]
      const nameAtX = (x) => {
        const cands = [...names, ...actors]
        let best = null
        for (const [cx, nm] of cands) if (!best || Math.abs(cx - x) < Math.abs(best[0] - x)) best = [cx, nm]
        return best[1]
      }
      const msgs = all(root, (n) => n.type === 'GROUP' && /^Message \d+/.test(n.name))
      for (const m of msgs) {
        const line = m.children.find((c) => c.type === 'VECTOR')
        const b = rel(line, root)
        const data = line.vectorPaths[0].data
        const nums = data.match(/-?\d+(\.\d+)?/g).map(Number)
        const sx = b.x + nums[0], ex = b.x + nums[nums.length - 2]
        const near_ = (x) => xs.reduce((a, c) => (Math.abs(c - x) < Math.abs(a - x) ? c : a))
        const want = { from: nameAtX(near_(sx)), to: nameAtX(near_(ex)) }
        assert.equal(m.pluginData['mermapix:from'], want.from, m.name)
        assert.equal(m.pluginData['mermapix:to'], want.to, m.name)
        assert.ok(m.name.endsWith(`(${want.from} → ${want.to})`), m.name)
      }
      if (full) {
        const byN = (n) => msgs.find((m) => m.name.startsWith(`Message ${n}:`))
        assert.equal(byN(1).name, 'Message 1: Open cart (Customer → Web App)')
        assert.equal(byN(3).name, 'Message 3: Validate stock (API → API)', 'self message')
        assert.ok(byN(3).children.find((c) => c.type === 'VECTOR').vectorPaths[0].data.includes(' C '), 'loop-back stays a curve')
        assert.equal(byN(5).name, 'Message 5: order_id (Database → API)', 'reply direction follows the path')
        assert.equal(byN(11).name, 'Message 11: Retry notice (API → Web App)')
        assert.ok(byN(11).children.some((c) => c.type === 'GROUP' && /^Cross/.test(c.name)), 'cross arrow')
        assert.ok(byN(6).children.some((c) => c.type === 'GROUP' && /^Arrowhead/.test(c.name)), 'async arrow')
        assert.equal(byN(5).children.find((c) => c.type === 'VECTOR').dashPattern.join(), '3,3', 'dotted reply keeps its dash')
      }
    })

    test(`${tag} zero-drop: every text survives exactly once, none duplicated`, async () => {
      const { root, before } = await load(example, theme)
      const lines = (tree) => all(tree, (n) => n.type === 'TEXT' && n.characters.trim()).flatMap((t) => t.characters.trim().split('\n').map((s) => s.trim())).sort()
      assert.deepEqual(lines(root), lines(before))
    })

    test(`${tag} no generic or raw Mermaid layer names remain`, async () => {
      const { root } = await load(example, theme)
      const bad = all(root, (n) => n !== root && (/^(Vector|Group|Frame|Rectangle|Text|Shape|Connector)$/.test(n.name) || /mermaid|^root-\d|^actor\d|^actor-man|inlined-marker|^$/.test(n.name)))
      assert.deepEqual(bad.map((n) => `${n.type}:${n.name}`), [])
    })

    test(`${tag} top-level structure follows Mermaid's paint order`, async () => {
      const { root } = await load(example, theme)
      const names = root.children.map((c) => c.name)
      const order = ['Participants (bottom)', 'Lifelines', 'Participants (top)', 'Actors', 'Activations', 'Notes', 'Blocks', 'Messages']
      const rest = names.filter((n) => !n.startsWith('Highlight: '))
      assert.deepEqual(rest, order.filter((n) => rest.includes(n)), 'strata order')
      assert.ok(rest.length >= 7)
      assert.equal(names.filter((n) => n.startsWith('Highlight: ')).length, full ? 1 : 0)
      if (full) assert.ok(names[0].startsWith('Highlight: '), 'highlight is the very first (bottom) layer')
      assert.equal(root.children.filter((c) => c.type === 'GROUP').length, rest.length)
      // nothing but the strata groups (+highlights) at the root
      assert.deepEqual(root.children.filter((c) => c.type !== 'GROUP' && !c.name.startsWith('Highlight: ')), [])
    })

    test(`${tag} paint order is preserved for every pair of overlapping pieces (before vs after)`, async (t) => {
      const { root, before } = await load(example, theme)
      const probes = zProbes(before, root)
      assert.ok(probes.length > 60, `probes ${probes.length}`)
      const inflate = (b, w) => ({ x: b.x - w / 2, y: b.y - w / 2, width: b.width + w, height: b.height + w })
      const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.05 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.05
      let pairs = 0
      const bad = []
      for (let i = 0; i < probes.length; i++) {
        for (let j = i + 1; j < probes.length; j++) {
          const p = probes[i], q = probes[j]
          if (!overlap(inflate(p.b, p.w), inflate(q.b, q.w))) continue
          pairs++
          if (Math.sign(p.zb - q.zb) !== Math.sign(p.za - q.za)) bad.push(`${p.label} / ${q.label}`)
        }
      }
      t.diagnostic(`${probes.length} probes, ${pairs} overlapping pairs checked`)
      assert.ok(pairs > 20, `overlapping pairs ${pairs}`)
      assert.deepEqual(bad, [])
    })
  }
}

// ---------------------------------------------------------------- variants: no autonumber, box / created participant / icon participant

async function loadPlain(example) {
  const r = await runFixture(example, 'dark')
  return { ...r, before: importSvg({ ids: 0 }, r.svgSeen) }
}

function assertPaintOrder(before, root) {
  const probes = zProbes(before, root)
  const inflate = (b, w) => ({ x: b.x - w / 2, y: b.y - w / 2, width: b.width + w, height: b.height + w })
  const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.05 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.05
  const bad = []
  for (let i = 0; i < probes.length; i++) for (let j = i + 1; j < probes.length; j++) {
    const p = probes[i], q = probes[j]
    if (overlap(inflate(p.b, p.w), inflate(q.b, q.w)) && Math.sign(p.zb - q.zb) !== Math.sign(p.za - q.za)) bad.push(`${p.label} / ${q.label}`)
  }
  assert.deepEqual(bad, [])
}

const textLines = (tree) => all(tree, (n) => n.type === 'TEXT' && n.characters.trim()).flatMap((t) => t.characters.trim().split('\n').map((s) => s.trim())).sort()

test('[sequence-plain/dark] without autonumber messages are numbered by order, multi-line labels keep every line', async () => {
  const { root, before } = await loadPlain('8-case-sequence-plain')
  const msgs = all(root, (n) => n.type === 'GROUP' && /^Message /.test(n.name))
  assert.deepEqual(msgs.map((m) => m.name), ['Message 1: Hello (Alice → Bob)', 'Message 2: Hi back on two lines (Bob → Alice)'])
  assert.equal(all(root, (n) => n.type === 'FRAME' && kind(n) === 'Sequence Badge').length, 0, 'no badge without autonumber')
  assert.equal(msgs[1].children.filter((c) => c.type === 'TEXT').length, 2, 'two label lines')
  assert.deepEqual(textLines(root), textLines(before))
  const notes = all(root, (n) => n.type === 'FRAME' && kind(n) === 'Note')
  assert.deepEqual(notes.map((n) => n.name), ['Note: Thinking'])
  assertPaintOrder(before, root)
})

test('[sequence-extras/dark] box, created participant and icon participant degrade gracefully (nothing dropped, nothing on top of lifelines)', async () => {
  const { root, before } = await loadPlain('8-case-sequence-extras')
  assert.deepEqual(textLines(root), textLines(before), 'zero-drop')
  const group = root.children[0]
  assert.equal(group.name, 'Participant Group: Team', 'the participant box is the bottom-most layer')
  assert.equal(group.type, 'FRAME')
  assert.equal(group.children.length, 1)
  const lls = all(root, (n) => n.type === 'VECTOR' && n.name.startsWith('Lifeline')).map((n) => n.name).sort()
  assert.deepEqual(lls, ['Lifeline: A', 'Lifeline: B', 'Lifeline: C', 'Lifeline: D'], 'short lifeline of the created/destroyed participant and the icon participant are named too')
  const parts = all(root, (n) => n.type === 'FRAME' && kind(n) === 'Participant').map((n) => n.name).sort()
  assert.deepEqual(parts, ['Participant: A (bottom)', 'Participant: A (top)', 'Participant: B (bottom)', 'Participant: B (top)', 'Participant: C (bottom)', 'Participant: C (top)'])
  const msgs = all(root, (n) => n.type === 'GROUP' && /^Message /.test(n.name)).map((m) => m.name)
  assert.deepEqual(msgs, ['Message 1: one (A → B)', 'Message 2: two (B → D)', 'Message 3: new (A → C)', 'Message 4: bye (C → A)'], 'icon strokes without arrow/label are not mistaken for messages')
  assertPaintOrder(before, root)
})

// ---------------------------------------------------------------- z-order probes

/**
 * Pairs every painted piece of the raw import (VECTOR / TEXT) with its counterpart after conversion
 * (same text / same path + bounds; merged rects <-> the FRAME that carries their paint) and returns
 * the pre-order paint index on both sides plus the bounds, so overlapping pairs can be compared.
 */
function zProbes(before, after) {
  const order = (tree) => { const m = new Map(); let i = 0; walk(tree, (n) => m.set(n, i++)); return m }
  const zb = order(before), za = order(after)
  const painted = (n) => n.type === 'FRAME' && (n.fills.some((f) => f.visible !== false) || n.strokes.length > 0)
  const aVectors = all(after, (n) => n.type === 'VECTOR' && (n.width > 0 || n.height > 0))
  const aTexts = all(after, (n) => n.type === 'TEXT' && n.characters.trim())
  const aFrames = all(after, (n) => painted(n) && n !== after)
  const used = new Set()
  const probes = []
  const take = (list, pred) => { const m = list.find((x) => !used.has(x) && pred(x)); if (m) used.add(m); return m }
  for (const v of all(before, (n) => n.type === 'VECTOR' && (n.width > 0 || n.height > 0))) {
    const b = rel(v, before)
    const same = take(aVectors, (x) => x.vectorPaths[0].data === v.vectorPaths[0].data && sameRect(rel(x, after), b, 0.05))
    const frame = same ? null : aFrames.find((f) => sameRect(rel(f, after), b, 0.05) && (v.fills.length > 0 || v.strokes.length > 0) && !(v.width < 0.01 || v.height < 0.01))
    const target = same || frame
    if (!target) continue // merged into a block border (the 4 lines)
    probes.push({ label: `${v.name}@${Math.round(b.x)},${Math.round(b.y)}`, b, w: Number(v.strokeWeight) || 0, zb: zb.get(v), za: za.get(target) })
  }
  for (const t of all(before, (n) => n.type === 'TEXT' && n.characters.trim())) {
    const b = rel(t, before)
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    const s = t.characters.trim()
    const hit = aTexts.filter((x) => x.characters.split('\n').map((l) => l.trim()).includes(s))
      .map((x) => { const r = rel(x, after); return { x, d: Math.hypot(r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y) } })
      .sort((p, q) => p.d - q.d)[0]
    if (!hit || hit.d > 14) continue
    probes.push({ label: `"${s}"`, b, w: 0, zb: zb.get(t), za: za.get(hit.x) })
  }
  return probes
}
