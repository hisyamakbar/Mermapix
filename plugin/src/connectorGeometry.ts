// Pure geometry + naming helpers for subgraph membership and connectors (no `figma` usage).
// Unit-testable in node; used by subgraphs.ts and connectors.ts (Phase 8.3).

import { flattenPath, parsePathData, type Pt } from './shapeGeometry.ts'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const rectArea = (r: Rect): number => Math.max(0, r.width) * Math.max(0, r.height)

/** True when `inner` lies fully inside `outer` (tolerance in px for stroke/rounding noise). */
export function containsRect(outer: Rect, inner: Rect, tol = 1): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  )
}

/**
 * The smallest candidate that contains `item` and is strictly larger than it (a cluster can never
 * contain itself or a same-size twin, which keeps the membership tree acyclic).
 */
export function smallestContainer<T extends Rect>(item: Rect, candidates: T[], tol = 1): T | null {
  const itemArea = rectArea(item)
  let best: T | null = null
  for (const c of candidates) {
    if (c === (item as unknown)) continue
    if (rectArea(c) <= itemArea + 1) continue
    if (!containsRect(c, item, tol)) continue
    if (!best || rectArea(c) < rectArea(best)) best = c
  }
  return best
}

// ---------------------------------------------------------------- ids and names

const EDGE_NAME_RE = /(?:^|-)L_(.+)_(\d+)$/
/** classDiagram relations: `<svgId>-id_<from>_<to>_<n>` (ERD `id_entity-…` edges are not matched). */
const CLASS_EDGE_NAME_RE = /(?:^|-)id_(.+)_(\d+)$/
/** stateDiagram transitions (`edge<n>`) and note/class-note connectors carry no ids at all. */
const ANON_EDGE_NAME_RE = /(?:^|-)(?:edge|edgeNote)\d+$|----note-\d+(?:-.*)?$/

/** Mermaid edge layer names look like `<svgId>-L_<from>_<to>_<n>`. Returns `<from>_<to>` or null. */
export function edgeBodyFromName(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null
  if (name.includes('inlined-marker')) return null
  const m = EDGE_NAME_RE.exec(name)
  if (m) return m[1]
  if (!name.includes('entity-')) {
    const c = CLASS_EDGE_NAME_RE.exec(name)
    if (c) return c[1]
  }
  return null
}

/** True for connector layer names without from/to ids (state transitions, note connectors). */
export function isAnonymousEdgeName(name: string | null | undefined): boolean {
  if (!name || typeof name !== 'string' || name.includes('inlined-marker')) return false
  return ANON_EDGE_NAME_RE.test(name)
}

export interface EdgeTarget {
  id: string
  rect: Rect
}

/** Distance from a point to the OUTLINE of a rect (0 on the border, grows inside and outside). */
export function distanceToRectOutline(p: Pt, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy)
  return Math.min(p.x - r.x, r.x + r.width - p.x, p.y - r.y, r.y + r.height - p.y)
}

/** The target whose outline is nearest to `p` within `maxDist`, preferring the smaller rect on ties. */
export function nearestTarget(p: Pt, targets: EdgeTarget[], maxDist = 24): EdgeTarget | null {
  let best: EdgeTarget | null = null
  let bestD = Infinity
  for (const t of targets) {
    const d = distanceToRectOutline(p, t.rect)
    if (d < bestD - 0.01 || (Math.abs(d - bestD) <= 0.01 && best && rectArea(t.rect) < rectArea(best.rect))) {
      best = t
      bestD = d
    }
  }
  return best && bestD <= maxDist ? best : null
}

/** from = the target at the start of the polyline, to = the target at its end (null when either is unknown). */
export function resolveEdgeEndpointsByGeometry(
  pts: Pt[],
  targets: EdgeTarget[],
  maxDist = 24,
): { from: string; to: string } | null {
  if (pts.length < 2) return null
  const a = nearestTarget(pts[0], targets, maxDist)
  const b = nearestTarget(pts[pts.length - 1], targets, maxDist)
  return a && b ? { from: a.id, to: b.id } : null
}

/**
 * Splits `<from>_<to>` into the two ids. Node ids may contain underscores, so every split is
 * checked against the known ids (nodes and subgraphs); falls back to the first underscore.
 */
export function resolveEdgeEndpoints(
  body: string,
  knownIds: Iterable<string>,
): { from: string; to: string; known: boolean } | null {
  if (!body) return null
  const known = new Set(knownIds)
  const splits: number[] = []
  for (let i = 1; i < body.length - 1; i++) if (body[i] === '_') splits.push(i)
  if (splits.length === 0) return null
  for (const i of splits) {
    const from = body.slice(0, i)
    const to = body.slice(i + 1)
    if (known.has(from) && known.has(to)) return { from, to, known: true }
  }
  const i = splits[0]
  return { from: body.slice(0, i), to: body.slice(i + 1), known: false }
}

/** Cluster (subgraph) group layer names: `<svgId>-<subgraphId>`, e.g. `mermaid-svg-0-S1`. */
export function clusterIdFromName(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null
  if (name.includes('inlined-marker') || name.includes('-flowchart-') || name.includes('entity-')) return null
  if (EDGE_NAME_RE.test(name)) return null
  const m = /^.*?svg-\d+-(.+)$/.exec(name)
  return m ? m[1] : null
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

export function edgeDisplayName(fromLabel: string, toLabel: string): string {
  return `Edge: ${clip(fromLabel, 40)} → ${clip(toLabel, 40)}`
}

// ---------------------------------------------------------------- polylines

/** Absolute polyline(s) of a vector, from its (origin-translated) path data. */
export function vectorPolyline(data: string | null | undefined, x: number, y: number): Pt[] {
  const cmds = parsePathData(data)
  if (!cmds) return []
  const out: Pt[] = []
  for (const sub of flattenPath(cmds).subpaths) for (const p of sub) out.push({ x: p.x + x, y: p.y + y })
  return out
}

export function distanceToPolyline(p: Pt, pts: Pt[]): number {
  if (pts.length === 0) return Infinity
  let best = Infinity
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1] || a
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    if (d < best) best = d
  }
  return best
}

/** True when any sampled point of `pts` lies inside `rect` grown by `pad`. */
export function polylineHitsRect(pts: Pt[], rect: Rect, pad = 0): boolean {
  return pts.some(
    (p) => p.x >= rect.x - pad && p.x <= rect.x + rect.width + pad && p.y >= rect.y - pad && p.y <= rect.y + rect.height + pad,
  )
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
}

// ---------------------------------------------------------------- label association

export interface EdgeGeom {
  /** Absolute polyline of the connector line. */
  pts: Pt[]
}

/** Largest distance (px) from a label center to its own edge line. Mermaid centers a label on the unsmoothed edge points, the drawn curve cuts corners (14px seen on a TD diagram). */
export const LABEL_MAX_DISTANCE = 32
/** The nearest edge must beat the runner-up by at least this much to count as unambiguous. */
export const LABEL_MIN_MARGIN = 12

/**
 * For each label center, the index of the edge it belongs to, or -1 when no edge is close enough
 * or two edges are about equally close (ambiguous).
 */
export function assignLabelsToEdges(edges: EdgeGeom[], centers: Pt[]): number[] {
  return centers.map((c) => {
    let best = -1
    let bestD = Infinity
    let second = Infinity
    edges.forEach((e, i) => {
      const d = distanceToPolyline(c, e.pts)
      if (d < bestD) {
        second = bestD
        bestD = d
        best = i
      } else if (d < second) {
        second = d
      }
    })
    if (best < 0 || bestD > LABEL_MAX_DISTANCE) return -1
    if (second - bestD < LABEL_MIN_MARGIN) return -1
    return best
  })
}
