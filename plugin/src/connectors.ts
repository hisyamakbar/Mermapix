// Flowchart connectors (Phase 8.3): every edge line + its marker groups (+ its label) becomes one
// `Edge: <from> → <to>` group; all edges live in ONE `Connectors` group.
//
// Z-ORDER DECISION (root frame, bottom -> top):
//   leftovers < Subgraph frames < loose node frames < Connectors
// Nodes that belong to a subgraph are children of that subgraph frame, so they sit below anything
// above the subgraph frame. Connectors therefore has to be above ALL clusters (clusters have opaque
// fills, an edge entering or crossing one would otherwise be hidden) and consequently above all
// nodes. That is visually identical to Mermaid: edges end exactly at node borders, and with the
// default themes line color == border color, so an arrow tip drawn over the 1px border changes
// nothing. Edge labels sit above every edge line (as in Mermaid, which paints labels after all edge
// paths), see `plan` below.

import { absRect, isClusterFrame, isNodeFrame, moveKeepingAbs, CLUSTER_ID_KEY, CLUSTER_LABEL_KEY, NODE_ID_KEY } from './subgraphs.ts'
import {
  assignLabelsToEdges,
  edgeBodyFromName,
  edgeDisplayName,
  isAnonymousEdgeName,
  resolveEdgeEndpointsByGeometry,
  type EdgeTarget,
  polylineHitsRect,
  rectsOverlap,
  resolveEdgeEndpoints,
  vectorPolyline,
  type Rect,
} from './connectorGeometry.ts'
import { pathDataOf } from './shapes.ts'
import type { Pt } from './shapeGeometry.ts'

const isLive = (n: any): boolean => Boolean(n) && !n.removed

const readData = (n: any, key: string): string => {
  try {
    return typeof n.getPluginData === 'function' ? n.getPluginData(key) || '' : ''
  } catch {
    return ''
  }
}

export const isEdgeLabelFrame = (n: any): boolean =>
  Boolean(n) && n.type === 'FRAME' && readData(n, 'mermapix:kind') === 'Edge Label'

interface EdgeInfo {
  vector: any
  markers: any[]
  body: string
  pts: Pt[]
  markerRects: Rect[]
  weight: number
  order: number
}

/** Edge vectors (`…L_<from>_<to>_<n>`) below `root`, descending through transparent GROUPs only. */
function collectEdges(root: any): EdgeInfo[] {
  const edges: EdgeInfo[] = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    const kids = [...n.children]
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]
      if (!isLive(c)) continue
      if (c.type === 'VECTOR') {
        // `L_a_b_0` / `id_A_B_1` carry ids; state transitions and note connectors are anonymous ('').
        const body = edgeBodyFromName(c.name) ?? (isAnonymousEdgeName(c.name) ? '' : null)
        if (body === null) continue
        // The marker groups of this edge follow it directly (svgPrep inlines them after the path).
        const markers: any[] = []
        for (let j = i + 1; j < kids.length; j++) {
          const m = kids[j]
          if (isLive(m) && m.type === 'GROUP' && String(m.name || '').includes('inlined-marker')) markers.push(m)
          else break
        }
        const a = absRect(c)
        edges.push({
          vector: c,
          markers,
          body,
          pts: vectorPolyline(pathDataOf(c), a.x, a.y),
          markerRects: markers.map(absRect),
          weight: Number(c.strokeWeight) || 1,
          order: edges.length,
        })
      } else if (c.type === 'GROUP' && !String(c.name || '').includes('inlined-marker')) visit(c)
    }
  }
  visit(root)
  return edges
}

/** id -> human label (and absolute rect, for geometric edge endpoints) of every node/cluster frame below `root`. */
function collectLabels(root: any): { labels: Map<string, string>; targets: EdgeTarget[] } {
  const labels = new Map<string, string>()
  const targets: EdgeTarget[] = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of n.children) {
      if (!isLive(c)) continue
      if (isNodeFrame(c)) {
        const id = readData(c, NODE_ID_KEY)
        const label = readData(c, CLUSTER_LABEL_KEY)
        labels.set(id, label || (c.name && c.name !== 'Shape' ? c.name : id))
        targets.push({ id, rect: absRect(c) })
      } else if (isClusterFrame(c)) {
        const id = readData(c, CLUSTER_ID_KEY)
        labels.set(id, readData(c, CLUSTER_LABEL_KEY))
        // The inner "Body" panel of a composite state is not an edge endpoint, its outer frame is.
        if (readData(c, 'mermapix:kind') !== 'State Body') targets.push({ id, rect: absRect(c) })
      }
      if (c.type === 'FRAME' || c.type === 'GROUP') visit(c)
    }
  }
  visit(root)
  return { labels, targets }
}

function collectEdgeLabelFrames(root: any): any[] {
  const out: any[] = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c)) continue
      if (isEdgeLabelFrame(c)) out.push(c)
      else if (c.type === 'GROUP' && !String(c.name || '').includes('inlined-marker')) visit(c)
    }
  }
  visit(root)
  return out
}

/** Top-level (not inside a cluster frame) cluster and node frames, in document order. */
function collectTopLevel(root: any): { clusters: any[]; nodes: any[] } {
  const clusters: any[] = []
  const nodes: any[] = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c)) continue
      if (isClusterFrame(c)) clusters.push(c)
      else if (isNodeFrame(c)) nodes.push(c)
      else if (c.type === 'GROUP') visit(c)
    }
  }
  visit(root)
  return { clusters, nodes }
}

function makeGroup(members: any[], parent: any, name: string): any | null {
  const live = members.filter(isLive)
  if (live.length === 0) return null
  try {
    const g = figma.group(live, parent)
    g.name = name
    return g
  } catch {
    return null
  }
}

export interface ConnectorsResult {
  edges: number
  grouped: number
  labelsInEdges: number
  labelsLoose: number
}

/**
 * Arranges the flowchart root: top-level subgraph frames, loose node frames, then `Connectors`.
 * Everything keeps its absolute position (members are only reparented / grouped).
 */
export function arrangeFlowchart(root: any): ConnectorsResult {
  const result: ConnectorsResult = { edges: 0, grouped: 0, labelsInEdges: 0, labelsLoose: 0 }
  if (!isLive(root) || root.type !== 'FRAME') return result

  const { labels: labelMap, targets } = collectLabels(root)
  const edges = collectEdges(root)
  const labelFrames = collectEdgeLabelFrames(root)
  const { clusters, nodes } = collectTopLevel(root)
  // Only flowchart-type diagrams (node frames / subgraph frames present): ERD and sequence are left alone.
  if (clusters.length === 0 && nodes.length === 0) return result

  // 1. Which label belongs to which edge (nearest line, unambiguous only).
  const labelRects = labelFrames.map(absRect)
  const owner = assignLabelsToEdges(
    edges.map((e) => ({ pts: e.pts })),
    labelRects.map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })),
  )
  // A label may only live inside its edge group when no LATER edge (painted above it) crosses it;
  // otherwise it stays loose in Connectors, above every edge, like Mermaid paints it.
  const embedded: any[][] = edges.map(() => [])
  const loose: any[] = []
  labelFrames.forEach((lf, li) => {
    const e = owner[li]
    if (e < 0) {
      loose.push(lf)
      return
    }
    const r = labelRects[li]
    const crossedByLater = edges.some(
      (f) =>
        f.order > e &&
        (polylineHitsRect(f.pts, r, f.weight / 2) || f.markerRects.some((m) => rectsOverlap(m, r))),
    )
    if (crossedByLater) loose.push(lf)
    else embedded[e].push(lf)
  })

  // 2. Hoist top-level subgraph + node frames straight under the root: clusters, then nodes.
  const hoist = (n: any): void => {
    if (n.parent !== root) moveKeepingAbs(n, root, absRect(n))
    else root.appendChild(n)
  }
  clusters.forEach(hoist)
  nodes.forEach(hoist)

  // 3. One group per edge: line, marker groups, own label.
  const edgeGroups: any[] = []
  const known = [...labelMap.keys()]
  edges.forEach((e, i) => {
    const ends = e.body
      ? resolveEdgeEndpoints(e.body, known)
      : resolveEdgeEndpointsByGeometry(e.pts, targets)
    const label = (id: string): string => labelMap.get(id) || id
    const name = ends ? edgeDisplayName(label(ends.from), label(ends.to)) : `Edge: ${e.body || 'Connector'}`
    try {
      e.vector.name = 'Line'
    } catch {}
    const members = [e.vector, ...e.markers, ...embedded[i]]
    for (const m of members) if (m.parent !== root) moveKeepingAbs(m, root, absRect(m))
    const g = makeGroup(members, root, name)
    if (g) edgeGroups.push(g)
  })
  result.edges = edges.length
  result.grouped = edgeGroups.length
  result.labelsInEdges = embedded.reduce((n, a) => n + a.length, 0)
  result.labelsLoose = loose.length

  // 4. All edges (plus loose labels, on top) in one Connectors group, last = top of the stack.
  for (const lf of loose) if (lf.parent !== root) moveKeepingAbs(lf, root, absRect(lf))
  const connectors = makeGroup([...edgeGroups, ...loose], root, 'Connectors')
  if (connectors) root.appendChild(connectors)
  return result
}
