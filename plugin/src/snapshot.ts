// Per-layer snapshot of a source-linked diagram (Phase 12): how was it edited in Figma?
//
// Phase 11 keeps one fingerprint on the diagram root ("was it touched"). This module explains HOW:
//   - `stampLayers(root)` runs once, right after the plugin built the tree. Every descendant gets
//     `mermapix:snap` (bounds + solid fill/stroke colors), every TEXT layer `mermapix:text` (the generated
//     characters and, when known, where the text came from in the Mermaid source), the root `mermapix:count`.
//   - `diagramChanges(root)` compares the live tree with those stamps and answers a `DiagramChanges`.
// The stamps live on the layers themselves (not in one blob on the root keyed by node id), so a duplicated
// diagram, whose nodes have new ids, keeps working.
//
// Pure like sourceLink.ts: no top-level `figma` access, only the node objects passed in, so tests can import it
// directly (`node --experimental-strip-types`) and the sandbox bundle can too.
//
// Stored formats (both versionless on purpose: they are only read by the plugin build that wrote them, and an
// unreadable stamp simply makes a layer count as "added"):
//   mermapix:snap   "x,y,w,h" or "x,y,w,h|fills" or "x,y,w,h|fills|strokes"; integers (rounded); fills/strokes
//                   are comma-separated solid paints "rrggbb[@opacity%][h]" (h = hidden), e.g. "12,40,160,36|1e293b|38bdf8"
//   mermapix:text   {"t":"<generated characters>","x":<TextContext>}; `x` is omitted when there is no context
//   mermapix:count  number of stamped layers, as a decimal string

import { FINGERPRINT_KEY, fingerprint } from './sourceLink.ts'
import type { DiagramChanges, TextChange, TextContext } from './protocol.ts'

export const SNAP_KEY = 'mermapix:snap'
export const TEXT_KEY = 'mermapix:text'
export const COUNT_KEY = 'mermapix:count'

// Tags written by the converters (shapes.ts, subgraphs.ts, erd.ts). Kept as literals so this module has no
// imports beyond sourceLink.ts; tests/unit/plugin-snapshot.test.mjs fails if they drift.
const KIND_KEY = 'mermapix:kind'
const NODE_KEY = 'mermapix:node'
const CLUSTER_KEY = 'mermapix:cluster'

function data(node: any, key: string): string {
  try {
    if (node && typeof node.getPluginData === 'function') {
      const v = node.getPluginData(key)
      return typeof v === 'string' ? v : ''
    }
  } catch {}
  return ''
}

function put(node: any, key: string, value: string): boolean {
  try {
    node.setPluginData(key, value)
    return true
  } catch {
    return false
  }
}

const liveChildren = (n: any): any[] => {
  try {
    const kids = n && n.children
    return Array.isArray(kids) ? kids.filter((c: any) => c && !c.removed) : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- snap format

interface Snap {
  x: number | null
  y: number | null
  w: number | null
  h: number | null
  fills: string
  strokes: string
}

const int = (v: unknown): string => (typeof v === 'number' && isFinite(v) ? String(Math.round(v)) : '')

const hex2 = (v: number): string => ('0' + Math.max(0, Math.min(255, Math.round(v * 255))).toString(16)).slice(-2)

/** Solid paints of `node[prop]` as "rrggbb[@opacity][h]" joined by commas; '' for none or unreadable (figma.mixed). */
function paints(node: any, prop: 'fills' | 'strokes'): string {
  let list: any
  try {
    list = node[prop]
  } catch {
    return ''
  }
  if (!Array.isArray(list)) return ''
  const out: string[] = []
  for (const p of list) {
    if (!p || p.type !== 'SOLID' || !p.color) continue
    const op = typeof p.opacity === 'number' ? Math.round(p.opacity * 100) : 100
    out.push(hex2(p.color.r) + hex2(p.color.g) + hex2(p.color.b) + (op !== 100 ? '@' + op : '') + (p.visible === false ? 'h' : ''))
  }
  return out.join(',')
}

function readSnap(node: any): Snap {
  return { x: numOrNull(node.x), y: numOrNull(node.y), w: numOrNull(node.width), h: numOrNull(node.height), fills: paints(node, 'fills'), strokes: paints(node, 'strokes') }
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null)

function encodeSnap(node: any): string {
  const s = `${int(node.x)},${int(node.y)},${int(node.width)},${int(node.height)}`
  const fills = paints(node, 'fills')
  const strokes = paints(node, 'strokes')
  if (strokes !== '') return `${s}|${fills}|${strokes}`
  if (fills !== '') return `${s}|${fills}`
  return s
}

function parseSnap(raw: string): Snap | null {
  if (raw === '') return null
  const parts = raw.split('|')
  const box = parts[0].split(',')
  if (box.length !== 4) return null
  const n = (v: string): number | null => (v === '' || !isFinite(Number(v)) ? null : Number(v))
  return { x: n(box[0]), y: n(box[1]), w: n(box[2]), h: n(box[3]), fills: parts[1] || '', strokes: parts[2] || '' }
}

// ---------------------------------------------------------------- text context

/** Kinds whose label is not written as `<id><opener>label` in the source (class boxes have many texts). */
const NO_NODE_CONTEXT = new Set(['Class', 'Interface', 'Note'])

function directTexts(n: any): any[] {
  return liveChildren(n).filter((c) => c.type === 'TEXT' && typeof c.characters === 'string' && c.characters.trim() !== '')
}

/**
 * ERD table card (erd.ts): children[0] is the header frame (title text(s)), children[1] the `Content` frame
 * holding one `Column: Type | Field Name | Key | Comment` frame per column, each with one cell frame per
 * attribute row IN SOURCE ORDER (every column gets a cell for every row, empty ones included), so a cell's
 * index inside its column is the attribute row. A trailing `Row: Additional Details` frame (texts erd.ts could
 * not classify) gets no context.
 */
function erdContexts(card: any, out: Map<any, TextContext>): void {
  const kids = liveChildren(card)
  const header = kids.find((c) => typeof c.name === 'string' && c.name.indexOf('Header:') === 0)
  const content = kids.find((c) => c.name === 'Content')
  if (!header) return
  const titles = directTexts(header)
  if (titles.length === 0) return
  const entity = titles.map((t) => t.characters.trim()).join(' ')
  if (titles.length === 1) out.set(titles[0], { kind: 'erd-entity', entity })
  if (!content) return

  const COLS: Record<string, 'type' | 'name' | 'key' | 'comment'> = {
    'Column: Type': 'type',
    'Column: Field Name': 'name',
    'Column: Key': 'key',
    'Column: Comment': 'comment',
  }
  for (const column of liveChildren(content)) {
    const col = COLS[column.name]
    if (!col) continue
    liveChildren(column).forEach((cell, row) => {
      const texts = directTexts(cell)
      texts.forEach((t, part) => {
        const ctx: TextContext = { kind: 'erd-attr', entity, row, col }
        if (texts.length > 1) ctx.part = part
        out.set(t, ctx)
      })
    })
  }
}

/** Where each text layer of a finished diagram came from, for the layers where that is known. */
export function deriveTextContexts(root: any): Map<any, TextContext> {
  const out = new Map<any, TextContext>()
  const visit = (n: any): void => {
    const kind = data(n, KIND_KEY)
    if (kind === 'ERD Table') {
      erdContexts(n, out)
      return
    }
    if (n.type === 'FRAME') {
      const nodeId = data(n, NODE_KEY)
      const clusterId = data(n, CLUSTER_KEY)
      if (nodeId !== '' && !NO_NODE_CONTEXT.has(kind)) {
        const texts = directTexts(n)
        if (texts.length === 1) out.set(texts[0], { kind: 'node', id: nodeId })
      } else if (nodeId === '' && clusterId !== '' && clusterId.indexOf('#') < 0) {
        const texts = directTexts(n)
        if (texts.length === 1) out.set(texts[0], { kind: 'cluster', id: clusterId })
        // A use case `package` boundary (usecase.ts) keeps its title in a child `Tab` frame.
        if (kind === 'Package') {
          const tab = liveChildren(n).find((c) => c.type === 'FRAME' && c.name === 'Tab')
          const tabTexts = tab ? directTexts(tab) : []
          if (tabTexts.length === 1) out.set(tabTexts[0], { kind: 'cluster', id: clusterId })
        }
      }
    }
    for (const c of liveChildren(n)) visit(c)
  }
  visit(root)
  return out
}

// ---------------------------------------------------------------- stamping

/**
 * Stamps every descendant of `root` (not the root itself) and writes `mermapix:count` on the root. Call it
 * once the tree is final and BEFORE the fingerprint is written. Returns the number of stamped layers.
 */
export function stampLayers(root: any): number {
  const contexts = deriveTextContexts(root)
  let count = 0
  const visit = (n: any): void => {
    for (const c of liveChildren(n)) {
      if (put(c, SNAP_KEY, encodeSnap(c))) {
        count++
        if (c.type === 'TEXT' && typeof c.characters === 'string') {
          const ctx = contexts.get(c)
          put(c, TEXT_KEY, JSON.stringify(ctx ? { t: c.characters, x: ctx } : { t: c.characters }))
        }
      }
      visit(c)
    }
  }
  visit(root)
  put(root, COUNT_KEY, String(count))
  return count
}

// ---------------------------------------------------------------- diff

const isAutoLayout = (n: any): boolean => {
  try {
    return n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL'
  } catch {
    return false
  }
}

interface Entry {
  node: any
  snap: Snap
  dx: number
  dy: number
  /** Width or height differs from the stamp. */
  resized: boolean
}

function readTextStamp(node: any): { t: string; x?: TextContext } | null {
  const raw = data(node, TEXT_KEY)
  if (raw === '') return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v.t === 'string' ? v : null
  } catch {
    return null
  }
}

/**
 * What changed on the canvas since `stampLayers` ran. Approximate by design (see `DiagramChanges`):
 *  - texts: stamped TEXT layers whose characters differ from the stamp, with the stamped context.
 *  - moved: stamped layers whose rounded x/y/width/height differ, except geometry that merely follows a text
 *    edit (decision 7: the edited layer itself; the size of its Auto Layout ancestors; the position of every
 *    child of those ancestors) and children of a moved GROUP, whose coordinates are relative to the nearest
 *    frame and so shift with it. A GROUP counts only when it was translated (same size): its size follows
 *    its children, which are counted themselves.
 *  - restyled: stamped layers whose solid fill or stroke colors differ.
 *  - added: top-most unstamped layer of each unstamped subtree, plus stamped layers beyond `mermapix:count`.
 *  - removed: `mermapix:count` minus the stamped layers still present (never negative).
 *  - other: the Phase 11 fingerprint differs but nothing above explains it; also the answer for a diagram
 *    without `mermapix:count` (inserted by the Phase 11 build) whose fingerprint differs.
 */
export function diagramChanges(root: any): DiagramChanges {
  const result: DiagramChanges = { texts: [], moved: 0, restyled: 0, added: 0, removed: 0, other: false }
  const storedFp = data(root, FINGERPRINT_KEY)
  const fpDiffers = storedFp !== '' && storedFp !== fingerprint(root)

  const countRaw = data(root, COUNT_KEY)
  const count = countRaw === '' ? NaN : parseInt(countRaw, 10)
  if (!isFinite(count) || count < 0) {
    result.other = fpDiffers
    return result
  }

  // Pass 1: find stamped layers, edited texts and unstamped subtrees.
  const entries = new Map<any, Entry>()
  const edited = new Set<any>()
  let stamped = 0
  const visit = (n: any, underUnstamped: boolean): void => {
    for (const c of liveChildren(n)) {
      const snap = parseSnap(data(c, SNAP_KEY))
      if (!snap) {
        if (!underUnstamped) result.added++
        visit(c, true)
        continue
      }
      stamped++
      const cur = readSnap(c)
      entries.set(c, {
        node: c,
        snap,
        dx: cur.x !== null && snap.x !== null ? cur.x - snap.x : 0,
        dy: cur.y !== null && snap.y !== null ? cur.y - snap.y : 0,
        resized: (cur.w !== null && snap.w !== null && cur.w !== snap.w) || (cur.h !== null && snap.h !== null && cur.h !== snap.h),
      })
      if (c.type === 'TEXT' && typeof c.characters === 'string') {
        const stamp = readTextStamp(c)
        if (stamp && stamp.t !== c.characters) {
          edited.add(c)
          const change: TextChange = { from: stamp.t, to: c.characters }
          if (stamp.x) change.context = stamp.x
          result.texts.push(change)
        }
      }
      visit(c, false)
    }
  }
  visit(root, false)

  if (stamped > count) result.added += stamped - count
  result.removed = Math.max(0, count - stamped)

  // Auto Layout ancestors of edited texts: their size, and their children's positions, may follow the text.
  const layoutAncestors = new Set<any>()
  for (const t of edited) {
    let p = t.parent
    for (let guard = 0; p && p !== root && guard < 10000; guard++) {
      if (isAutoLayout(p)) layoutAncestors.add(p)
      p = p.parent
    }
  }

  // Pass 2: geometry and colors.
  for (const e of entries.values()) {
    const n = e.node
    const cur = readSnap(n)
    const sizeDiffers = e.resized

    // A child of a group shifts with the group: only its own part of the shift counts. Figma re-fits a group to
    // its children, so a group whose size changed did not simply move (its origin follows a child): no shift to share.
    let ownDx = e.dx
    let ownDy = e.dy
    const parentEntry = n.parent && n.parent.type === 'GROUP' ? entries.get(n.parent) : undefined
    if (parentEntry && !parentEntry.resized) {
      ownDx -= parentEntry.dx
      ownDy -= parentEntry.dy
    }

    const isEdited = edited.has(n)
    const posFollowsText = isEdited || (n.parent && layoutAncestors.has(n.parent))
    const sizeFollowsText = isEdited || layoutAncestors.has(n)
    const posChanged = !posFollowsText && (ownDx !== 0 || ownDy !== 0)
    if (n.type === 'GROUP') {
      if (posChanged && !sizeDiffers) result.moved++
    } else if (posChanged || (!sizeFollowsText && sizeDiffers)) {
      result.moved++
    }

    if (cur.fills !== e.snap.fills || cur.strokes !== e.snap.strokes) result.restyled++
  }

  const explained = result.texts.length + result.moved + result.restyled + result.added + result.removed > 0
  result.other = fpDiffers && !explained
  return result
}

/** True when `changes` reports nothing at all. */
export function isClean(changes: DiagramChanges): boolean {
  return changes.texts.length === 0 && changes.moved === 0 && changes.restyled === 0 && changes.added === 0 && changes.removed === 0 && !changes.other
}
