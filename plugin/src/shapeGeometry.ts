// Pure shape geometry helpers for the generic shape engine (no `figma` usage, unit-testable in node).
//
// Figma's SVG importer turns every Mermaid shape into a VECTOR whose `vectorPaths[0].data` is a
// normalized absolute path (M L C Q Z) translated so the geometry bounds start at 0,0. Everything
// here works from that path data plus the node bounds.

export interface Pt {
  x: number
  y: number
}

export interface PathCmd {
  c: 'M' | 'L' | 'H' | 'V' | 'C' | 'Q' | 'Z'
  p: number[]
}

export type ShapeKind =
  | 'Rectangle'
  | 'Rounded Rectangle'
  | 'Stadium'
  | 'Circle'
  | 'Ellipse'
  | 'Double Circle'
  | 'Diamond'
  | 'Hexagon'
  | 'Parallelogram'
  | 'Trapezoid'
  | 'Subroutine'
  | 'Cylinder'
  | 'Flag'
  | 'Polygon'
  | 'Shape'

export interface ShapeClass {
  kind: ShapeKind
  /** True when a plain Auto Layout frame (fill + stroke + corner radius) can represent the shape. */
  rectLike: boolean
  cornerRadius: number
}

const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 }

/** Parses absolute SVG path data. Returns null for anything outside M L H V C Q Z. */
export function parsePathData(d: string | null | undefined): PathCmd[] | null {
  if (typeof d !== 'string') return null
  const toks = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!toks || toks.length === 0) return null
  const out: PathCmd[] = []
  let i = 0
  while (i < toks.length) {
    const t = toks[i]
    if (!/^[A-Za-z]$/.test(t)) return null
    const cmd = t as PathCmd['c']
    const n = ARG_COUNT[cmd]
    if (n === undefined) return null
    i++
    if (n === 0) {
      out.push({ c: cmd, p: [] })
      continue
    }
    let first = true
    let any = false
    while (i < toks.length && !/^[A-Za-z]$/.test(toks[i])) {
      if (i + n > toks.length) return null
      const p = toks.slice(i, i + n).map(Number)
      if (p.some((v) => !Number.isFinite(v))) return null
      out.push({ c: !first && cmd === 'M' ? 'L' : cmd, p })
      first = false
      any = true
      i += n
    }
    if (!any) return null
  }
  return out
}

export interface Flattened {
  /** Sampled polylines, one per subpath. */
  subpaths: Pt[][]
  curveCount: number
  lineCount: number
}

/** Samples a path into polylines (straight edges every <= 2px, curves adaptively). */
export function flattenPath(cmds: PathCmd[]): Flattened {
  const subpaths: Pt[][] = []
  let cur: Pt[] | null = null
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let curveCount = 0
  let lineCount = 0
  const lineTo = (nx: number, ny: number): void => {
    if (!cur) {
      cur = [{ x, y }]
      subpaths.push(cur)
    }
    const len = Math.hypot(nx - x, ny - y)
    const steps = Math.min(400, Math.max(1, Math.ceil(len / 2)))
    for (let s = 1; s <= steps; s++) {
      cur.push({ x: x + ((nx - x) * s) / steps, y: y + ((ny - y) * s) / steps })
    }
    x = nx
    y = ny
  }
  for (const { c, p } of cmds) {
    if (c === 'M') {
      x = sx = p[0]
      y = sy = p[1]
      cur = [{ x, y }]
      subpaths.push(cur)
    } else if (c === 'L') {
      lineCount++
      lineTo(p[0], p[1])
    } else if (c === 'H') {
      lineCount++
      lineTo(p[0], y)
    } else if (c === 'V') {
      lineCount++
      lineTo(x, p[0])
    } else if (c === 'C' || c === 'Q') {
      curveCount++
      if (!cur) {
        cur = [{ x, y }]
        subpaths.push(cur)
      }
      const chord = Math.hypot((c === 'C' ? p[4] : p[2]) - x, (c === 'C' ? p[5] : p[3]) - y)
      const steps = Math.min(64, Math.max(8, Math.ceil(chord / 3)))
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const u = 1 - t
        if (c === 'C') {
          cur.push({
            x: u * u * u * x + 3 * u * u * t * p[0] + 3 * u * t * t * p[2] + t * t * t * p[4],
            y: u * u * u * y + 3 * u * u * t * p[1] + 3 * u * t * t * p[3] + t * t * t * p[5],
          })
        } else {
          cur.push({
            x: u * u * x + 2 * u * t * p[0] + t * t * p[2],
            y: u * u * y + 2 * u * t * p[1] + t * t * p[3],
          })
        }
      }
      x = c === 'C' ? p[4] : p[2]
      y = c === 'C' ? p[5] : p[3]
    } else if (c === 'Z') {
      if (cur && (x !== sx || y !== sy)) lineTo(sx, sy)
      x = sx
      y = sy
      cur = null
    }
  }
  return { subpaths, curveCount, lineCount }
}

export function polylineLength(pts: Pt[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return len
}

/** Max distance of the sampled points from the outline of a w x h rounded rectangle of radius r. */
export function roundedRectDeviation(pts: Pt[], w: number, h: number, r: number): number {
  const hx = w / 2
  const hy = h / 2
  let max = 0
  for (const p of pts) {
    const qx = Math.abs(p.x - hx) - (hx - r)
    const qy = Math.abs(p.y - hy) - (hy - r)
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
    const a = Math.abs(d)
    if (a > max) max = a
  }
  return max
}

const idealPerimeter = (w: number, h: number, r: number): number =>
  2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r

const RR_TOLERANCE = 0.8

/**
 * Fits a single closed outline to a rounded rectangle of the given bounds.
 * Returns the best radius, or null when the outline is not a (rounded) rectangle.
 */
export function fitRoundedRect(pts: Pt[], w: number, h: number): number | null {
  if (pts.length < 4 || w < 1 || h < 1) return null
  const rMax = Math.min(w, h) / 2
  const len = polylineLength(pts)
  const dev = (r: number): number => roundedRectDeviation(pts, w, h, r)
  let bestR = 0
  let bestD = Infinity
  for (let r = 0; r <= rMax + 1e-9; r += 0.5) {
    const d = dev(Math.min(r, rMax))
    if (d < bestD) {
      bestD = d
      bestR = Math.min(r, rMax)
    }
  }
  const dEnd = dev(rMax)
  if (dEnd <= bestD) {
    bestD = dEnd
    bestR = rMax
  }
  const lo = Math.max(0, bestR - 0.5)
  const hi = Math.min(rMax, bestR + 0.5)
  for (let r = lo; r <= hi + 1e-9; r += 0.05) {
    const d = dev(Math.min(r, rMax))
    if (d < bestD) {
      bestD = d
      bestR = Math.min(r, rMax)
    }
  }
  if (bestD > RR_TOLERANCE) return null
  const ideal = idealPerimeter(w, h, bestR)
  if (Math.abs(len - ideal) > Math.max(2.5, ideal * 0.03)) return null
  return bestR
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol

/** Corner points of a polyline-only path (M/L/H/V/Z), consecutive duplicates and closing point removed. */
function polygonVertices(cmds: PathCmd[]): Pt[][] {
  const polys: Pt[][] = []
  let cur: Pt[] | null = null
  let x = 0
  let y = 0
  const push = (nx: number, ny: number): void => {
    x = nx
    y = ny
    if (!cur) {
      cur = []
      polys.push(cur)
    }
    const last = cur[cur.length - 1]
    if (!last || !near(last.x, nx, 0.01) || !near(last.y, ny, 0.01)) cur.push({ x: nx, y: ny })
  }
  for (const { c, p } of cmds) {
    if (c === 'M') {
      cur = null
      push(p[0], p[1])
    } else if (c === 'L') push(p[0], p[1])
    else if (c === 'H') push(p[0], y)
    else if (c === 'V') push(x, p[0])
  }
  for (const poly of polys) {
    if (poly.length > 1) {
      const a = poly[0]
      const b = poly[poly.length - 1]
      if (near(a.x, b.x, 0.01) && near(a.y, b.y, 0.01)) poly.pop()
    }
  }
  return polys
}

/** Douglas-Peucker simplification of a closed outline (splits at the two farthest-apart samples). */
export function simplifyClosed(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts
  const open = pts.slice()
  const first = open[0]
  const last = open[open.length - 1]
  if (near(first.x, last.x, 0.01) && near(first.y, last.y, 0.01)) open.pop()
  let far = 0
  let best = -1
  open.forEach((p, i) => {
    const d = Math.hypot(p.x - open[0].x, p.y - open[0].y)
    if (d > best) {
      best = d
      far = i
    }
  })
  const dp = (seg: Pt[]): Pt[] => {
    if (seg.length < 3) return seg
    const a = seg[0]
    const b = seg[seg.length - 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9
    let idx = -1
    let max = 0
    for (let i = 1; i < seg.length - 1; i++) {
      const d = Math.abs((b.x - a.x) * (a.y - seg[i].y) - (a.x - seg[i].x) * (b.y - a.y)) / len
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (max <= eps) return [a, b]
    return dp(seg.slice(0, idx + 1)).slice(0, -1).concat(dp(seg.slice(idx)))
  }
  const left = dp(open.slice(0, far + 1))
  const right = dp(open.slice(far).concat([open[0]]))
  return left.slice(0, -1).concat(right.slice(0, -1))
}

/** True when the outline follows an axis-aligned ellipse inscribed in the w x h bounds. */
export function isEllipseOutline(pts: Pt[], w: number, h: number): boolean {
  const a = w / 2
  const b = h / 2
  if (a < 1 || b < 1) return false
  return pts.every((p) => Math.abs(Math.hypot((p.x - a) / a, (p.y - b) / b) - 1) <= 0.04)
}

/** True when the 4 vertices are exactly the corners of the w x h bounds (in any order). */
export function isBoundsCorners(poly: Pt[], w: number, h: number): boolean {
  const tol = Math.max(0.5, Math.min(w, h) * 0.01)
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  return corners.every((c) => poly.some((p) => near(p.x, c.x, tol) && near(p.y, c.y, tol)))
}

function classifyPolygon(poly: Pt[], w: number, h: number): ShapeKind {
  const tol = Math.max(1, Math.min(w, h) * 0.02)
  const n = poly.length
  if (n === 4) {
    const mids: Pt[] = [
      { x: w / 2, y: 0 },
      { x: w, y: h / 2 },
      { x: w / 2, y: h },
      { x: 0, y: h / 2 },
    ]
    if (mids.every((m) => poly.some((p) => near(p.x, m.x, tol) && near(p.y, m.y, tol)))) return 'Diamond'
    const ys = [...new Set(poly.map((p) => Math.round(p.y / tol)))]
    if (ys.length === 2) {
      const top = poly.filter((p) => near(p.y, 0, tol)).map((p) => p.x).sort((a, b) => a - b)
      const bottom = poly.filter((p) => near(p.y, h, tol)).map((p) => p.x).sort((a, b) => a - b)
      if (top.length === 2 && bottom.length === 2) {
        const topW = top[1] - top[0]
        const botW = bottom[1] - bottom[0]
        if (near(topW, botW, tol) && !near(top[0], bottom[0], tol)) return 'Parallelogram'
        if (!near(topW, botW, tol)) return 'Trapezoid'
      }
    }
    return 'Polygon'
  }
  if (n === 6) return 'Hexagon'
  if (n === 5) return 'Flag'
  return 'Polygon'
}

/**
 * Classifies a shape from its vector path data and bounds.
 *  - rect / rounded rect / stadium / circle  -> rectLike (Auto Layout frame with corner radius)
 *  - everything else                         -> complex (wrapper frame around the vector)
 */
export function classifyShape(data: string | null | undefined, width: number, height: number): ShapeClass {
  const complex = (kind: ShapeKind): ShapeClass => ({ kind, rectLike: false, cornerRadius: 0 })
  const cmds = parsePathData(data)
  if (!cmds || width < 1 || height < 1) return complex('Shape')
  const flat = flattenPath(cmds)
  if (flat.subpaths.length === 1) {
    const r = fitRoundedRect(flat.subpaths[0], width, height)
    if (r !== null) {
      const rMax = Math.min(width, height) / 2
      if (r <= 0.3) return { kind: 'Rectangle', rectLike: true, cornerRadius: 0 }
      if (r >= rMax - 0.6) {
        const circle = near(width, height, 0.6)
        return { kind: circle ? 'Circle' : 'Stadium', rectLike: true, cornerRadius: rMax }
      }
      return { kind: 'Rounded Rectangle', rectLike: true, cornerRadius: Math.round(r * 100) / 100 }
    }
  }
  if (flat.curveCount === 0) {
    const polys = polygonVertices(cmds)
    if (polys.length === 1) {
      const poly = polys[0]
      const axisAligned = poly.every((p, i) => {
        const q = poly[(i + 1) % poly.length]
        return near(p.x, q.x, 0.01) || near(p.y, q.y, 0.01)
      })
      // Rough/classic rectangles arrive as an OPEN 4-corner polygon (the closing side is implicit in the fill).
      if (poly.length === 4 && isBoundsCorners(poly, width, height)) return { kind: 'Rectangle', rectLike: true, cornerRadius: 0 }
      if (axisAligned && poly.length > 4) return complex('Subroutine')
      return complex(classifyPolygon(poly, width, height))
    }
    const allRects = polys.length > 1 && polys.every((p) => p.length === 4)
    return complex(allRects ? 'Subroutine' : 'Shape')
  }
  if (flat.lineCount === 0 && flat.subpaths.length === 1) {
    const outline = flat.subpaths[0]
    if (isEllipseOutline(outline, width, height)) return complex(near(width, height, 0.6) ? 'Circle' : 'Ellipse')
    // Hand-drawn style polygons arrive as curves: judge them by their simplified outline.
    const poly = simplifyClosed(outline, Math.max(1.5, Math.min(width, height) * 0.04))
    return complex(poly.length <= 8 ? classifyPolygon(poly, width, height) : 'Shape')
  }
  const verticalOnly = cmds.every((c, i) => {
    if (c.c !== 'L') return true
    const prev = cmds[i - 1]
    if (!prev || prev.p.length < 2) return false
    const px = prev.p[prev.p.length - 2]
    return near(c.p[0], px, 0.5)
  })
  if (flat.lineCount > 0 && verticalOnly) return complex('Cylinder')
  return complex('Shape')
}

// ---------------------------------------------------------------- pairs (fill path + outline path)

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export function sameBounds(a: Bounds, b: Bounds, tol = 0.5): boolean {
  return (
    near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.width, b.width, tol) && near(a.height, b.height, tol)
  )
}

/** Groups items with identical bounds (stacked fill/outline duplicates), preserving z-order. */
export function groupStackedBounds<T extends Bounds>(items: T[], tol = 0.5): T[][] {
  const groups: T[][] = []
  for (const it of items) {
    const g = groups.find((grp) => sameBounds(grp[0], it, tol))
    if (g) g.push(it)
    else groups.push([it])
  }
  return groups
}

export interface PaintInfo {
  hasFill: boolean
  hasStroke: boolean
  strokeWeight: number
  dashPattern: number[]
}

/** A dash pattern that actually draws gaps (rejects `[]`, `[0,0]` and `[1,0]`). */
export function isRealDash(pattern: number[] | null | undefined): boolean {
  if (!Array.isArray(pattern) || pattern.length === 0) return false
  const seq = pattern.length % 2 === 1 ? pattern.concat(pattern) : pattern
  let dash = 0
  let gap = 0
  seq.forEach((v, i) => {
    if (i % 2 === 0) dash += v
    else gap += v
  })
  return dash > 0 && gap > 0
}

export interface MergedPaint {
  fillFrom: number
  strokeFrom: number
  dash: number[]
}

/**
 * Decides which vector of a stacked group supplies the fill and which supplies the stroke.
 * Fill: first vector with a fill. Stroke: the fill source if it has a stroke, else the first
 * stroked vector. Dash: the stroke source's dash, otherwise any real dash among stroked vectors,
 * so a dash pattern or weight is never lost by dropping the duplicate.
 */
export function mergePaints(items: PaintInfo[]): MergedPaint {
  const fillFrom = items.findIndex((v) => v.hasFill)
  let strokeFrom = -1
  if (fillFrom >= 0 && items[fillFrom].hasStroke) strokeFrom = fillFrom
  else strokeFrom = items.findIndex((v) => v.hasStroke)
  let dash: number[] = []
  if (strokeFrom >= 0) {
    if (isRealDash(items[strokeFrom].dashPattern)) dash = items[strokeFrom].dashPattern
    else {
      const other = items.find((v) => v.hasStroke && isRealDash(v.dashPattern))
      if (other) dash = other.dashPattern
    }
  }
  return { fillFrom, strokeFrom, dash }
}

// ---------------------------------------------------------------- text

/** Inter style for an original font weight (400 Regular, 500 Medium, 600 Semi Bold, 700+ Bold). */
export function interStyleForWeight(weight: number | null | undefined): 'Regular' | 'Medium' | 'Semi Bold' | 'Bold' {
  const w = typeof weight === 'number' && Number.isFinite(weight) ? weight : 400
  if (w <= 450) return 'Regular'
  if (w <= 550) return 'Medium'
  if (w <= 650) return 'Semi Bold'
  return 'Bold'
}

/**
 * Auto Layout centers content in the content box, so a vertical offset of the label from the
 * shape center (e.g. Mermaid's cylinders) is reproduced with asymmetric padding.
 * Offsets below `threshold` px are ignored (font metric noise).
 */
export function offsetToPadding(delta: number, threshold = 1.5): { start: number; end: number } {
  if (!Number.isFinite(delta) || Math.abs(delta) < threshold) return { start: 0, end: 0 }
  return delta > 0 ? { start: Math.round(delta * 2 * 100) / 100, end: 0 } : { start: 0, end: Math.round(-delta * 2 * 100) / 100 }
}
