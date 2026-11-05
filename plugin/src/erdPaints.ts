// ERD paint extraction (no `figma` calls; operates on plain node-like objects so it is unit-testable).
//
// Each Mermaid entity contains path pairs (fill path + rough outline path):
//   pair 0      = outer box (full entity bounds)  -> header/title background
//   pairs 1..N  = attribute rows (odd/even stripes)
//   then divider lines (stroke-only).
// Fills are matched in z-order (first filled vector = pair 0, next = row 0, ...);
// the border comes from the first stroke-only vector (pair 0's outline).

import { SYSTEM_THEME_PRESETS, parseColorToFigma } from './theme.ts'

export interface ErdPaints {
  headerFill: any[]
  rowFills: any[][]
  border: any[]
  isDark: boolean
  /** Which parts came from the SVG (true) vs. theme-token fallback (false). */
  fromSvg: { header: boolean; rows: boolean[]; border: boolean }
}

/** All VECTOR descendants in z-order (document order). */
export function collectEntityVectors(entity: any): any[] {
  const out: any[] = []
  function walk(n: any): void {
    if (!n || n.removed) return
    if (n.type === 'VECTOR') {
      out.push(n)
    } else if ('children' in n) {
      try {
        for (const child of n.children) walk(child)
      } catch {}
    }
  }
  walk(entity)
  return out
}

const hasFill = (v: any): boolean =>
  Array.isArray(v.fills) && v.fills.length > 0 && v.fills[0].visible !== false
const hasStroke = (v: any): boolean =>
  Array.isArray(v.strokes) && v.strokes.length > 0 && v.strokes[0].visible !== false

const solid = (color: { r: number; g: number; b: number }): any[] => [{ type: 'SOLID', color }]

export function extractErdPaints(
  vectors: any[],
  rowCount: number,
  themeVariables?: Record<string, any>,
): ErdPaints {
  const fillVectors = vectors.filter(hasFill)
  const strokeOnly = vectors.filter((v) => hasStroke(v) && !hasFill(v))

  let isDark = false
  for (const v of fillVectors) {
    const c = v.fills[0].color
    if (c && 0.299 * c.r + 0.587 * c.g + 0.114 * c.b < 0.45) isDark = true
  }
  // Live Mermaid theme variables win; missing keys fall back to the canonical preset.
  const tokens: Record<string, any> = {
    ...(isDark ? SYSTEM_THEME_PRESETS.dark : SYSTEM_THEME_PRESETS.light),
    ...(themeVariables || {}),
  }

  const fallbackHeader =
    parseColorToFigma(tokens.primaryColor) ||
    (isDark ? { r: 0.1176, g: 0.1608, b: 0.2314 } : { r: 1, g: 1, b: 1 })
  const fallbackOdd =
    parseColorToFigma(tokens.attributeBackgroundColorOdd) ||
    (isDark ? { r: 0.1176, g: 0.1608, b: 0.2314 } : { r: 1, g: 1, b: 1 })
  const fallbackEven =
    parseColorToFigma(tokens.attributeBackgroundColorEven) ||
    (isDark ? { r: 0.0745, g: 0.1059, b: 0.1804 } : { r: 0.9804, g: 0.9804, b: 0.9804 })
  const fallbackBorder =
    parseColorToFigma(tokens.primaryBorderColor) ||
    (isDark ? { r: 0.2196, g: 0.7412, b: 0.9725 } : { r: 0.8941, g: 0.8941, b: 0.9059 })

  const headerSvg = fillVectors.length > 0
  const headerFill = headerSvg ? fillVectors[0].fills : solid(fallbackHeader)

  const rowFills: any[][] = []
  const rowsSvg: boolean[] = []
  for (let i = 0; i < rowCount; i++) {
    const v = fillVectors[i + 1]
    if (v) {
      rowFills.push(v.fills)
      rowsSvg.push(true)
    } else {
      rowFills.push(solid(i % 2 === 0 ? fallbackOdd : fallbackEven))
      rowsSvg.push(false)
    }
  }

  const borderVector = strokeOnly[0] || vectors.find(hasStroke)
  const borderSvg = Boolean(borderVector)
  const border = borderVector ? borderVector.strokes : solid(fallbackBorder)

  return { headerFill, rowFills, border, isDark, fromSvg: { header: headerSvg, rows: rowsSvg, border: borderSvg } }
}
