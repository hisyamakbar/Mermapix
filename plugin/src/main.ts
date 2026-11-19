// Figma Plugin sandbox entry for Mermapix.
// Receives SVG from ui.html, inlines missing SVG markers (crow's foot, arrows),
// and creates native vector/text nodes on canvas with column-based Auto Layout.
// Bundled with all ./*.ts modules into plugin/code.js by scripts/build-plugin.mjs.
// The conversion itself lives in ./diagram.ts (shared with the developer test runner).
// Source-linked diagrams (Phase 11): ./sourceLink.ts stores/finds the Mermaid source on the diagram root,
// ./update.ts regenerates a diagram in place. Message shapes are in ./protocol.ts.
// Phase 12: ./snapshot.ts stamps every layer at build time and reports what was edited in Figma;
// while a diagram is being edited the report is repeated after every change on the canvas (watch-diagram).

import { createDiagramNode, loadDiagramFonts } from './diagram.ts'
import { DIAGRAM_KEY, decodeDiagram, editability, findDiagramRoot, readDiagram, stampDiagram, encodeDiagram } from './sourceLink.ts'
import { canTransplant, pageOf, transplantDiagram } from './update.ts'
import { diagramChanges, isClean } from './snapshot.ts'
import type { DiagramChanges, LinkedDiagram, SandboxToUi, UiToSandbox } from './protocol.ts'

figma.showUI(__html__, {
  width: 500,
  height: 680,
  themeColors: true,
})

function post(msg: SandboxToUi): void {
  figma.ui.postMessage(msg)
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Updates at least this slow log where their time went. */
const SLOW_LOG_MS = 500
/** After an update, canvas events for this long are the update's own changes: the watch skips them. */
const SELF_CHANGE_MS = 400
let ignoreWatchUntil = 0

/** The linked diagram that contains the first selected layer, or null. */
function selectedDiagram(): LinkedDiagram | null {
  try {
    const first = figma.currentPage.selection[0]
    if (!first) return null
    const root = findDiagramRoot(first)
    const stored = root && readDiagram(root)
    if (!root || !stored) return null
    const e = editability(root)
    const out: LinkedDiagram = {
      id: root.id,
      name: root.name,
      source: stored.source,
      theme: stored.theme,
      editable: e.editable,
    }
    if (!e.editable) out.reason = e.reason
    return out
  } catch {
    return null
  }
}

function postSelection(autoEdit?: boolean): void {
  const msg: SandboxToUi = { type: 'selection', diagram: selectedDiagram() }
  if (autoEdit) msg.autoEdit = true
  post(msg)
}

figma.on('selectionchange', () => postSelection())
figma.on('currentpagechange', () => postSelection())

// `autoEdit` goes out once: in the answer to the first request-selection of a run started from the relaunch button.
let autoEditPending = figma.command === 'edit'

async function createFromSvg(msg: Extract<UiToSandbox, { type: 'create-svg' }>): Promise<void> {
  try {
    await loadDiagramFonts()
    const node = createDiagramNode({
      svg: msg.svg,
      name: msg.name,
      themeVariables: msg.themeVariables,
      source: msg.source,
      theme: msg.theme,
    })

    // Center in current user viewport
    const center = figma.viewport.center
    node.x = Math.round(center.x - node.width / 2)
    node.y = Math.round(center.y - node.height / 2)

    figma.currentPage.selection = [node]
    figma.viewport.scrollAndZoomIntoView([node])
    const linked = typeof msg.source === 'string' && readDiagram(node) !== null
    if (typeof msg.source === 'string' && !linked) {
      figma.notify('Mermapix diagram added, but its source is too large to store: it cannot be re-edited from Figma', { timeout: 6000 })
    } else {
      figma.notify('Mermapix diagram added to canvas')
    }
    // The UI shows "Added!" only once the sandbox confirms the insert.
    post({ type: 'inserted', linked })
  } catch (err) {
    const message = errorMessage(err)
    figma.notify('Could not create the diagram: ' + message, { error: true })
    post({ type: 'insert-failed', message })
  }
}

async function updateFromSvg(msg: Extract<UiToSandbox, { type: 'update-svg' }>): Promise<void> {
  const id = msg.targetId
  const started = Date.now()
  // Where the time goes, logged to the plugin console when an update is slow (Plugins > Development > Show console).
  const phases: Record<string, number> = {}
  let mark = started
  const lap = (name: string) => {
    const now = Date.now()
    phases[name] = now - mark
    mark = now
  }
  // A live update (Phase 13) sent while the user types: no toast, the selection is left alone. The UI shows errors itself.
  const quiet = msg.quiet === true
  const fail = (reason: 'missing' | 'instance' | 'error', message: string) => {
    if (reason === 'error' && !quiet) figma.notify('Could not update the diagram: ' + message, { error: true })
    post({ type: 'update-failed', id, reason, message })
  }

  let target: any = null
  try {
    target = await figma.getNodeByIdAsync(id)
  } catch {}
  if (!target || target.removed || !decodeDiagram(target.getPluginData(DIAGRAM_KEY))) {
    return fail('missing', 'The diagram is gone or no longer has its source.')
  }
  if (!editability(target).editable) {
    return fail('instance', 'This diagram is inside a component instance and cannot be changed in place.')
  }
  if (!canTransplant(target)) {
    return fail('error', 'The diagram root is not a frame or component.')
  }
  if (encodeDiagram({ source: msg.source, theme: msg.theme }) === null) {
    // Updating would drop the stored source and silently unlink the diagram.
    return fail('error', 'The source is too large to store, so this diagram could not be updated in place. Insert it as a new diagram instead.')
  }

  // Transactional: the new diagram is built completely, off to the side on the target's page, before the target is touched.
  const page = pageOf(target) || figma.currentPage
  let before = new Set<any>()
  let fresh: any = null
  try {
    // documentAccess is dynamic-page: the children of a page other than the current one must be loaded first.
    if (page !== figma.currentPage && typeof page.loadAsync === 'function') await page.loadAsync()
    await loadDiagramFonts()
    lap('load')
    if (target.removed) return fail('missing', 'The diagram was deleted while updating.')

    // Edits made in Figma since the plugin last wrote the diagram. `diagramChanges` covers both checks in one
    // walk: the per-layer stamps (Phase 12), which also see what the fingerprint does not hash such as a
    // stroke-only recolor, and the root fingerprint (Phase 11; a difference nothing else explains is `other`,
    // a missing stored fingerprint counts as not modified).
    // Checked after the awaits above, so an edit made on the canvas while fonts were loading is not lost.
    // From here to the transplant nothing awaits: no canvas edit can slip in between.
    if (!msg.force) {
      const changes = diagramChanges(target)
      lap('check')
      if (!isClean(changes)) {
        post({ type: 'update-needs-confirm', id, changes })
        return
      }
    }

    before = new Set<any>(page.children)
    fresh = createDiagramNode({
      svg: msg.svg,
      name: target.name,
      themeVariables: msg.themeVariables,
      source: msg.source,
      theme: msg.theme,
      parent: page,
    })
    if (!readDiagram(fresh)) throw new Error('The new diagram could not be linked to its source.')
    lap('build')
    transplantDiagram(target, fresh)
    lap('transplant')
  } catch (err) {
    // The target is untouched (transplantDiagram rolls back its own partial work). Drop whatever the failed build left on the page.
    // (An empty snapshot means the page itself could not be read: nothing was built, remove nothing.)
    if (before.size > 0) {
      try {
        for (const c of [...page.children]) {
          if (!before.has(c)) c.remove()
        }
      } catch {}
    }
    if (fresh && !fresh.removed) {
      try {
        fresh.remove()
      } catch {}
    }
    return fail('error', errorMessage(err))
  }

  stampDiagram(target)
  lap('stamp')
  // The canvas changes made by this update fire `nodechange` too. The UI does not need a report on them
  // (it resets its own state on `updated`), so the watch skips them instead of walking the diagram again.
  ignoreWatchUntil = Date.now() + SELF_CHANGE_MS
  clearTimeout(watchTimer)
  // One undo step per update: Cmd+Z in Figma takes back the last update, not every update of the session at once.
  try {
    if (typeof figma.commitUndo === 'function') figma.commitUndo()
  } catch {}
  if (!quiet) {
    try {
      if (page === figma.currentPage) {
        figma.currentPage.selection = [target]
      }
    } catch {}
    figma.notify('Mermapix diagram updated')
  }
  const ms = Date.now() - started
  if (ms >= SLOW_LOG_MS) console.log(`[Mermapix] update took ${ms} ms`, phases)
  post({ type: 'updated', id, ms })
  postSelection()
}

/** Answers `inspect-diagram`: what was changed in Figma on one linked diagram. `null` when it is gone, unlinked or unreadable. */
async function inspectDiagram(id: string): Promise<void> {
  let changes: DiagramChanges | null = null
  try {
    const root: any = await figma.getNodeByIdAsync(id)
    if (root && !root.removed && decodeDiagram(root.getPluginData(DIAGRAM_KEY))) {
      const page = pageOf(root)
      if (page && page !== figma.currentPage && typeof page.loadAsync === 'function') await page.loadAsync()
      changes = diagramChanges(root)
    }
  } catch {}
  post({ type: 'diagram-changes', id, changes })
}

// Live watch (edit mode). While the UI edits a diagram, a change on the canvas that touches it is reported
// again, so text edited in Figma shows up in the open plugin without restarting it. `page.on('nodechange')`
// is the page-level event that works with documentAccess: dynamic-page (`documentchange` would need every
// page loaded). Typing fires one event per keystroke, hence the debounce.
const WATCH_DEBOUNCE_MS = 300
let watch: { id: string; page: any; listener: (event: any) => void } | null = null
let watchTimer: any
let watchRun = 0

/** True when one of the changes is inside the diagram. A deletion cannot be placed any more, so it counts. */
function touchesDiagram(event: any, rootId: string): boolean {
  const list = event && event.nodeChanges
  if (!Array.isArray(list)) return true
  for (const change of list) {
    if (change.type === 'DELETE') return true
    try {
      for (let n = change.node; n; n = n.parent) {
        if (n.id === rootId) return true
      }
    } catch {
      return true
    }
  }
  return false
}

function stopWatching(): void {
  watchRun++
  clearTimeout(watchTimer)
  if (!watch) return
  try {
    watch.page.off('nodechange', watch.listener)
  } catch {}
  watch = null
}

/** Answers `watch-diagram`: reports the diagram now and after every later change to it. `null` stops. */
async function watchDiagram(id: string | null): Promise<void> {
  stopWatching()
  if (!id) return
  const run = watchRun
  try {
    const root: any = await figma.getNodeByIdAsync(id)
    const page = root && !root.removed ? pageOf(root) : null
    if (page && typeof page.on === 'function') {
      if (page !== figma.currentPage && typeof page.loadAsync === 'function') await page.loadAsync()
      // A newer watch-diagram arrived while this one was loading.
      if (run !== watchRun) return
      const listener = (event: any) => {
        if (Date.now() < ignoreWatchUntil) return
        if (!touchesDiagram(event, id)) return
        clearTimeout(watchTimer)
        watchTimer = setTimeout(() => inspectDiagram(id), WATCH_DEBOUNCE_MS)
      }
      page.on('nodechange', listener)
      watch = { id, page, listener }
    }
  } catch {}
  if (run !== watchRun) return
  await inspectDiagram(id)
}

figma.ui.onmessage = async (msg: UiToSandbox) => {
  if (msg.type === 'create-svg' && msg.svg) {
    await createFromSvg(msg)
  } else if (msg.type === 'update-svg') {
    await updateFromSvg(msg)
  } else if (msg.type === 'request-selection') {
    const auto = autoEditPending
    autoEditPending = false
    postSelection(auto)
  } else if (msg.type === 'inspect-diagram') {
    await inspectDiagram(msg.id)
  } else if (msg.type === 'watch-diagram') {
    await watchDiagram(msg.id)
  } else if (msg.type === 'resize' && msg.width && msg.height) {
    figma.ui.resize(Math.round(msg.width), Math.round(msg.height))
  } else if (msg.type === 'close') {
    figma.closePlugin()
  }
}
