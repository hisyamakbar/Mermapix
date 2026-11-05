// Pure geometry/naming helpers for the treemap converter (Phase 9.2). No `figma` usage, unit-testable in node.
//
// Mermaid's treemap draws every node as one SVG group (positioned with an absolute translate, NOT nested):
//   section  header rect (no paint, full width x 25) + section rect (fill/stroke) + bold name + italic value
//   leaf     rect (fill/stroke) + label + value
// The payload carries no class attributes, so everything is recognized by geometry.

import { stackPadding } from './classGeometry.ts'
import { offsetToPadding } from './shapeGeometry.ts'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface TextFacts extends Rect {
  /** Font weight of the imported text (>= 600 = bold). */
  weight: number
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol

/** True when `outer` contains `inner` (within `tol`) and is strictly larger in at least one axis. */
export function containsStrict(outer: Rect, inner: Rect, tol = 1): boolean {
  const inside =
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  if (!inside) return false
  return outer.width > inner.width + tol || outer.height > inner.height + tol
}

/** Index of the smallest rect that strictly contains each rect (-1 = top level). */
export function parentIndices(rects: Rect[], tol = 1): number[] {
  return rects.map((r, i) => {
    let best = -1
    for (let j = 0; j < rects.length; j++) {
      if (j === i || !containsStrict(rects[j], r, tol)) continue
      if (best < 0 || rects[j].width * rects[j].height < rects[best].width * rects[best].height) best = j
    }
    return best
  })
}

/**
 * The invisible header strip of a section: a vector as wide as the section box, starting at its top-left
 * corner and clearly shorter. `candidates` are the group's other (unpainted) vectors. Returns its index or -1.
 */
export function pickHeader(box: Rect, candidates: Rect[]): number {
  let best = -1
  candidates.forEach((c, i) => {
    if (!near(c.x, box.x, 1) || !near(c.y, box.y, 1) || !near(c.width, box.width, 1)) return
    if (c.height >= box.height - 1) return
    if (best < 0 || c.height > candidates[best].height) best = i
  })
  return best
}

export interface SectionRoles {
  name: number
  value: number
}

/**
 * Section header texts: the name starts at the left, the value is right aligned. With a single text it is
 * the name when bold or in the left half, else the value (the unnamed root section only has a value).
 */
export function sectionTextRoles(box: Rect, texts: TextFacts[]): SectionRoles {
  if (texts.length === 0) return { name: -1, value: -1 }
  const order = texts.map((_, i) => i).sort((a, b) => texts[a].x - texts[b].x)
  if (texts.length === 1) {
    const t = texts[0]
    const isName = t.weight >= 600 || t.x + t.width / 2 < box.x + box.width / 2
    return isName ? { name: 0, value: -1 } : { name: -1, value: 0 }
  }
  return { name: order[0], value: order[order.length - 1] }
}

export interface HeaderSpec {
  primary: 'MIN' | 'MAX' | 'SPACE_BETWEEN'
  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
}

const r2 = (v: number): number => Math.round(v * 100) / 100

/**
 * Horizontal Auto Layout for a section header: the name keeps its left offset, the value keeps its right
 * offset (SPACE_BETWEEN pushes them apart), both stay vertically where Mermaid put them (padding asymmetry).
 */
export function headerSpec(header: Rect, name: Rect | null, value: Rect | null): HeaderSpec {
  const items = [name, value].filter((t): t is Rect => Boolean(t))
  const primary = name && value ? 'SPACE_BETWEEN' : value ? 'MAX' : 'MIN'
  const paddingLeft = name ? Math.max(0, r2(name.x - header.x)) : 0
  const paddingRight = value ? Math.max(0, r2(header.x + header.width - (value.x + value.width))) : 0
  let paddingTop = 0
  let paddingBottom = 0
  if (items.length > 0) {
    const mean = items.reduce((s, t) => s + (t.y + t.height / 2), 0) / items.length
    const pad = offsetToPadding(mean - (header.y + header.height / 2), 0.5)
    paddingTop = Math.min(pad.start, header.height)
    paddingBottom = Math.min(pad.end, header.height)
  }
  return { primary, paddingLeft, paddingRight, paddingTop, paddingBottom }
}

export interface StackSpec {
  itemSpacing: number
  paddingTop: number
  paddingBottom: number
}

/**
 * Leaf label + value: a vertical stack centered in the box. `centers`/`heights` are the texts' original
 * vertical centers (box-relative) and their NEW heights. The gap between the texts is kept and the stack's
 * vertical offset from the box center becomes padding asymmetry. Horizontally the texts are simply centered:
 * Mermaid centers them in the leaf, and the x offsets measured on the import only reflect the importer's
 * text width estimate (a systematic -3px was seen on 36px labels), not intent.
 */
export function stackSpec(box: Rect, centers: number[], heights: number[]): StackSpec {
  const { itemSpacing } = stackPadding(centers, heights, 0)
  const n = centers.length
  if (n === 0) return { itemSpacing: 0, paddingTop: 0, paddingBottom: 0 }
  const total = heights.reduce((s, h) => s + h, 0) + itemSpacing * (n - 1)
  const stackCenter = centers[0] - heights[0] / 2 + total / 2
  const pad = offsetToPadding(stackCenter - box.height / 2, 0.5)
  return { itemSpacing, paddingTop: Math.min(pad.start, box.height), paddingBottom: Math.min(pad.end, box.height) }
}

const money = (s: string): string => s.trim()

/** `Section: <name> (<value>)`; the unnamed root container is called `Treemap`. */
export function sectionTitle(name: string, value: string): string {
  const n = name.trim() || 'Treemap'
  const v = money(value)
  return v ? `Section: ${n} (${v})` : `Section: ${n}`
}

/** `Leaf: <label> (<value>)`. */
export function leafTitle(label: string, value: string): string {
  const v = money(value)
  return v ? `Leaf: ${label.trim()} (${v})` : `Leaf: ${label.trim()}`
}
