// Minimal in-memory mock of the Figma plugin sandbox, enough to run plugin/code.js
// (the bundled sandbox script) end to end in node without Figma.
//
// Text nodes model font-dependent width: width = chars * perChar(fontFamily, style).
// Width only re-measures when textAutoResize is WIDTH_AND_HEIGHT (like Figma), either when the
// font changes while it is set, or at the moment it is set.
import vm from 'node:vm'
import fs from 'node:fs'

import { textWidth, textHeight } from './text-metrics.mjs'

export class MockNode {
  constructor(env, type, props = {}) {
    this._env = env
    this.id = `${++env.ids}`
    this.type = type
    this.name = props.name ?? { TEXT: 'Text', VECTOR: 'Vector', GROUP: 'Group' }[type] ?? 'Frame'
    this.x = props.x ?? 0
    this.y = props.y ?? 0
    this.width = props.width ?? 0
    this.height = props.height ?? 0
    this.removed = false
    this.parent = null
    this.visible = true
    if (type === 'FRAME' || type === 'GROUP') this.children = []
    if (type === 'FRAME') {
      this.fills = props.fills ?? []
      this.strokes = props.strokes ?? []
      this.layoutMode = 'NONE'
      this.clipsContent = true
    }
    if (type === 'VECTOR') {
      this.fills = props.fills ?? []
      this.strokes = props.strokes ?? []
    }
    if (type === 'TEXT') {
      this.characters = props.characters ?? ''
      this.fills = props.fills ?? [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
      let font = { family: 'Arial', style: 'Regular' }
      let auto = 'NONE'
      let size = props.fontSize ?? 12
      const measure = () => { this.width = textWidth(this.characters, font, size); this.height = textHeight(this.characters, size) }
      Object.defineProperty(this, 'fontName', { enumerable: true, get: () => font, set: (f) => { font = f; if (auto === 'WIDTH_AND_HEIGHT') measure() } })
      Object.defineProperty(this, 'fontSize', { enumerable: true, get: () => size, set: (v) => { size = v; if (auto === 'WIDTH_AND_HEIGHT') measure() } })
      Object.defineProperty(this, 'textAutoResize', { enumerable: true, get: () => auto, set: (v) => { auto = v; if (v === 'WIDTH_AND_HEIGHT') measure() } })
    }
  }
  appendChild(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); this.children.push(c); c.parent = this }
  insertChild(i, c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); this.children.splice(i, 0, c); c.parent = this }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.removed = true }
  resize(w, h) { this.width = w; this.height = h }
  setPluginData(k, v) { (this.pluginData ??= {})[k] = v }
  getPluginData(k) { return this.pluginData?.[k] ?? '' }
}

const SKIP = new Set(['_env', 'parent', 'children', 'id'])
export function serialize(n) {
  const o = {}
  for (const k of Object.keys(n)) if (!SKIP.has(k) && typeof n[k] !== 'function') o[k] = n[k]
  if (n.children) o.children = n.children.map(serialize)
  return o
}

export function walk(tree, fn, parent = null) {
  fn(tree, parent)
  for (const c of tree.children || []) walk(c, fn, tree)
}

/**
 * Runs the plugin bundle and sends one `create-svg` message.
 * `buildScene(env, svg)` returns the root node that createNodeFromSvg yields.
 * Returns { tree (serialized), root (live), log, svgSeen }.
 */
export async function runPlugin(codePath, svg, buildScene, extraMsg = {}) {
  const env = { ids: 0 }
  const log = []
  let handler = null
  let root = null
  let svgSeen = null
  const figma = {
    showUI: (...a) => log.push(['showUI', a]),
    ui: { set onmessage(f) { handler = f }, resize: (...a) => log.push(['ui.resize', a]) },
    loadFontAsync: async (f) => { log.push(['font', f]) },
    createNodeFromSvg: (s) => { svgSeen = s; root = buildScene(env, s); return root },
    createFrame: () => new MockNode(env, 'FRAME'),
    // Like Cmd+G: members keep their absolute position (coordinates are parent-frame relative and
    // GROUPs are transparent, so numbers are unchanged); the group takes the union bounds.
    group: (nodes, parent, index) => {
      if (!nodes.length) throw new Error('figma.group: no nodes')
      const g = new MockNode(env, 'GROUP')
      const x0 = Math.min(...nodes.map((n) => n.x)), y0 = Math.min(...nodes.map((n) => n.y))
      const x1 = Math.max(...nodes.map((n) => n.x + n.width)), y1 = Math.max(...nodes.map((n) => n.y + n.height))
      Object.assign(g, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
      parent.insertChild(index ?? parent.children.length, g)
      for (const n of nodes) g.appendChild(n)
      return g
    },
    currentPage: { appendChild: (n) => log.push(['page.append', n.name]), selection: [] },
    viewport: { center: { x: 500, y: 400 }, scrollAndZoomIntoView: (n) => log.push(['zoom', n.length]) },
    notify: (...a) => log.push(['notify', a]),
    closePlugin: () => log.push(['close']),
  }
  const ctx = vm.createContext({ figma, __html__: '<html>', atob: globalThis.atob, Buffer })
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx)
  await handler({ type: 'create-svg', svg, name: 'X', ...extraMsg })
  figma.currentPage.selection.length = 0
  return { tree: serialize(root), root, log, svgSeen }
}
