// Generic fallback for every diagram type without a dedicated converter (Phase 8.5). Runs as the
// LAST diagram step and only when no earlier step produced structure (ERD tables, flowchart/class/
// state frames, `Connectors`, sequence strata).
//
// Rules (never move or restyle a chart mark, geometry is only ever read):
//   R1 (nodes mode)  stacked identical-bounds vectors = fill path + outline path of one rect-like shape
//                    -> ONE frame carrying the merged fill/stroke (same bounds, no children moved)
//   R2 (nodes mode)  a group that is exactly one rect-like filled/stroked shape + one label centered
//                    inside it -> Auto Layout frame (`convertShapeGroup`, FIXED size, label centered)
//   R3 (all modes)   layers still named Vector / Group / mermaid-svg-N-… get descriptive names from
//                    the label inside them or from the element kind
// Chart types (pie, gantt, xychart, ...) only get R3.

import { classifyShape, groupStackedBounds } from './shapeGeometry.ts'
import { collectParts, convertShapeGroup, hasFill, hasStroke, paintFrameFromVectors, pathDataOf } from './shapes.ts'
import { absRect, CLUSTER_ID_KEY, NODE_ID_KEY } from './subgraphs.ts'
import { isSequenceGroupName } from './sequenceGeometry.ts'
import {
  assignTextsToRects,
  cleanRawId,
  clipLabel,
  fallbackMode,
  isGenericLayerName,
  isRawMermaidId,
  textCenteredIn,
  vectorKind,
  type FallbackMode,
} from './genericGeometry.ts'

export const FALLBACK_KEY = 'mermapix:fallback'

const isLive = (n: any): boolean => Boolean(n) && !n.removed

const readData = (n: any, key: string): string => {
  try {
    return typeof n.getPluginData === 'function' ? n.getPluginData(key) || '' : ''
  } catch {
    return ''
  }
}

/** Frame kinds (`mermapix:kind`) produced by dedicated converters: ERD tables, treemap (9.2), railroad (9.2). */
const STRUCTURED_KINDS = new Set(['ERD Table', 'Treemap Section', 'Treemap Leaf', 'Railroad Terminal', 'Railroad NonTerminal', 'Railroad Special'])

/** True when an earlier step already built native structure (so this fallback must stay away). */
export function isStructured(root: any): boolean {
  let found = false
  const visit = (n: any): void => {
    if (found || !isLive(n) || !('children' in n)) return
    for (const c of n.children) {
      if (!isLive(c)) continue
      if (c.type === 'GROUP') {
        const name = String(c.name || '')
        if (name === 'Connectors' || isSequenceGroupName(name.toLowerCase()) || readData(c, 'mermapix:kind') === 'Railroad Rule') {
          found = true
          return
        }
      } else if (c.type === 'FRAME') {
        if (readData(c, NODE_ID_KEY) !== '' || readData(c, CLUSTER_ID_KEY) !== '' || STRUCTURED_KINDS.has(readData(c, 'mermapix:kind'))) {
          found = true
          return
        }
      }
      if (c.type === 'GROUP' || c.type === 'FRAME') visit(c)
    }
  }
  visit(root)
  return found
}

const WRAPPABLE = new Set(['Diamond', 'Hexagon', 'Parallelogram', 'Trapezoid', 'Ellipse', 'Circle'])

const solidKey = (paints: any): string => {
  try {
    return JSON.stringify((paints || []).map((p: any) => [p.type, p.color, p.opacity]))
  } catch {
    return ''
  }
}

/** The user-facing id of the closest ancestor group still named `mermaid-svg-N-<id>` ('' when none). */
function nearestRawId(n: any): string {
  for (let p = n; p && p.type !== 'PAGE'; p = p.parent) {
    if (p.type === 'FRAME' && !p.parent) break
    if (isRawMermaidId(p.name)) {
      const id = cleanRawId(p.name)
      if (id) return id
    }
  }
  return ''
}

// ---------------------------------------------------------------- R1: stacked pairs

function mergeStackedPairs(root: any): number {
  let merged = 0
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) if (isLive(c) && (c.type === 'GROUP' || c.type === 'FRAME')) visit(c)
    if (!isLive(n)) return
    const vectors = n.children.filter((c: any) => isLive(c) && c.type === 'VECTOR' && c.width >= 2 && c.height >= 2)
    for (const stack of groupStackedBounds(vectors)) {
      if (stack.length < 2) continue
      const fills = new Set(stack.filter(hasFill).map((v: any) => solidKey(v.fills)))
      const strokes = new Set(stack.filter(hasStroke).map((v: any) => solidKey(v.strokes) + String(v.strokeWeight)))
      if (fills.size > 1 || strokes.size > 1 || (fills.size === 0 && strokes.size === 0)) continue
      const fillVec = stack.find(hasFill) || stack[0]
      const cls = classifyShape(pathDataOf(fillVec), fillVec.width, fillVec.height)
      if (!cls.rectLike) continue
      // The frame replaces the lowest vector of the stack (same z position).
      const raw = nearestRawId(n)
      paintFrameFromVectors(stack, cls, raw ? `${cls.kind}: ${clipLabel(raw)}` : cls.kind, n, Math.min(...stack.map((v: any) => n.children.indexOf(v))))
      merged++
    }
  }
  visit(root)
  return merged
}

// ---------------------------------------------------------------- R2: cards (one shape + one centered label)

function convertCards(root: any): number {
  const groups: any[] = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c) || c.type !== 'GROUP') continue
      visit(c)
      groups.push(c)
    }
  }
  visit(root)

  let converted = 0
  for (const g of groups) {
    if (!isLive(g) || !g.parent || String(g.name || '').includes('inlined-marker')) continue
    const parts = collectParts(g)
    if (parts.texts.length !== 1 || parts.others.length > 0 || parts.vectors.length === 0) continue
    const stacks = groupStackedBounds(parts.vectors)
    if (stacks.length !== 1) continue
    const vecs = stacks[0]
    const v = vecs.find(hasFill) || vecs[0]
    if (v.width < 4 || v.height < 4 || !(vecs.some(hasFill) || vecs.some(hasStroke))) continue
    const cls = classifyShape(pathDataOf(v), v.width, v.height)
    // Rect-like shapes become Auto Layout frames; the well-known polygon kinds get a wrapper frame (as in flowcharts).
    if (!cls.rectLike && !WRAPPABLE.has(cls.kind)) continue
    const rv = absRect(v)
    const rt = absRect(parts.texts[0])
    if (!textCenteredIn(rt, rv)) continue
    const res = convertShapeGroup(g)
    if (!res) continue
    res.frame.name = res.label ? `${res.kind}: ${res.label}` : res.kind
    converted++
  }
  return converted
}

// ---------------------------------------------------------------- R3: names

function nameLayers(root: any): number {
  const vectors: any[] = []
  const texts: any[] = []
  const groups: any[] = []
  const walk = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of n.children) {
      if (!isLive(c)) continue
      if (c.type === 'VECTOR') vectors.push(c)
      else if (c.type === 'TEXT') {
        if ((c.characters || '').trim()) texts.push(c)
      } else if (c.type === 'GROUP') {
        groups.push(c)
        walk(c)
      } else if (c.type === 'FRAME') walk(c)
    }
  }
  walk(root)

  // label ownership: each text names the smallest vector that contains its center
  const vRects = vectors.map(absRect)
  const owner = assignTextsToRects(vRects, texts.map(absRect))
  // A vector is only named after a label when it owns exactly ONE text (a background panel that holds
  // many labels stays unlabeled instead of borrowing the first one).
  const owned = new Map<number, string[]>()
  owner.forEach((vi, ti) => {
    if (vi >= 0) owned.set(vi, [...(owned.get(vi) || []), clipLabel(texts[ti].characters)])
  })
  const labelOf = new Map<number, string>()
  owned.forEach((ls, vi) => {
    if (ls.length === 1) labelOf.set(vi, ls[0])
  })

  let named = 0
  vectors.forEach((v, i) => {
    if (!isGenericLayerName(v.name) || String(v.name || '').includes('inlined-marker')) return
    const kind = vectorKind(pathDataOf(v), v.width, v.height, hasFill(v))
    const label = labelOf.get(i)
    const raw = isRawMermaidId(v.name) ? cleanRawId(v.name) : ''
    v.name = label ? `${kind}: ${label}` : raw ? `${kind}: ${clipLabel(raw)}` : kind
    named++
  })

  for (const g of groups) {
    if (!isLive(g) || !isGenericLayerName(g.name) || String(g.name || '').includes('inlined-marker')) continue
    const raw = isRawMermaidId(g.name) ? cleanRawId(g.name) : ''
    if (raw) {
      g.name = clipLabel(raw, 40)
      named++
      continue
    }
    // Anonymous groups: only multi-child ones survive flattenWrappers, so only those need a name.
    if (!g.children || g.children.length < 2) continue
    const parts = collectParts(g)
    const ts = parts.texts.map((t: any) => clipLabel(t.characters))
    if (ts.length === 1) g.name = `Group: ${ts[0]}`
    else if (ts.length > 1) g.name = `Group: ${ts[0]} +${ts.length - 1}`
    else if (parts.vectors.length > 0) {
      const v = parts.vectors[0]
      g.name = `${vectorKind(pathDataOf(v), v.width, v.height, hasFill(v))} Group`
    } else continue
    named++
  }
  return named
}

export interface FallbackResult {
  ran: boolean
  mode: FallbackMode
  merged: number
  cards: number
  named: number
}

/** Runs the fallback on `root`; a no-op (ran: false) for dedicated diagram types and structured trees. */
export function applyGenericFallback(root: any, diagramType?: string): FallbackResult {
  const mode = fallbackMode(diagramType)
  const none: FallbackResult = { ran: false, mode, merged: 0, cards: 0, named: 0 }
  if (!isLive(root) || mode === 'skip') return none
  // Swimlane is flowchart-based: its nodes are already frames, only unnamed layers are left.
  const namesOnly = diagramType === 'swimlane'
  if (!namesOnly && isStructured(root)) return none

  let merged = 0
  let cards = 0
  if (mode === 'nodes') {
    merged = mergeStackedPairs(root)
    cards = convertCards(root)
  }
  const named = nameLayers(root)
  try {
    if (typeof root.setPluginData === 'function') root.setPluginData(FALLBACK_KEY, diagramType || 'unknown')
  } catch {}
  return { ran: true, mode, merged, cards, named }
}
