// Mermapix Test Runner (developer-only) - Figma sandbox entry.
//
// The UI renders every tests/figma-fixtures/*.mmd in both themes through the production pipeline and posts
// each payload SVG here. We convert it with the SAME shared code as the production plugin
// (plugin/src/diagram.ts: prepareSvgForFigma -> createNodeFromSvg -> optimizeDiagramNodes, same fonts),
// put it in a labeled SECTION on a new "Test Run <date>" page, audit it, and finally lay everything out
// in a grid and write the audit where the agent can read it via Figma MCP `use_figma`.
//
// Bundled into plugin-dev/code.js by scripts/build-test-runner.mjs.

import { createDiagramNode, loadDiagramFonts } from '../../plugin/src/diagram.ts'
import {
  AUDIT_NS,
  auditDiagram,
  countSvgTexts,
  summarizeAudit,
  type AuditMeta,
  type DiagramAudit,
} from './auditCore.js'
import { diagramLabel, formatRunName, planGrid } from './gridLayout.ts'
import type { DiagramReport, SandboxToUi, UiToSandbox } from './protocol.ts'

const SECTION_PAD = 48
const GRID_GAP_X = 160
const GRID_GAP_Y = 160
/** setSharedPluginData allows ~100 kB per namespace per node; stay well under. */
const MAX_JSON = 90_000

interface RunEntry {
  report: DiagramReport
  row: number
  col: number
  section: any
  node: any
  audit?: DiagramAudit
}

interface Run {
  page: any
  pageName: string
  startedAt: string
  total: number
  entries: RunEntry[]
}

let run: Run | null = null

figma.showUI(__html__, { width: 760, height: 780, themeColors: true })

function post(msg: SandboxToUi): void {
  figma.ui.postMessage(msg)
}

function errMessage(err: unknown): string {
  return err && typeof (err as any).message === 'string' ? (err as any).message : String(err)
}

function metricsOf(a: DiagramAudit): NonNullable<DiagramReport['metrics']> {
  return {
    duplicateStacks: a.duplicateStacks,
    looseShapes: a.looseShapes,
    unconvertedTables: a.unconvertedTables.length,
    overflowingText: a.overflowingText.length,
    unnamedLayers: a.unnamedLayers,
    contentOverflow: a.contentOverflow.count,
    textsExpected: a.textsExpected,
    textsFound: a.counts.TEXT,
    textsLost: a.textsLost,
    blackBoxes: a.blackBoxes ? a.blackBoxes.count : null,
  }
}

function resizeSection(section: any, width: number, height: number): void {
  if (typeof section.resizeWithoutConstraints === 'function') section.resizeWithoutConstraints(width, height)
  else section.resize(width, height)
}

async function beginRun(msg: Extract<UiToSandbox, { type: 'run-begin' }>): Promise<void> {
  await loadDiagramFonts()
  const startedAt = new Date()
  const page = figma.createPage()
  page.name = formatRunName(startedAt)
  // documentAccess is dynamic-page, so the page switch is async.
  await figma.setCurrentPageAsync(page)
  run = { page, pageName: page.name, startedAt: startedAt.toISOString(), total: msg.total, entries: [] }
  post({ type: 'run-ready', pageName: page.name, pageId: page.id })
}

function insertDiagram(msg: Extract<UiToSandbox, { type: 'insert' }>): DiagramReport {
  if (!run) throw new Error('No active run (run-begin missing)')
  const label = diagramLabel(msg.fixture, msg.theme)
  const report: DiagramReport = { key: msg.key, fixture: msg.fixture, theme: msg.theme, ok: false, issues: [] }
  const section = figma.createSection()
  section.name = label
  const entry: RunEntry = { report, row: msg.row, col: msg.col, section, node: null }
  run.entries.push(entry)
  report.sectionId = section.id

  const known = new Set<any>(figma.currentPage.children)
  try {
    if (msg.renderError || !msg.svg) throw new Error(msg.renderError || 'Render produced no SVG')
    const node = createDiagramNode({ svg: msg.svg, name: label, themeVariables: msg.themeVariables })
    entry.node = node
    section.appendChild(node)
    node.x = SECTION_PAD
    node.y = SECTION_PAD
    resizeSection(section, Math.ceil(node.width) + SECTION_PAD * 2, Math.ceil(node.height) + SECTION_PAD * 2)

    const meta: AuditMeta = { fixture: msg.fixture, theme: msg.theme, svgTextCount: countSvgTexts(msg.svg) }
    node.setSharedPluginData(AUDIT_NS, 'meta', JSON.stringify(meta))
    report.nodeId = node.id
    try {
      const audit = auditDiagram(node, meta)
      const summary = summarizeAudit(audit)
      entry.audit = audit
      report.ok = summary.ok
      report.issues = summary.issues
      report.size = audit.size
      report.metrics = metricsOf(audit)
      node.setSharedPluginData(
        AUDIT_NS,
        'audit',
        JSON.stringify({ fixture: msg.fixture, theme: msg.theme, ok: summary.ok, issues: summary.issues, ...audit }),
      )
    } catch (auditErr) {
      // The diagram exists; only its audit failed.
      report.ok = false
      report.error = 'audit failed: ' + errMessage(auditErr)
      report.issues = ['auditError']
    }
  } catch (err) {
    report.ok = false
    report.error = errMessage(err)
    report.issues = ['error']
    // Keep a labeled placeholder in the grid so a failing fixture is visible, not silently missing.
    section.name = label + ' (FAILED)'
    let w = 480
    let h = 160
    // A half-converted node left on the page by the failed insert is moved into the section for inspection.
    for (const orphan of figma.currentPage.children.filter((c: any) => !known.has(c))) {
      try {
        section.appendChild(orphan)
        orphan.x = SECTION_PAD
        orphan.y = SECTION_PAD
        w = Math.max(w, Math.ceil(orphan.width) + SECTION_PAD * 2)
        h = Math.max(h, Math.ceil(orphan.height) + SECTION_PAD * 2)
      } catch {}
    }
    resizeSection(section, w, h)
  }
  try {
    section.setSharedPluginData(
      AUDIT_NS,
      'audit',
      JSON.stringify({ fixture: msg.fixture, theme: msg.theme, ok: report.ok, error: report.error, issues: report.issues }),
    )
  } catch {}
  return report
}

function compactEntry(e: RunEntry, withMetrics: boolean) {
  const r = e.report
  const out: Record<string, unknown> = {
    key: r.key,
    fixture: r.fixture,
    theme: r.theme,
    ok: r.ok,
    issues: r.issues,
    nodeId: r.nodeId,
    sectionId: r.sectionId,
  }
  if (r.error) out.error = r.error
  if (withMetrics) {
    out.size = r.size
    out.metrics = r.metrics
    if (e.audit) {
      out.contentOverflow = e.audit.contentOverflow.px
      if (e.audit.unconvertedTables.length) out.unconvertedTables = e.audit.unconvertedTables.slice(0, 5)
      if (e.audit.blackBoxes && e.audit.blackBoxes.count) out.blackBoxes = e.audit.blackBoxes.examples.slice(0, 3)
    }
  }
  return out
}

function summaryText(r: Run, totals: { diagrams: number; failed: number; withIssues: number }): string {
  const lines = [
    `Mermapix Test Run - ${r.pageName}`,
    `${totals.diagrams} diagrams, ${totals.failed} failed, ${totals.withIssues} with issues, ${totals.diagrams - totals.failed - totals.withIssues} clean`,
    'Full data: figma.root.getSharedPluginData("mermapix","lastAudit") and per-diagram getSharedPluginData("mermapix","audit")',
    '',
  ]
  for (const e of [...r.entries].sort((a, b) => a.row - b.row || a.col - b.col)) {
    if (e.report.ok) continue
    lines.push(`${diagramLabel(e.report.fixture, e.report.theme)}: ${e.report.error ?? e.report.issues.join(' ')}`)
  }
  if (lines.length === 4) lines.push('No issues.')
  return lines.join('\n')
}

async function endRun(): Promise<void> {
  if (!run) throw new Error('No active run (run-begin missing)')
  const r = run

  // 1. Grid: one row per fixture, themes side by side; columns/rows sized to the largest diagram.
  const plan = planGrid(
    r.entries.map((e) => ({ id: e.report.key, row: e.row, col: e.col, width: e.section.width, height: e.section.height })),
    { gapX: GRID_GAP_X, gapY: GRID_GAP_Y },
  )
  for (const e of r.entries) {
    const p = plan.positions[e.report.key]
    e.section.x = p.x
    e.section.y = p.y
  }

  // 2. Results.
  const totals = {
    diagrams: r.entries.length,
    failed: r.entries.filter((e) => e.report.error).length,
    withIssues: r.entries.filter((e) => !e.report.error && !e.report.ok).length,
  }
  const build = (withMetrics: boolean) =>
    JSON.stringify({
      version: 1,
      pageName: r.pageName,
      pageId: r.page.id,
      startedAt: r.startedAt,
      finishedAt: new Date().toISOString(),
      totals,
      entries: r.entries
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((e) => compactEntry(e, withMetrics)),
    })
  let json = build(true)
  if (json.length > MAX_JSON) json = build(false)
  figma.root.setSharedPluginData(AUDIT_NS, 'lastAudit', json)
  r.page.setSharedPluginData(AUDIT_NS, 'lastAudit', json)

  // 3. Human-readable "Audit Summary" text above the grid.
  try {
    const text = figma.createText()
    text.name = 'Audit Summary'
    text.fontName = { family: 'Inter', style: 'Regular' }
    text.fontSize = 28
    text.characters = summaryText(r, totals)
    text.textAutoResize = 'HEIGHT'
    text.resize(2400, text.height)
    text.x = 0
    text.y = -text.height - GRID_GAP_Y
    r.page.appendChild(text)
  } catch (textErr) {
    // The JSON in shared plugin data is the contract; the text node is a convenience.
  }

  const entries = r.entries.map((e) => e.section)
  if (entries.length) figma.viewport.scrollAndZoomIntoView(entries.slice(0, 4))
  let fileKey: string | undefined
  try {
    fileKey = figma.fileKey || undefined
  } catch {}
  post({ type: 'run-done', pageName: r.pageName, pageId: r.page.id, fileKey, totals })
  run = null
}

function focusEntry(key: string): void {
  const e = run?.entries.find((x) => x.report.key === key)
  if (e) {
    figma.currentPage.selection = [e.section]
    figma.viewport.scrollAndZoomIntoView([e.section])
  }
}

// Handle messages strictly one at a time (the UI also waits for each reply).
let queue: Promise<void> = Promise.resolve()
figma.ui.onmessage = (msg: UiToSandbox) => {
  queue = queue.then(async () => {
    try {
      if (msg.type === 'run-begin') await beginRun(msg)
      else if (msg.type === 'insert') post({ type: 'inserted', report: insertDiagram(msg) })
      else if (msg.type === 'run-end') await endRun()
      else if (msg.type === 'focus') focusEntry(msg.key)
      else if (msg.type === 'close') figma.closePlugin()
    } catch (err) {
      post({ type: 'run-error', error: errMessage(err) })
    }
  })
}
