// Pure helpers for sequence diagrams (Phase 8.4): no `figma` usage, unit-testable in node.

import { parsePathData, type Pt } from './shapeGeometry.ts'
import type { Rect } from './connectorGeometry.ts'

/** Mermaid lifelines are `<line id="actorN">`; Figma names the VECTOR after the id. */
export function isLifelineName(name: string | null | undefined): boolean {
  return typeof name === 'string' && /^actor\d+$/.test(name)
}

export type MarkerKindName = string

/** Kind part of an `inlined-marker-<n>-<kind>-<start|end>` layer name, or null. */
export function inlinedMarkerKind(name: string | null | undefined): { kind: MarkerKindName; position: 'start' | 'end' } | null {
  const m = /^inlined-marker-\d+-([a-z-]+)-(start|end)$/.exec((name || '').trim().toLowerCase())
  return m ? { kind: m[1], position: m[2] as 'start' | 'end' } : null
}

/** Names of the groups this phase creates; cleanup must not dissolve them. */
export const SEQUENCE_GROUP_NAMES = [
  'participants (bottom)',
  'lifelines',
  'participants (top)',
  'actors',
  'activations',
  'notes',
  'blocks',
  'messages',
]

export function isSequenceGroupName(name: string | null | undefined): boolean {
  const n = (name || '').toLowerCase()
  return SEQUENCE_GROUP_NAMES.includes(n) || n.startsWith('message ')
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

/** `Message 3: Validate stock (API → API)` - label and participants clipped so the name stays short. */
export function messageName(n: string | number, label: string, from: string, to: string): string {
  const l = clip((label || '').replace(/\s+/g, ' ').trim(), 40)
  const head = l ? `Message ${n}: ${l}` : `Message ${n}`
  return from && to ? `${head} (${clip(from, 24)} → ${clip(to, 24)})` : head
}

/** First and last point of a vector's path (absolute, given the vector's top-left corner). */
export function pathEnds(data: string | null | undefined, x: number, y: number): { start: Pt; end: Pt } | null {
  const cmds = parsePathData(data)
  if (!cmds || cmds.length === 0) return null
  let start: Pt | null = null
  let end: Pt | null = null
  for (const c of cmds) {
    if (c.p.length < 2) continue
    const p = { x: c.p[c.p.length - 2] + x, y: c.p[c.p.length - 1] + y }
    if (!start) start = p
    end = p
  }
  return start && end ? { start, end } : null
}

/** Index of the center nearest to `value` within `tol`, or -1. */
export function nearestIndex(value: number, centers: number[], tol = Infinity): number {
  let best = -1
  let bestD = Infinity
  centers.forEach((c, i) => {
    const d = Math.abs(c - value)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return bestD <= tol ? best : -1
}

// ---------------------------------------------------------------- block borders

export interface Seg {
  id: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface BlockBorder {
  rect: Rect
  /** Segment ids of the four border sides. */
  top: number
  right: number
  bottom: number
  left: number
  /** Horizontal lines spanning the full width inside the box (else / and / option dividers). */
  dividers: number[]
  /** Anything else (kept as loose lines inside the block). */
  extras: number[]
}

const horizontal = (s: Seg): boolean => Math.abs(s.y1 - s.y2) <= 0.01 && Math.abs(s.x1 - s.x2) > 0.01
const vertical = (s: Seg): boolean => Math.abs(s.x1 - s.x2) <= 0.01 && Math.abs(s.y1 - s.y2) > 0.01

/**
 * Mermaid draws a loop/alt/opt/par/critical/break block as four border lines (top, right, bottom,
 * left) plus optional divider lines. Returns the box and which line is which, or null when the
 * segments do not form a closed box.
 */
export function pickBlockBorder(segs: Seg[], tol = 0.6): BlockBorder | null {
  const hs = segs.filter(horizontal)
  const vs = segs.filter(vertical)
  if (hs.length < 2 || vs.length < 2) return null
  const xs = segs.flatMap((s) => [s.x1, s.x2])
  const ys = segs.flatMap((s) => [s.y1, s.y2])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const w = maxX - minX
  const h = maxY - minY
  if (w < 1 || h < 1) return null
  const spanX = (s: Seg): number => Math.abs(s.x2 - s.x1)
  const spanY = (s: Seg): number => Math.abs(s.y2 - s.y1)
  const top = hs.find((s) => Math.abs(s.y1 - minY) <= tol && spanX(s) >= w - 2 * tol)
  const bottom = hs.find((s) => s !== top && Math.abs(s.y1 - maxY) <= tol && spanX(s) >= w - 2 * tol)
  const left = vs.find((s) => Math.abs(s.x1 - minX) <= tol && spanY(s) >= h - 2 * tol)
  const right = vs.find((s) => s !== left && Math.abs(s.x1 - maxX) <= tol && spanY(s) >= h - 2 * tol)
  if (!top || !bottom || !left || !right) return null
  const used = new Set([top, bottom, left, right])
  const dividers = hs.filter((s) => !used.has(s) && spanX(s) >= w - 2 * tol && s.y1 > minY + tol && s.y1 < maxY - tol)
  dividers.forEach((s) => used.add(s))
  return {
    rect: { x: minX, y: minY, width: w, height: h },
    top: top.id,
    right: right.id,
    bottom: bottom.id,
    left: left.id,
    dividers: dividers.map((s) => s.id),
    extras: segs.filter((s) => !used.has(s)).map((s) => s.id),
  }
}

// ---------------------------------------------------------------- text helpers

/**
 * True when `rects` look like the lines of ONE multi-line label: one below the other, evenly
 * spaced, centers aligned. Returns the line pitch (px) or null.
 */
export function stackedLinePitch(rects: Rect[], maxCenterDx = 16): number | null {
  if (rects.length < 2) return null
  const sorted = [...rects].sort((a, b) => a.y - b.y)
  const pitches: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    const dy = b.y - a.y
    if (dy < Math.min(a.height, b.height) * 0.6) return null
    const dx = b.x + b.width / 2 - (a.x + a.width / 2)
    if (Math.abs(dx) > maxCenterDx) return null
    pitches.push(dy)
  }
  const mean = pitches.reduce((s, p) => s + p, 0) / pitches.length
  if (pitches.some((p) => Math.abs(p - mean) > 1.5)) return null
  return Math.round(mean * 100) / 100
}

/** `#rrggbb` of a solid paint (figma 0..1 channels), or '' when there is none. */
export function hexOfPaint(paints: any): string {
  const p = Array.isArray(paints) ? paints[0] : null
  if (!p || p.type !== 'SOLID' || !p.color) return ''
  const h = (v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  return `#${h(p.color.r)}${h(p.color.g)}${h(p.color.b)}`
}
