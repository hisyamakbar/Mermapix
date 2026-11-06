// Mock-Figma harness for the developer test runner sandbox (plugin-dev/code.js).
// Extends tests/plugin-mock/figma-mock.mjs with what the runner needs and the production plugin does not:
// pages (createPage / setCurrentPageAsync), SECTION nodes, shared plugin data, createText and
// absoluteBoundingBox. Sandbox behaviour verified here still needs one real-Figma pass (Phase 10.3).
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MockNode } from './figma-mock.mjs'
import { importSvg } from './svg-import.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DEV_CODE = path.resolve(here, '../../plugin-dev/code.js')

function origin(p) {
  if (!p || p.type === 'PAGE') return { x: 0, y: 0 }
  if (p.type === 'GROUP') return origin(p.parent)
  const o = origin(p.parent)
  return { x: o.x + p.x, y: o.y + p.y }
}

// Idempotent: tests run in their own process, but keep it safe if imported twice.
if (!Object.getOwnPropertyDescriptor(MockNode.prototype, 'absoluteBoundingBox')) {
  Object.defineProperty(MockNode.prototype, 'absoluteBoundingBox', {
    get() {
      const o = origin(this.parent)
      return { x: this.x + o.x, y: this.y + o.y, width: this.width, height: this.height }
    },
  })
  MockNode.prototype.setSharedPluginData = function (ns, k, v) {
    ;((this.shared ??= {})[ns] ??= {})[k] = v
  }
  MockNode.prototype.getSharedPluginData = function (ns, k) {
    return this.shared?.[ns]?.[k] ?? ''
  }
}

/** Builds a mock figma + a handle to drive the sandbox like the UI does. */
export function createDevRunner(codePath = DEV_CODE) {
  const env = { ids: 0 }
  const posted = []
  const log = []
  let handler = null
  let replyWaiters = []
  const mk = (type, props) => {
    const n = new MockNode(env, 'FRAME', props)
    n.type = type
    delete n.layoutMode
    delete n.clipsContent
    return n
  }
  const root = mk('DOCUMENT', { name: 'Document' })
  const firstPage = mk('PAGE', { name: 'Page 1' })
  firstPage.selection = []
  root.appendChild(firstPage)
  let current = firstPage
  // Real Figma puts `fixtureOverrides[svg-index]`-style failures here: svgs containing this marker throw.
  const FAIL = 'MOCK_IMPORT_FAILURE'

  const figma = {
    showUI: (...a) => log.push(['showUI', a]),
    ui: {
      set onmessage(f) { handler = f },
      postMessage: (m) => {
        posted.push(m)
        replyWaiters = replyWaiters.filter((w) => !w(m))
      },
    },
    root,
    get currentPage() { return current },
    setCurrentPageAsync: async (p) => { current = p },
    createPage: () => {
      const p = mk('PAGE', { name: 'Page' })
      p.selection = []
      root.appendChild(p)
      return p
    },
    createSection: () => {
      const s = mk('SECTION', { name: 'Section', width: 640, height: 480 })
      current.appendChild(s)
      s.resizeWithoutConstraints = (w, h) => { s.width = w; s.height = h }
      return s
    },
    createText: () => {
      const t = new MockNode(env, 'TEXT')
      current.appendChild(t)
      return t
    },
    createFrame: () => new MockNode(env, 'FRAME'),
    createNodeFromSvg: (svg) => {
      if (svg.includes(FAIL)) throw new Error('mock: cannot import SVG')
      const n = importSvg(env, svg)
      current.appendChild(n)
      return n
    },
    loadFontAsync: async (f) => { log.push(['font', f]) },
    group: (nodes, parent, index) => {
      const g = new MockNode(env, 'GROUP')
      const x0 = Math.min(...nodes.map((n) => n.x)), y0 = Math.min(...nodes.map((n) => n.y))
      const x1 = Math.max(...nodes.map((n) => n.x + n.width)), y1 = Math.max(...nodes.map((n) => n.y + n.height))
      g.setBoundsRaw(x0, y0, x1 - x0, y1 - y0)
      parent.insertChild(index ?? parent.children.length, g)
      for (const n of nodes) g.appendChild(n)
      return g
    },
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView: (n) => log.push(['zoom', n.length]) },
    notify: (...a) => log.push(['notify', a]),
    closePlugin: () => log.push(['close']),
  }
  const ctx = vm.createContext({ figma, __html__: '<html>', atob: globalThis.atob, Buffer, Date, JSON })
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx)

  /** Sends a UI message and resolves with the next sandbox reply of `type`. */
  const request = (msg, type) =>
    new Promise((resolve) => {
      replyWaiters.push((m) => (m.type === type || m.type === 'run-error' ? (resolve(m), true) : false))
      handler(msg)
    })

  return { figma, root, posted, log, request, FAIL, get currentPage() { return current } }
}

/** Runs a full UI-like session: begin, insert each item, end. items: [{ fixture, theme, row, col, svg, themeVariables }] */
export async function runSession(runner, items) {
  const begin = await runner.request({ type: 'run-begin', total: items.length }, 'run-ready')
  const reports = []
  for (const it of items) {
    const r = await runner.request({ type: 'insert', key: `${it.fixture}|${it.theme}`, ...it }, 'inserted')
    reports.push(r.report ?? r)
  }
  const done = await runner.request({ type: 'run-end' }, 'run-done')
  return { begin, reports, done }
}
