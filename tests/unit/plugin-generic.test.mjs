// Phase 8.5 generic fallback: one smoke test per surveyed Mermaid diagram type (dark + light) on the real
// payload SVGs, plus the gate that keeps it away from ERD / flowchart / sequence / class / state output.
// Real built plugin/code.js through the mock Figma. Run `pnpm build:plugin` after changing plugin/src.
import test from 'node:test'
import assert from 'node:assert/strict'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { importSvg } from '../plugin-mock/svg-import.mjs'
import { runFixture, runSurvey, SURVEY_TYPES, EXAMPLES, FLOW_EXAMPLES } from '../plugin-mock/run-fixture.mjs'
import { metrics, relBounds, isGenericName } from '../plugin-mock/survey-metrics.mjs'
import { diagramTypeFromSvg } from '../../plugin/src/genericGeometry.ts'

const THEMES = ['dark', 'light']
// Types that got a dedicated converter after 8.5 (the generic fallback must now stay away from them): treemap (9.2).
const DEDICATED = new Set(['treemap'])
const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol
const rectKey = (b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`
const plain = (n) => JSON.parse(JSON.stringify(n, (k, v) => (k === 'parent' || k === '_env' ? undefined : v)))

test('the survey covers every type that rendered (24 payload pairs here + class and state with their own tests = 26)', () => {
  assert.ok(SURVEY_TYPES.length >= 24, SURVEY_TYPES.join(','))
})

for (const theme of THEMES) {
  for (const type of SURVEY_TYPES) {
    test(`[generic/${theme}] ${type}: no crash, zero-drop texts, no stacked pairs, marks keep their bounds, no generic names`, async () => {
      const run = await runSurvey(type, theme)
      const roleType = diagramTypeFromSvg(run.svg)
      assert.ok(roleType, 'payload carries aria-roledescription')
      const before = importSvg({ ids: 0 }, run.svgSeen)
      assert.ok(!run.log.some((l) => l[0] === 'notify' && l[1][1] && l[1][1].error), 'no error notification')

      if (DEDICATED.has(type)) {
        // dedicated converter (plugin-treemap.test.mjs): fallback skipped, nothing generic left, texts zero-drop
        assert.ok(!(run.root.pluginData && run.root.pluginData['mermapix:fallback']), 'fallback skipped on a dedicated type')
        const t = (tr) => all(tr, (n) => n.type === 'TEXT' && n.characters.trim()).map((n) => n.characters.trim()).sort()
        assert.deepEqual(t(run.root), t(before))
        assert.equal(metrics(plain(run.root)).generic, 0)
        return
      }

      // runs, and says so
      assert.ok(run.root.pluginData && run.root.pluginData['mermapix:fallback'], 'fallback ran on a type without a dedicated converter')

      // zero-drop texts
      const textsOf = (t) => all(t, (n) => n.type === 'TEXT' && n.characters.trim()).map((n) => n.characters.trim()).sort()
      assert.deepEqual(textsOf(run.root), textsOf(before))
      assert.equal(all(run.root, (n) => n.type === 'TEXT' && !n.characters.trim()).length, 0)

      // no stacked identical-bounds vector pairs left
      const after = metrics(plain(run.root))
      const raw = metrics(plain(before))
      assert.equal(after.stacked, 0)

      // every mark (vector) is still there at the same bounds (as a vector or as the frame that absorbed it)
      const have = new Set()
      walk(run.root, (n) => { if (n !== run.root && (n.type === 'VECTOR' || n.type === 'FRAME')) have.add(rectKey(relBounds(n, run.root))) })
      for (const v of all(before, (n) => n.type === 'VECTOR' && (Math.round(n.width) !== 0 || Math.round(n.height) !== 0))) {
        const b = relBounds(v, before)
        const hit = [...have].some((k) => { const [x, y, w, h] = k.split(',').map(Number); return near(x, b.x) && near(y, b.y) && near(w, b.width) && near(h, b.height) })
        assert.ok(hit, `${v.name} ${rectKey(b)} lost or moved`)
      }
      // chart / name-only types: texts are not touched either (frames only appear for edge label pills)
      const rawTexts = all(before, (n) => n.type === 'TEXT' && n.characters.trim()).map((n) => rectKey(relBounds(n, before)))
      const keptTexts = all(run.root, (n, p) => n.type === 'TEXT' && n.characters.trim() && p && (p.type !== 'FRAME' || p === run.root)).map((n) => rectKey(relBounds(n, run.root)))
      for (const k of keptTexts) assert.ok(rawTexts.includes(k), `text moved: ${k}`)

      // names: nothing the importer invented is left, and there was something to fix
      assert.ok(raw.generic > 0)
      assert.equal(after.generic, 0, 'no Vector / Group / Frame / mermaid-* names')
      assert.ok(after.generic < raw.generic)
      assert.equal(all(run.root, (n) => n.type === 'VECTOR' && n.name === 'Vector').length, 0)
    })
  }
}

test('chart types are never restyled or moved: pie / gantt / xychart / quadrant / sankey / packet / radar / venn / gitGraph / timeline / journey only get names', async () => {
  const CHARTS = ['pie', 'gantt', 'xychart', 'quadrant', 'sankey', 'packet', 'radar', 'venn', 'gitgraph', 'timeline', 'journey']
  for (const type of CHARTS) {
    for (const theme of THEMES) {
      const run = await runSurvey(type, theme)
      const before = importSvg({ ids: 0 }, run.svgSeen)
      const live = all(run.root, (n) => n.type === 'VECTOR' && !n.removed)
      const rawVecs = all(before, (n) => n.type === 'VECTOR' && (Math.round(n.width) !== 0 || Math.round(n.height) !== 0))
      assert.equal(live.length, rawVecs.length, `${type}: vector count`)
      // identical bounds AND paint, in document order
      const key = (n, root) => `${rectKey(relBounds(n, root))}|${JSON.stringify(n.fills)}|${JSON.stringify(n.strokes)}|${n.strokeWeight}`
      assert.deepEqual(live.map((n) => key(n, run.root)), rawVecs.map((n) => key(n, before)), `${type}/${theme}`)
      // only names changed: no frame except edge label pills
      const frames = all(run.root, (n) => n.type === 'FRAME' && n !== run.root)
      assert.ok(frames.every((f) => f.name.startsWith('Label: ')), `${type}: ${frames.map((f) => f.name)}`)
    }
  }
})

test('node diagrams: single-label cards and stacked pairs become frames, everything else keeps its geometry', async () => {
  const run = await runSurvey('block', 'dark')
  const frames = all(run.root, (n) => n.type === 'FRAME' && n !== run.root).map((f) => f.name).sort()
  assert.deepEqual(frames, ['Circle: DB', 'Hexagon: Cache', 'Rectangle: Frontend', 'Rectangle: Queue', 'Rounded Rectangle: API'])
  for (const f of all(run.root, (n) => n.type === 'FRAME' && n !== run.root)) {
    assert.equal(f.primaryAxisSizingMode, 'FIXED')
    assert.equal(f.counterAxisSizingMode, 'FIXED')
    assert.equal(f.children.filter((c) => c.type === 'TEXT').length, 1)
  }
  const req = await runSurvey('requirement', 'dark')
  const raw = importSvg({ ids: 0 }, req.svgSeen)
  const rawBoxes = all(raw, (n) => n.type === 'VECTOR' && n.width > 100 && n.height > 90)
  const boxFrames = all(req.root, (n) => n.type === 'FRAME' && n.name.startsWith('Rectangle: '))
  assert.equal(boxFrames.length, 3, 'three requirement/element boxes: the stacked fill+outline pairs merged into one frame each')
  assert.equal(rawBoxes.length, 6)
  for (const f of boxFrames) {
    assert.ok(f.fills.length && f.strokes.length)
    assert.equal(f.strokeWeight, 1.3)
    assert.equal(f.children.length, 0)
  }
})

test('dedicated diagram types are never touched by the fallback (gate)', async () => {
  const cases = []
  for (const theme of THEMES) {
    for (const ex of [...EXAMPLES, ...FLOW_EXAMPLES, '8-case-sequence-full', '9-case-class', '10-case-state', '37-case-treemap', '38-case-railroad', '39-case-railroad-ebnf']) cases.push([ex, theme])
  }
  for (const [ex, theme] of cases) {
    const run = await runFixture(ex, theme)
    assert.ok(!(run.root.pluginData && run.root.pluginData['mermapix:fallback']), `${ex}/${theme}: fallback must not run`)
  }
})

test('the swimlane type (flowchart nodes + one lane vector) only gets names', async () => {
  const run = await runSurvey('swimlane', 'dark')
  const frames = all(run.root, (n) => n.type === 'FRAME' && n.pluginData && n.pluginData['mermapix:node'] !== undefined)
  assert.equal(frames.length, 3)
  assert.equal(all(run.root, (n) => isGenericName(n.name) && n !== run.root).length, 0)
})
