// Multi-message session against the production sandbox bundle (plugin/code.js) on a mock Figma with pages,
// selection events, getNodeByIdAsync and relaunch data. Used by the Phase 11 (source link) tests, which need
// several UI messages (insert, then update) against one plugin run.
// runPlugin in figma-mock.mjs stays the single-message runner the older tests rely on.
import vm from 'node:vm'
import fs from 'node:fs'
import { MockNode, serialize } from './figma-mock.mjs'
import { importSvg } from './svg-import.mjs'
import { CODE } from './run-fixture.mjs'

/** An SVG containing this marker makes createNodeFromSvg throw (like Figma on an unparsable SVG). */
export const IMPORT_FAILURE = 'MOCK_IMPORT_FAILURE'
/** An SVG containing this marker imports fine but makes the optimizer throw (children becomes unreadable). */
export const OPTIMIZE_FAILURE = 'MOCK_OPTIMIZE_FAILURE'

function asType(env, type, props) {
  const n = new MockNode(env, 'FRAME', props)
  n.type = type
  delete n.layoutMode
  delete n.clipsContent
  delete n.fills
  delete n.strokes
  return n
}

/**
 * Starts the bundle and returns a handle:
 *  send(msg)       -> awaits the sandbox handler, resolves with the messages it posted to the UI meanwhile
 *  select(nodes)   -> sets the page selection and fires `selectionchange` like Figma does
 *  nodeChange(nodes, type) -> fires the page's `nodechange`; flushTimers() -> runs the pending debounce timers
 *  posted / log    -> everything posted to the UI / notifications and other calls, in order
 *  page, document, env, figma
 */
export function createSession({ codePath = CODE, command = '', buildScene } = {}) {
  const env = { ids: 0 }
  const posted = []
  const log = []
  const listeners = {}
  let handler = null
  const document = asType(env, 'DOCUMENT', { name: 'Document' })
  const page = asType(env, 'PAGE', { name: 'Page 1' })
  document.appendChild(page)
  let selection = []
  // Page-level `nodechange` (what the sandbox uses to watch a diagram under dynamic-page access) and the
  // timers behind its debounce. Timers never run by themselves: `flushTimers()` runs what is pending.
  const pageListeners = []
  Object.defineProperty(page, 'on', { enumerable: false, value: (ev, f) => { if (ev === 'nodechange') pageListeners.push(f) } })
  Object.defineProperty(page, 'off', { enumerable: false, value: (ev, f) => { const i = pageListeners.indexOf(f); if (ev === 'nodechange' && i >= 0) pageListeners.splice(i, 1) } })
  const timers = new Map()
  let timerIds = 0
  const setTimeoutMock = (f) => { timers.set(++timerIds, f); return timerIds }
  const clearTimeoutMock = (id) => { timers.delete(id) }
  Object.defineProperty(page, 'selection', {
    enumerable: false,
    get: () => selection,
    set: (v) => {
      selection = [...v]
      for (const f of listeners.selectionchange || []) f()
    },
  })
  const find = (n, id) => {
    if (n.id === id) return n
    for (const c of n.children || []) { const r = find(c, id); if (r) return r }
    return null
  }
  const figma = {
    command,
    root: document,
    showUI: (...a) => log.push(['showUI', a]),
    ui: { set onmessage(f) { handler = f }, resize: (...a) => log.push(['ui.resize', a]), postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) },
    loadFontAsync: async (f) => { log.push(['font', f]) },
    get currentPage() { return page },
    on: (ev, f) => { (listeners[ev] ??= []).push(f) },
    getNodeByIdAsync: async (id) => { const n = find(document, id); return n && !n.removed ? n : null },
    createNodeFromSvg: (svg) => {
      if (svg.includes(IMPORT_FAILURE)) throw new Error('mock: cannot import SVG')
      const n = buildScene ? buildScene(env, svg) : importSvg(env, svg)
      page.appendChild(n)
      if (svg.includes(OPTIMIZE_FAILURE)) Object.defineProperty(n, 'children', { get() { throw new Error('mock: optimizer exploded') } })
      return n
    },
    createFrame: () => new MockNode(env, 'FRAME'),
    group: (nodes, parent, index) => {
      const g = new MockNode(env, 'GROUP')
      const x0 = Math.min(...nodes.map((n) => n.x)), y0 = Math.min(...nodes.map((n) => n.y))
      const x1 = Math.max(...nodes.map((n) => n.x + n.width)), y1 = Math.max(...nodes.map((n) => n.y + n.height))
      g.setBoundsRaw(x0, y0, x1 - x0, y1 - y0)
      parent.insertChild(index ?? parent.children.length, g)
      for (const n of nodes) g.appendChild(n)
      return g
    },
    viewport: { center: { x: 500, y: 400 }, scrollAndZoomIntoView: (n) => log.push(['zoom', n.length]) },
    notify: (...a) => log.push(['notify', a]),
    commitUndo: () => log.push(['commitUndo']),
    closePlugin: () => log.push(['close']),
  }
  const ctx = vm.createContext({ figma, __html__: '<html>', atob: globalThis.atob, Buffer, setTimeout: setTimeoutMock, clearTimeout: clearTimeoutMock })
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx)

  const send = async (msg) => {
    const start = posted.length
    await handler(msg)
    return posted.slice(start)
  }
  const select = (nodes) => { page.selection = nodes }
  /** Fires the page's `nodechange` like Figma does after an edit on the canvas (one change per node). */
  const nodeChange = (nodes, type = 'PROPERTY_CHANGE') => {
    const event = { nodeChanges: nodes.map((node) => ({ type, id: node.id, node, origin: 'LOCAL' })) }
    for (const f of [...pageListeners]) f(event)
  }
  /** Runs every pending timer (the watch debounce); resolves with the messages posted to the UI meanwhile. */
  const flushTimers = async () => {
    const start = posted.length
    const due = [...timers.values()]
    timers.clear()
    for (const f of due) await f()
    return posted.slice(start)
  }
  const notifications = () => log.filter((l) => l[0] === 'notify').map((l) => l[1][0])
  return { env, page, document, figma, posted, log, send, select, notifications, serialize, listeners, nodeChange, flushTimers, pendingTimers: () => timers.size, pageListeners }
}
