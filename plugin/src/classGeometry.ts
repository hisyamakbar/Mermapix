// Pure helpers for classDiagram boxes (Phase 8.5), no `figma` usage so they are unit-testable in node.

export interface Divider {
  /** Center line of the divider stroke, in the same coordinate space as the box. */
  y: number
  weight: number
}

export interface Span {
  top: number
  bottom: number
}

/** Mermaid class box groups are named `<svgId>-classId-<id>-<n>`. Returns the class id or null. */
export function classIdFromName(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string' || name.includes('inlined-marker')) return null
  const m = /-classId-(.+)-(\d+)$/.exec(name)
  return m ? m[1] : null
}

/** Mermaid `note for X "…"` groups are named `<svgId>-note<n>`. Returns the note id (`note0`) or null. */
export function classNoteIdFromName(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string' || name.includes('inlined-marker')) return null
  const m = /-(note\d+)$/.exec(name)
  return m ? m[1] : null
}

/** Lollipop interface nodes (`A ()-- B`) are groups named `<svgId>-interface<n>`. */
export function classInterfaceIdFromName(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string' || name.includes('inlined-marker')) return null
  const m = /-(interface\d+)$/.exec(name)
  return m ? m[1] : null
}

/** `«interface»` / `<<interface>>` annotation line of a class header. */
export function isAnnotationText(s: string): boolean {
  const t = (s || '').trim()
  return /^«.+»$/.test(t) || /^<<.+>>$/.test(t)
}

/**
 * Splits a box [boxTop, boxBottom] by its divider strokes into compartments that tile it exactly:
 * a divider belongs to the compartment ABOVE it, as an inside-bottom border of its own weight
 * (it spans [y - weight/2, y + weight/2], like the original centered stroke). The sum of all
 * heights is boxBottom - boxTop, so a vertical Auto Layout parent of this height needs no slack.
 */
export function splitCompartments(boxTop: number, boxBottom: number, dividers: Divider[]): Span[] {
  const ds = dividers.slice().sort((a, b) => a.y - b.y)
  const spans: Span[] = []
  let top = boxTop
  for (const d of ds) {
    const bottom = Math.min(boxBottom, Math.max(top, d.y + d.weight / 2))
    spans.push({ top, bottom })
    top = bottom
  }
  spans.push({ top, bottom: boxBottom })
  return spans
}

/** Compartment index of a vertical position: the first span whose bottom is below `y`. */
export function compartmentIndex(spans: Span[], y: number): number {
  for (let i = 0; i < spans.length; i++) if (y < spans[i].bottom) return i
  return spans.length - 1
}

export function compartmentName(index: number, count: number): string {
  if (index === 0) return 'Header'
  if (count === 3) return index === 1 ? 'Attributes' : 'Methods'
  if (count === 2) return 'Members'
  return `Section ${index}`
}

/**
 * Vertical Auto Layout needs top padding + item spacing to put a stack of auto-height items exactly
 * where Mermaid had them: item i is centered on `centers[i]` and is `heights[i]` tall in the new font.
 * Spacing is the mean gap between consecutive items (never negative).
 */
export function stackPadding(
  centers: number[],
  heights: number[],
  spanTop: number,
): { paddingTop: number; itemSpacing: number } {
  if (centers.length === 0) return { paddingTop: 0, itemSpacing: 0 }
  const round = (v: number): number => Math.round(v * 100) / 100
  const paddingTop = Math.max(0, round(centers[0] - heights[0] / 2 - spanTop))
  if (centers.length === 1) return { paddingTop, itemSpacing: 0 }
  let gaps = 0
  for (let i = 0; i + 1 < centers.length; i++) gaps += centers[i + 1] - centers[i] - (heights[i] + heights[i + 1]) / 2
  return { paddingTop, itemSpacing: Math.max(0, round(gaps / (centers.length - 1))) }
}

/**
 * Horizontal padding that keeps content centered on `contentCenter` inside a box of `boxX..boxX+width`
 * when the Auto Layout centers it: padL - padR = 2 * offset (offset from the box center).
 */
export function centerPadding(contentCenter: number, boxX: number, width: number): { left: number; right: number } {
  const delta = contentCenter - (boxX + width / 2)
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.25) return { left: 0, right: 0 }
  const v = Math.round(Math.abs(delta) * 2 * 100) / 100
  return delta > 0 ? { left: v, right: 0 } : { left: 0, right: v }
}
