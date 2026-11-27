// Pure helpers for use case diagrams (Mermaid 12.3.0 `usecase-beta`, Phase 14.3); no `figma` usage.
//
// Structure Mermaid emits (classic look, htmlLabels false; the export keeps `id` and drops `class`/`data-*`):
//   boundary  <g id="<svgId>-usecase-<id>">  one rect (rect type) or two rects (package: tab + body) + title group
//   actor     <g id="<svgId>-usecase-<id>">  an unpainted 76x116 hit-area rect, a label group, a figure group
//                                            (one path, or circle + path for hollow / awesome actors)
//   use case  <g id="<svgId>-usecase-<id>">  <ellipse> (or <rect> for `Name[Label]`) + a centred label group
//   note      <g id="<svgId>-usecase-note-<n>">  fill path + hand-drawn outline path + label
//   edge      <path id="usecase-<svgId>-edge-<n>"> + inlined marker; notes: `usecase-<svgId>-note-<n>-edge`
//             (no from/to in the id: the ends are found by geometry)
//   label     <g transform> > <g data-id="edge-<n>"> > rect + text (the data attributes are lost in Figma)

import type { Rect } from './connectorGeometry.ts'

const NODE_RE = /-usecase-(.+)$/

/** Mermaid id of a use case node / actor / note / boundary group (`mermaid-svg-0-usecase-Customer` -> `Customer`), else null. */
export function usecaseNodeId(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string' || name.includes('inlined-marker')) return null
  const m = NODE_RE.exec(name)
  return m ? m[1] : null
}

/** `note-0`, `note-1`: the ids Mermaid gives `note for X "..."` boxes. */
export const isUsecaseNoteId = (id: string): boolean => /^note-\d+$/.test(id)

export type UsecaseRole = 'actor' | 'usecase' | 'note' | 'boundary' | 'package'

export interface UsecasePart {
  rect: Rect
  /** Fill or stroke present. */
  painted: boolean
  /** Axis-aligned rectangle (a rect element, or a 4-corner polygon). */
  rectLike: boolean
  /** The shape is an ellipse outline. */
  ellipse: boolean
}

export interface UsecaseInput {
  id: string
  vectors: UsecasePart[]
  /** Rects of the label texts. */
  texts: Rect[]
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol

/** True when a label is centred in a box (use case labels are; a boundary title sits on its top edge). */
export function isCentredIn(text: Rect, box: Rect): boolean {
  const dx = text.x + text.width / 2 - (box.x + box.width / 2)
  const dy = text.y + text.height / 2 - (box.y + box.height / 2)
  return Math.abs(dx) <= Math.max(3, box.width * 0.1) && Math.abs(dy) <= Math.max(2.5, box.height * 0.1)
}

const containsCentre = (box: Rect, t: Rect): boolean => {
  const cx = t.x + t.width / 2
  const cy = t.y + t.height / 2
  return cx >= box.x - 1 && cx <= box.x + box.width + 1 && cy >= box.y - 1 && cy <= box.y + box.height + 1
}

const insideRect = (outer: Rect, inner: Rect, tol: number): boolean =>
  inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.width <= outer.x + outer.width + tol && inner.y + inner.height <= outer.y + outer.height + tol

const union = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x))
  const y0 = Math.min(...rs.map((r) => r.y))
  return { x: x0, y: y0, width: Math.max(...rs.map((r) => r.x + r.width)) - x0, height: Math.max(...rs.map((r) => r.y + r.height)) - y0 }
}

/**
 * What a node group is, from its parts only (null = not understood, the generic fallback handles it):
 *  - actor    : an unpainted hit-area vector (when the importer keeps it) or a label outside every painted
 *               shape, plus at least one painted figure vector
 *  - note     : id `note-<n>` and nothing unpainted
 *  - package  : two painted rects, the smaller a tab on the top edge of the bigger one (title in the tab)
 *  - boundary : one painted rect whose title is not centred in it
 *  - usecase  : one painted shape (ellipse or rect) with its label centred in it
 */
export function classifyUsecaseGroup(input: UsecaseInput): UsecaseRole | null {
  const { id, vectors, texts } = input
  if (texts.length === 0 || vectors.length === 0) return null
  const unpainted = vectors.filter((v) => !v.painted)
  const painted = vectors.filter((v) => v.painted)
  // The label of every other node sits INSIDE its shape; an actor's name hangs below the figure.
  const outside = texts.some((t) => !painted.some((v) => containsCentre(v.rect, t)))
  if (unpainted.length > 0 || (outside && painted.length > 0)) return painted.length > 0 ? 'actor' : null
  if (isUsecaseNoteId(id)) return painted.length >= 1 ? 'note' : null
  if (painted.length === 0) return null
  const area = (v: UsecasePart): number => v.rect.width * v.rect.height
  const byArea = painted.slice().sort((a, b) => area(b) - area(a))
  const v = byArea[0]
  // Decorations (the business slash, an icon) lie inside the main shape.
  const rest = byArea.slice(1)
  if (rest.length === 1 && v.rectLike && rest[0].rectLike) {
    // package: the smaller rect is a tab on the top edge of the bigger one
    const tab = rest[0].rect
    const body = v.rect
    const onTop = near(tab.y + tab.height, body.y, 1.5) && tab.x >= body.x - 1.5 && tab.x + tab.width <= body.x + body.width + 1.5
    if (onTop) return 'package'
  }
  if (!rest.every((r) => insideRect(v.rect, r.rect, 2))) return null
  // The label block (a stereotype above the label counts) is centred in a use case.
  const centred = isCentredIn(union(texts), v.rect)
  if (v.ellipse) return centred ? 'usecase' : null
  if (!v.rectLike) return null
  return centred ? 'usecase' : rest.length === 0 ? 'boundary' : null
}

/**
 * Which texts of an actor are its name: those outside every figure vector (an unregistered icon draws a `?` inside the
 * figure). All of them when none qualifies.
 */
export function actorNameTexts(figures: Rect[], texts: Rect[]): number[] {
  const out = texts.map((_, i) => i).filter((i) => !figures.some((f) => containsCentre(f, texts[i])))
  return out.length > 0 ? out : texts.map((_, i) => i)
}

/**
 * Layer names of an actor's figure vectors (same order as `rects`). One path is the `Figure` (a business slash or an
 * icon beside it is a `Detail`); a hollow / awesome actor draws a `Head` above a `Body`.
 */
export function actorPartNames(rects: Rect[]): string[] {
  if (rects.length <= 1) return rects.map(() => 'Figure')
  const top = Math.min(...rects.map((r) => r.y))
  const bottom = Math.max(...rects.map((r) => r.y + r.height))
  const area = (r: Rect): number => r.width * r.height
  const main = rects.reduce((a, b) => (area(b) > area(a) ? b : a))
  if (main.height >= 0.8 * (bottom - top)) return rects.map((r) => (r === main ? 'Figure' : 'Detail'))
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => a.r.y - b.r.y)
  const names: string[] = []
  order.forEach(({ i }, k) => (names[i] = k === 0 ? 'Head' : k === 1 ? 'Body' : 'Detail'))
  return names
}
