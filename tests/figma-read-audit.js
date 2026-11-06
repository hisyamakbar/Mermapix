// Reads the results written by the Mermapix Test Runner (plugin-dev/, Phase 10.2).
//
// Paste-ready body for the Figma MCP `use_figma` tool (plain JS, top-level await/return, read-only,
// well under the 50KB code limit). It returns a compact object:
//   { run, totals, problems: [...], clean: [...], perDiagram?: {...} }
// - run        the root-level `lastAudit` summary (page name/id, totals) written when the run finished
// - problems   one line per diagram with issues or errors (issue labels + key numbers)
// - clean      keys of diagrams without issues
// - perDiagram (when FULL=true) the full per-diagram audit JSON read from each diagram root's
//              shared plugin data ("mermapix"/"audit"), for the diagrams listed in DETAIL (or all problems)
// Metrics: duplicateStacks, looseShapes, unconvertedTables, overflowingText, unnamedLayers (info only),
// contentOverflow (px outside the root frame), textsLost (SVG <text> count - TEXT nodes), blackBoxes.

const FULL = false // set true to include the full audit of every problem diagram
const DETAIL = [] // or list keys like ["37-treemap-budget|light"] to read only those in full

const NS = 'mermapix'
const raw = figma.root.getSharedPluginData(NS, 'lastAudit')
if (!raw) return { error: 'No lastAudit found. Run the Mermapix Test Runner plugin first (Run all).' }
const last = JSON.parse(raw)

const problems = []
const clean = []
for (const e of last.entries) {
  if (e.ok) {
    clean.push(e.key)
    continue
  }
  const m = e.metrics || {}
  problems.push({
    key: e.key,
    nodeId: e.nodeId,
    size: e.size,
    issues: e.issues,
    error: e.error,
    overflowPx: e.contentOverflow,
    texts: m.textsExpected == null ? undefined : `${m.textsFound}/${m.textsExpected}`,
    tables: e.unconvertedTables,
    blackBoxes: e.blackBoxes,
  })
}

const out = { run: { pageName: last.pageName, pageId: last.pageId, finishedAt: last.finishedAt, totals: last.totals }, problems, clean }

if (FULL || DETAIL.length) {
  const want = new Set(DETAIL.length ? DETAIL : problems.map((p) => p.key))
  const page = await figma.getNodeByIdAsync(last.pageId)
  if (page) {
    await page.loadAsync()
    out.perDiagram = {}
    for (const section of page.children) {
      if (section.type !== 'SECTION') continue
      for (const node of section.children) {
        if (node.type !== 'FRAME') continue
        const a = node.getSharedPluginData(NS, 'audit')
        if (!a) continue
        const j = JSON.parse(a)
        const key = `${j.fixture}|${j.theme}`
        if (want.has(key)) out.perDiagram[key] = j
      }
    }
  }
}
return out
