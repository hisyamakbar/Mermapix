// Developer test runner (plugin-dev/): pure helpers, shared audit module, and the sandbox bundle
// (plugin-dev/code.js) end to end against a mock Figma. Requires `pnpm build:test-runner` and `pnpm build:plugin` output.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { planGrid, formatRunName, filterFixtures, buildRunItems, diagramLabel } from '../../plugin-dev/src/gridLayout.ts'
import { auditDiagram, countSvgTexts, summarizeAudit, findDiagramRoots, isWrongThemeInk } from '../../plugin-dev/src/auditCore.js'
import { generate, OUT_PATH } from '../../scripts/gen-figma-audit.mjs'
import { serialize } from '../plugin-mock/figma-mock.mjs'
import { createDevRunner, runSession } from '../plugin-mock/dev-runner.mjs'
import { runFixture, FIXTURE_DIR, THEMES } from '../plugin-mock/run-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(here, '../..')
const svgOf = (name) => fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')

// ---------------------------------------------------------------- pure helpers

test('planGrid: aligned columns/rows, no overlap even with very large cells', () => {
  const cells = [
    { id: 'a', row: 0, col: 0, width: 300, height: 200 },
    { id: 'b', row: 0, col: 1, width: 5000, height: 100 },
    { id: 'c', row: 1, col: 0, width: 100, height: 9000 },
    { id: 'd', row: 1, col: 1, width: 400, height: 50 },
    { id: 'e', row: 2, col: 0, width: 10, height: 10 },
  ]
  const plan = planGrid(cells, { gapX: 100, gapY: 80 })
  assert.deepEqual(plan.colWidths, [300, 5000])
  assert.deepEqual(plan.rowHeights, [200, 9000, 10])
  assert.deepEqual(plan.positions.a, { x: 0, y: 0 })
  assert.deepEqual(plan.positions.b, { x: 400, y: 0 })
  assert.deepEqual(plan.positions.c, { x: 0, y: 280 })
  assert.deepEqual(plan.positions.e, { x: 0, y: 9360 })
  for (const p of cells) {
    for (const q of cells) {
      if (p.id >= q.id) continue
      const a = { ...plan.positions[p.id], w: p.width, h: p.height }
      const b = { ...plan.positions[q.id], w: q.width, h: q.height }
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      assert.ok(!overlap, `${p.id} overlaps ${q.id}`)
    }
  }
  assert.equal(plan.width, 5400)
  assert.equal(plan.height, 200 + 80 + 9000 + 80 + 10)
})

test('planGrid: sparse indexes and empty input', () => {
  assert.deepEqual(planGrid([], { gapX: 10, gapY: 10 }).positions, {})
  const plan = planGrid([{ id: 'x', row: 5, col: 3, width: 10, height: 10 }, { id: 'y', row: 9, col: 3, width: 10, height: 20 }], { gapX: 10, gapY: 7 })
  assert.deepEqual(plan.positions.x, { x: 0, y: 0 })
  assert.deepEqual(plan.positions.y, { x: 0, y: 17 })
})

test('formatRunName, diagramLabel, filterFixtures, buildRunItems', () => {
  assert.equal(formatRunName(new Date(2026, 10, 6, 9, 5)), 'Test Run 2026-11-06 09:05')
  assert.equal(diagramLabel('01-erd', 'dark'), '01-erd · dark')
  const names = ['01-erd', '02-flowchart', '20-survey-kanban', '37-treemap-budget']
  assert.deepEqual(filterFixtures(names, ''), names)
  assert.deepEqual(filterFixtures(names, 'ERD, kanban'), ['01-erd', '20-survey-kanban'])
  assert.deepEqual(filterFixtures(names, 'nope'), [])
  const items = buildRunItems(['a', 'b'], 'both')
  assert.deepEqual(items.map((i) => [i.fixture, i.theme, i.row, i.col]), [['a', 'dark', 0, 0], ['a', 'light', 0, 1], ['b', 'dark', 1, 0], ['b', 'light', 1, 1]])
  assert.deepEqual(buildRunItems(['a'], 'light').map((i) => [i.theme, i.col]), [['light', 0]])
})

// ---------------------------------------------------------------- shared audit module

test('tests/figma-audit.js is generated from plugin-dev/src/auditCore.js (no drift)', () => {
  assert.equal(fs.readFileSync(OUT_PATH, 'utf8'), generate(), 'run `node scripts/gen-figma-audit.mjs` (or pnpm build:test-runner)')
})

test('tests/figma-audit.js is standalone plain JS with top-level return', () => {
  const src = fs.readFileSync(OUT_PATH, 'utf8')
  assert.ok(!/^\s*(import|export)\s/m.test(src))
  assert.ok(/^return /m.test(src))
  assert.doesNotThrow(() => new Function('figma', src))
})

test('countSvgTexts counts non-empty <text> elements only', () => {
  assert.equal(countSvgTexts('<svg><text x="1"><tspan>A</tspan></text><text> </text><text>B</text><textPath/></svg>'), 2)
})

const frame = (name, x, y, w, h, extra = {}) => ({ type: 'FRAME', name, layoutMode: 'NONE', children: [], width: w, height: h, absoluteBoundingBox: { x, y, width: w, height: h }, ...extra })
const vec = (name, x, y, w, h, color) => ({ type: 'VECTOR', name, width: w, height: h, absoluteBoundingBox: { x, y, width: w, height: h }, fills: color ? [{ type: 'SOLID', color }] : [] })
function tree(root, ...kids) {
  for (const k of kids) { k.parent = root; root.children.push(k) }
  return root
}

test('auditDiagram: content overflow, lost texts and black boxes', () => {
  const root = frame('Root', 0, 0, 100, 100)
  const text = { type: 'TEXT', name: 'T', characters: 'x', width: 10, height: 10, absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } }
  tree(root, vec('Shape', 10, 10, 120, 50, { r: 0, g: 0, b: 0 }), text)
  const a = auditDiagram(root, { theme: 'light', svgTextCount: 3 })
  assert.equal(a.contentOverflow.count, 1)
  assert.deepEqual(a.contentOverflow.px, { left: 0, top: 0, right: 30, bottom: 0 })
  assert.equal(a.textsExpected, 3)
  assert.equal(a.textsLost, 2)
  assert.equal(a.blackBoxes.count, 1)
  assert.deepEqual(summarizeAudit(a).issues.sort(), ['blackBoxes:1', 'contentOverflow:1', 'looseShapes:1', 'textsLost:2'].sort())

  const dark = auditDiagram(root, { theme: 'dark', svgTextCount: 1 })
  assert.equal(dark.blackBoxes.count, 0, 'black on dark is fine')
  assert.equal(dark.textsLost, 0)

  const plain = auditDiagram(root)
  assert.equal(plain.blackBoxes, null)
  assert.equal(plain.textsLost, null)
  assert.equal(isWrongThemeInk({ r: 0.99, g: 1, b: 1 }, 'dark'), true)
  assert.equal(isWrongThemeInk({ r: 0.5, g: 0.5, b: 0.5 }, 'dark'), false)
})

test('auditDiagram: a small near-black vector (<25% of parent) is not a black box', () => {
  const root = frame('Root', 0, 0, 1000, 1000)
  tree(root, vec('Dot', 10, 10, 60, 60, { r: 0, g: 0, b: 0 }))
  assert.equal(auditDiagram(root, { theme: 'light' }).blackBoxes.count, 0)
})

test('paste-ready tests/figma-audit.js returns the same audits as the module (sections included)', () => {
  const page = { children: [] }
  const f1 = frame('Top', 0, 0, 50, 50)
  const f2 = frame('InSection', 0, 0, 50, 50)
  f2.getSharedPluginData = () => JSON.stringify({ theme: 'light', svgTextCount: 2 })
  tree(f2, vec('Box', 0, 0, 50, 50, { r: 0, g: 0, b: 0 }))
  page.children.push(f1, { type: 'SECTION', name: 's', children: [f2] })
  assert.deepEqual(findDiagramRoots(page).map((n) => n.name), ['Top', 'InSection'])
  const out = new Function('figma', fs.readFileSync(OUT_PATH, 'utf8'))({ currentPage: page })
  assert.equal(out.length, 2)
  const expected = auditDiagram(f2, { theme: 'light', svgTextCount: 2 })
  assert.deepEqual({ ...out[1], ok: undefined, issues: undefined }, { ...expected, ok: undefined, issues: undefined })
  assert.ok(out[1].issues.includes('blackBoxes:1') && out[1].issues.includes('textsLost:2'))
})

// ---------------------------------------------------------------- sandbox bundle on mock Figma

test('plugin-dev/code.js is a classic script and manifest is separate from production', () => {
  const src = fs.readFileSync(path.join(rootDir, 'plugin-dev/code.js'), 'utf8')
  assert.ok(!/^\s*(import|export)\s/m.test(src))
  const dev = JSON.parse(fs.readFileSync(path.join(rootDir, 'plugin-dev/manifest.json'), 'utf8'))
  const prod = JSON.parse(fs.readFileSync(path.join(rootDir, 'plugin/manifest.json'), 'utf8'))
  assert.notEqual(dev.id, prod.id)
  assert.equal(dev.id, 'mermapix-test-runner-dev')
  assert.equal(dev.main, 'code.js')
  assert.equal(dev.ui, 'ui.html')
  assert.equal(dev.documentAccess, 'dynamic-page')
  assert.doesNotThrow(() => new vm.Script(src))
})

const items = (name, svgDark, svgLight, row) => [
  { fixture: name, theme: 'dark', row, col: 0, svg: svgDark, themeVariables: THEMES.dark },
  { fixture: name, theme: 'light', row, col: 1, svg: svgLight, themeVariables: THEMES.light },
]

test('sandbox run: page, labeled sections in a non-overlapping grid, audit data, failures do not stop the run', async () => {
  const runner = createDevRunner()
  const session = await runSession(runner, [
    ...items('01-erd', svgOf('1-ex-erd.svg'), svgOf('1-ex-erd-light.svg'), 0),
    ...items('37-treemap', svgOf('37-case-treemap.svg'), svgOf('37-case-treemap-light.svg'), 1),
    { fixture: '98-broken', theme: 'dark', row: 2, col: 0, svg: `<svg>${runner.FAIL}</svg>`, themeVariables: THEMES.dark },
    { fixture: '99-parse-error', theme: 'light', row: 2, col: 1, renderError: 'render: Parse error on line 1' },
    ...items('02-flowchart', svgOf('2-ex-flowchart.svg'), svgOf('2-ex-flowchart-light.svg'), 3),
  ])

  // page
  const pages = runner.root.children
  assert.equal(pages.length, 2)
  const page = pages[1]
  assert.match(page.name, /^Test Run \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(runner.currentPage, page)
  assert.equal(session.begin.pageName, page.name)

  // sections, labeled
  const sections = page.children.filter((n) => n.type === 'SECTION')
  assert.equal(sections.length, 8)
  assert.ok(sections.some((s) => s.name === '01-erd · dark'))
  assert.ok(sections.some((s) => s.name === '98-broken · dark (FAILED)'))
  assert.ok(sections.some((s) => s.name === '99-parse-error · light (FAILED)'))

  // per-diagram reports: failures recorded, others carry metrics
  const byKey = Object.fromEntries(session.reports.map((r) => [r.key, r]))
  assert.match(byKey['98-broken|dark'].error, /cannot import SVG/)
  assert.equal(byKey['99-parse-error|light'].error, 'render: Parse error on line 1')
  assert.equal(byKey['01-erd|dark'].error, undefined)
  assert.ok(byKey['01-erd|dark'].metrics.textsFound > 0)
  assert.equal(byKey['01-erd|dark'].metrics.unconvertedTables, 0)

  // grid: sections do not overlap and sit side by side per row (dark left of light)
  for (const a of sections) {
    for (const b of sections) {
      if (a === b) continue
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      assert.ok(!overlap, `${a.name} overlaps ${b.name}`)
    }
  }
  const sec = (n) => sections.find((s) => s.name === n)
  assert.equal(sec('01-erd · dark').y, sec('01-erd · light').y)
  assert.ok(sec('01-erd · light').x >= sec('01-erd · dark').x + sec('01-erd · dark').width)
  assert.ok(sec('37-treemap · dark').y >= sec('01-erd · dark').y + sec('01-erd · dark').height)

  // diagram sits inside its section with padding, section fits it
  const erd = sec('01-erd · dark')
  const root = erd.children.find((c) => c.type === 'FRAME')
  assert.ok(root, 'diagram root is a FRAME in the section')
  assert.equal(root.name, '01-erd · dark')
  assert.ok(root.x >= 0 && root.y >= 0 && erd.width >= root.x + root.width && erd.height >= root.y + root.height)

  // shared plugin data: per-diagram audit + meta, root lastAudit
  const audit = JSON.parse(root.getSharedPluginData('mermapix', 'audit'))
  assert.equal(audit.fixture, '01-erd')
  assert.equal(audit.theme, 'dark')
  assert.ok(audit.counts.TEXT > 0 && 'duplicateStacks' in audit && 'contentOverflow' in audit && 'textsLost' in audit)
  assert.equal(JSON.parse(root.getSharedPluginData('mermapix', 'meta')).svgTextCount, countSvgTexts(svgOf('1-ex-erd.svg')))
  const failed = JSON.parse(sec('98-broken · dark (FAILED)').getSharedPluginData('mermapix', 'audit'))
  assert.equal(failed.ok, false)
  assert.match(failed.error, /cannot import/)

  const last = JSON.parse(runner.root.getSharedPluginData('mermapix', 'lastAudit'))
  assert.equal(last.pageName, page.name)
  assert.equal(last.totals.diagrams, 8)
  assert.equal(last.totals.failed, 2)
  assert.equal(last.entries.length, 8)
  assert.deepEqual(last.entries.map((e) => e.fixture), ['01-erd', '01-erd', '37-treemap', '37-treemap', '98-broken', '99-parse-error', '02-flowchart', '02-flowchart'])
  assert.equal(page.getSharedPluginData('mermapix', 'lastAudit'), runner.root.getSharedPluginData('mermapix', 'lastAudit'))
  assert.equal(session.done.totals.failed, 2)

  // Audit Summary text node
  const summary = page.children.find((n) => n.type === 'TEXT' && n.name === 'Audit Summary')
  assert.ok(summary)
  assert.match(summary.characters, /98-broken · dark: mock: cannot import SVG/)
  assert.ok(summary.y < 0)
})

test('sandbox conversion is the production conversion (same layer tree as plugin/code.js)', async () => {
  const runner = createDevRunner()
  await runSession(runner, items('02-flowchart', svgOf('2-ex-flowchart.svg'), svgOf('2-ex-flowchart-light.svg'), 0).slice(0, 1))
  const page = runner.root.children[1]
  const devRoot = page.children.find((n) => n.type === 'SECTION').children[0]
  const prod = await runFixture('2-ex-flowchart', 'dark')
  // JSON round trip: both trees were built inside different vm realms.
  const strip = (n) => { const { x, y, name, shared, ...rest } = JSON.parse(JSON.stringify(n)); return rest }
  assert.deepEqual(strip(serialize(devRoot)), strip(prod.tree))
})

test('tests/figma-read-audit.js reads lastAudit and per-diagram data compactly', async () => {
  const runner = createDevRunner()
  await runSession(runner, [
    ...items('37-treemap', svgOf('37-case-treemap.svg'), svgOf('37-case-treemap-light.svg'), 0),
    { fixture: '99-parse-error', theme: 'light', row: 1, col: 0, renderError: 'render: boom' },
  ])
  const src = fs.readFileSync(path.join(rootDir, 'tests/figma-read-audit.js'), 'utf8')
  assert.ok(src.length < 50_000)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const page = runner.root.children[1]
  const fig = {
    root: runner.root,
    getNodeByIdAsync: async (id) => (id === page.id ? Object.assign(page, { loadAsync: async () => {} }) : null),
  }
  const out = JSON.parse(JSON.stringify(await new AsyncFunction('figma', src)(fig)))
  assert.equal(out.run.pageName, page.name)
  assert.equal(out.run.totals.diagrams, 3)
  assert.equal(out.problems.find((p) => p.key === '99-parse-error|light').error, 'render: boom')
  assert.ok(out.problems.some((p) => p.key === '37-treemap|dark' && p.issues.some((i) => i.startsWith('contentOverflow'))))
  assert.equal(out.perDiagram, undefined)
  const full = JSON.parse(JSON.stringify(await new AsyncFunction('figma', src.replace('const FULL = false', 'const FULL = true'))(fig)))
  assert.ok(full.perDiagram['37-treemap|dark'].counts.TEXT > 0)
  assert.equal(full.perDiagram['99-parse-error|light'], undefined, 'failed diagram has no frame audit')

  const none = await new AsyncFunction('figma', src)({ root: createDevRunner().root })
  assert.match(none.error, /No lastAudit/)
})

test('run-end without run-begin reports an error instead of crashing', async () => {
  const runner = createDevRunner()
  const m = await runner.request({ type: 'run-end' }, 'run-done')
  assert.equal(m.type, 'run-error')
})
