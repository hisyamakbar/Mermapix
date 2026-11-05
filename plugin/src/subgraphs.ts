// Flowchart subgraphs / clusters -> native Figma frames (Phase 8.3).
//
// Mermaid draws a cluster as a GROUP holding one rect VECTOR (fill + stroke from the theme cluster
// colors) and a title TEXT at the top edge. Member nodes are NOT inside that group (Mermaid keeps
// clusters and nodes in separate layers), so membership is recovered from geometry:
//   1. every cluster group becomes a FRAME at the exact same bounds, carrying the rect's fill,
//      stroke, weight, dash and corner radius (border merged into the frame), the title text inside;
//   2. every node frame / cluster frame is reparented into the SMALLEST cluster frame that contains
//      it, with its absolute position preserved (coordinates rebased to the new parent).
// Cluster frames use NO Auto Layout: their children keep Mermaid's absolute positions, and they
// never clip, so a label a hair wider than its node (Inter vs Arial) is never cut off.

import {
  classifyShape,
  isRealDash,
} from './shapeGeometry.ts'
import {
  applyStroke,
  childOrigin,
  cloneAll,
  collectParts,
  hasFill,
  hasStroke,
  labelOf,
  pathDataOf,
  rebase,
  styleShapeText,
  tag,
} from './shapes.ts'
import { clusterIdFromName, smallestContainer, type Rect } from './connectorGeometry.ts'

export const CLUSTER_ID_KEY = 'mermapix:cluster'
export const CLUSTER_LABEL_KEY = 'mermapix:label'
export const NODE_ID_KEY = 'mermapix:node'

const isLive = (n: any): boolean => Boolean(n) && !n.removed

export interface ClusterFrame {
  frame: any
  id: string
  title: string
}

const readData = (n: any, key: string): string => {
  try {
    return typeof n.getPluginData === 'function' ? n.getPluginData(key) || '' : ''
  } catch {
    return ''
  }
}

export const isNodeFrame = (n: any): boolean => n && n.type === 'FRAME' && readData(n, NODE_ID_KEY) !== ''
export const isClusterFrame = (n: any): boolean => n && n.type === 'FRAME' && readData(n, CLUSTER_ID_KEY) !== ''

/** Absolute bounds of `n` in root-frame coordinates (GROUPs are coordinate-transparent). */
export function absRect(n: any): Rect {
  const o = childOrigin(n.parent)
  return { x: n.x + o.x, y: n.y + o.y, width: n.width, height: n.height }
}

// ---------------------------------------------------------------- 1. cluster groups -> frames

export interface ClusterGroup {
  group: any
  id: string
  vector: any
  texts: any[]
}

/** Finds cluster groups below `root` (descending through transparent GROUPs only). */
export function findClusterGroups(root: any): ClusterGroup[] {
  const out: ClusterGroup[] = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c) || c.type !== 'GROUP') continue
      const id = clusterIdFromName(c.name)
      if (id !== null) {
        const parts = collectParts(c)
        const v = parts.vectors.length === 1 ? parts.vectors[0] : null
        if (v && parts.others.length === 0 && v.width >= 1 && v.height >= 1 && (hasFill(v) || hasStroke(v))) {
          out.push({ group: c, id, vector: v, texts: parts.texts })
          continue
        }
      }
      visit(c)
    }
  }
  visit(root)
  return out
}

export interface ClusterNaming {
  /** Layer name prefix (`Subgraph`, `Namespace`, `State`). */
  prefix: string
  /** `mermapix:kind` value. */
  kind: string
}

const SUBGRAPH_NAMING: ClusterNaming = { prefix: 'Subgraph', kind: 'Subgraph' }

/** Converts one cluster group (single rect vector + title text) into a container frame (exported for 8.5 steps). */
export function convertClusterGroup(cg: ClusterGroup, naming: ClusterNaming = SUBGRAPH_NAMING): ClusterFrame {
  const { group, vector: v, texts } = cg
  const parentNode = group.parent
  const index = parentNode.children.indexOf(group)
  const title = labelOf(texts)
  const cls = classifyShape(pathDataOf(v), v.width, v.height)

  const frame = figma.createFrame()
  frame.name = `${naming.prefix}: ${title || cg.id}`
  frame.layoutMode = 'NONE'
  frame.resize(v.width, v.height)
  parentNode.insertChild(index, frame)
  const pos = rebase(v.x, v.y, v.parent, parentNode)
  frame.x = pos.x
  frame.y = pos.y
  frame.clipsContent = false

  // Merged paint: the cluster rect's fill + stroke live on the frame itself.
  frame.fills = hasFill(v) ? cloneAll(v.fills) : []
  frame.strokes = []
  if (hasStroke(v)) applyStroke(frame, v, Array.isArray(v.dashPattern) ? v.dashPattern : [])
  else if (isRealDash(v.dashPattern)) frame.dashPattern = v.dashPattern
  frame.cornerRadius = cls.rectLike ? cls.cornerRadius : 0

  // Title(s): keep each exactly where Mermaid put it (center preserved across the Arial -> Inter switch).
  for (const t of texts) {
    const rel = rebase(t.x, t.y, t.parent, parentNode)
    const cx = rel.x + t.width / 2 - pos.x
    const cy = rel.y + t.height / 2 - pos.y
    styleShapeText(t)
    frame.appendChild(t)
    t.x = cx - t.width / 2
    t.y = cy - t.height / 2
    try {
      t.constraints = { horizontal: 'CENTER', vertical: 'MIN' }
    } catch {}
  }

  v.remove()
  try {
    group.remove()
  } catch {}

  tag(frame, CLUSTER_ID_KEY, cg.id)
  tag(frame, CLUSTER_LABEL_KEY, title || cg.id)
  tag(frame, 'mermapix:kind', naming.kind)
  return { frame, id: cg.id, title: title || cg.id }
}

/** Converts every cluster group below `root` into a native frame (document order kept). */
export function convertClusters(root: any, naming: ClusterNaming = SUBGRAPH_NAMING): ClusterFrame[] {
  return findClusterGroups(root).map((cg) => convertClusterGroup(cg, naming))
}

// ---------------------------------------------------------------- 2. membership

interface Item {
  node: any
  rect: Rect
  order: number
  isCluster: boolean
}

/** Node + cluster frames below `root`, in document (z) order, descending through GROUPs only. */
function collectItems(root: any): Item[] {
  const items: Item[] = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c)) continue
      if (isClusterFrame(c) || isNodeFrame(c)) {
        items.push({ node: c, rect: absRect(c), order: items.length, isCluster: isClusterFrame(c) })
      } else if (c.type === 'GROUP') visit(c)
    }
  }
  visit(root)
  return items
}

/** Reparents `node` under `parent` (top of its children) keeping its absolute position. */
export function moveKeepingAbs(node: any, parent: any, abs: { x: number; y: number }): void {
  parent.appendChild(node)
  const o = childOrigin(parent)
  node.x = abs.x - o.x
  node.y = abs.y - o.y
}

/**
 * Moves each node/cluster frame into the smallest cluster frame that fully contains it.
 * Order inside a cluster: nested clusters first, then nodes (Mermaid paints clusters under nodes),
 * each group in the original document order. Returns the id -> parent cluster id map.
 */
export function nestIntoClusters(root: any): Map<string, string> {
  const items = collectItems(root)
  const clusters = items.filter((i) => i.isCluster)
  const clusterRects = clusters.map((c) => ({ ...c.rect, item: c }))
  const parentOf = new Map<Item, Item>()
  for (const it of items) {
    const found = smallestContainer(it.rect, clusterRects.filter((c) => c.item !== it))
    if (found) parentOf.set(it, found.item)
  }

  const depth = (it: Item): number => {
    let d = 0
    let p = parentOf.get(it)
    while (p && d < 1000) {
      d++
      p = parentOf.get(p)
    }
    return d
  }

  const moved = new Map<string, string>()
  const idOf = (it: Item): string => readData(it.node, it.isCluster ? CLUSTER_ID_KEY : NODE_ID_KEY)
  const place = (it: Item): void => {
    const parent = parentOf.get(it)
    if (!parent) return
    moveKeepingAbs(it.node, parent.node, { x: it.rect.x, y: it.rect.y })
    moved.set(idOf(it), idOf(parent))
  }

  // Outer clusters first so a parent already sits at its final position when its children are rebased.
  const clusterOrder = [...clusters].sort((a, b) => depth(a) - depth(b) || a.order - b.order)
  for (const c of clusterOrder) place(c)
  for (const n of items.filter((i) => !i.isCluster)) place(n)
  return moved
}
