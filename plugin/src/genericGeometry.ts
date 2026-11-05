// Pure helpers for the generic fallback (Phase 8.5, no `figma` usage, unit-testable in node).

import { classifyShape } from './shapeGeometry.ts'
import type { Rect } from './connectorGeometry.ts'

/**
 * How the generic fallback treats a diagram, from the SVG root's `aria-roledescription`:
 *  - `skip`  : dedicated converters own it (ERD, flowchart, sequence, class, state)
 *  - `marks` : charts whose shapes ARE the data (pie slices, bars, axes ...): layers are only named
 *  - `nodes` : node/card diagrams: stacked pairs and single-label cards also become frames
 *  - `names` : unknown type: layers are only named
 */
export type FallbackMode = 'skip' | 'marks' | 'nodes' | 'names'

const SKIP_TYPES = /^(er|erdiagram|sequence|class|classdiagram|state|statediagram|flowchart.*)$/i
const MARK_TYPES = new Set([
  'pie',
  'gantt',
  'xychart',
  'quadrantchart',
  'sankey',
  'packet',
  'treemap',
  'radar',
  'venn',
  'gitgraph',
  'timeline',
  'journey',
])
const NODE_TYPES = new Set([
  'block',
  'c4',
  'kanban',
  'architecture',
  'mindmap',
  'requirement',
  'cynefin',
  'eventmodeling',
  'wardley',
  'ishikawa',
  'treeview',
])

export function fallbackMode(diagramType: string | null | undefined): FallbackMode {
  const t = (diagramType || '').trim().toLowerCase()
  if (!t) return 'names'
  if (SKIP_TYPES.test(t)) return 'skip'
  if (MARK_TYPES.has(t)) return 'marks'
  if (NODE_TYPES.has(t)) return 'nodes'
  return 'names'
}

/** `aria-roledescription` of the SVG root element (first 4 KB of the markup), or ''. */
export function diagramTypeFromSvg(svg: string | null | undefined): string {
  if (!svg || typeof svg !== 'string') return ''
  const head = svg.slice(0, 4096)
  const m = /<svg\b[^>]*\baria-roledescription="([^"]*)"/.exec(head)
  return m ? m[1] : ''
}

/** Layer names the SVG importer / Figma invent: Vector, Group, Frame 12, Rectangle, raw `mermaid-svg-0-…` ids. */
export function isGenericLayerName(name: string | null | undefined): boolean {
  const n = String(name ?? '').trim()
  return n === '' || /^(vector|group|frame|rectangle|ellipse|polygon|path|text)( ?\d+)?$/i.test(n) || isRawMermaidId(n)
}

export function isRawMermaidId(name: string | null | undefined): boolean {
  return /mermaid-(svg-)?\d+(-|$)/.test(String(name ?? ''))
}

/** `mermaid-svg-0-Todo` -> `Todo` (the user-facing id), '' when nothing is left. */
export function cleanRawId(name: string | null | undefined): string {
  const n = String(name ?? '')
  if (/^mermaid-(?:svg-)?\d+$/.test(n)) return ''
  const m = /^.*?mermaid-(?:svg-)?\d+-(.+)$/.exec(n)
  const id = (m ? m[1] : n).replace(/-\d+$/, '')
  return id.trim()
}

export type VectorKind = 'Line' | 'Curve' | 'Rectangle' | 'Rounded Rectangle' | 'Stadium' | 'Circle' | 'Ellipse' | 'Diamond' | 'Hexagon' | 'Parallelogram' | 'Trapezoid' | 'Polygon' | 'Shape'

/** Element kind of a vector from its path, bounds and paint. */
export function vectorKind(data: string | null | undefined, width: number, height: number, hasFill: boolean): VectorKind {
  if (Math.min(width, height) <= 1.5) return 'Line'
  const closed = /Z\s*$/i.test((data || '').trim())
  if (!hasFill && !closed) return 'Curve'
  const k = classifyShape(data, width, height).kind
  switch (k) {
    case 'Subroutine':
    case 'Cylinder':
    case 'Flag':
    case 'Double Circle':
      return 'Shape'
    default:
      return k as VectorKind
  }
}

export const clipLabel = (s: string, max = 28): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

const contains = (r: Rect, px: number, py: number, pad = 1): boolean =>
  px >= r.x - pad && px <= r.x + r.width + pad && py >= r.y - pad && py <= r.y + r.height + pad

/**
 * For each text, the index of the SMALLEST vector rect (area > 0) whose bounds contain the text center,
 * or -1. Ties keep the later (painted on top) rect.
 */
export function assignTextsToRects(rects: Rect[], texts: Rect[]): number[] {
  return texts.map((t) => {
    const cx = t.x + t.width / 2
    const cy = t.y + t.height / 2
    let best = -1
    let bestArea = Infinity
    rects.forEach((r, i) => {
      if (r.width < 2 || r.height < 2 || !contains(r, cx, cy)) return
      const a = r.width * r.height
      if (a <= bestArea) {
        best = i
        bestArea = a
      }
    })
    return best
  })
}

/** True when the text's center lies inside the rect (cards: label centered in its box). */
export function textCenteredIn(text: Rect, box: Rect, tolFrac = 0.2): boolean {
  const dx = text.x + text.width / 2 - (box.x + box.width / 2)
  const dy = text.y + text.height / 2 - (box.y + box.height / 2)
  return Math.abs(dx) <= Math.max(3, box.width * tolFrac) && Math.abs(dy) <= Math.max(3, box.height * tolFrac)
}
