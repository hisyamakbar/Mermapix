// Generic shape engine (Phase 8.2): turns Mermaid shape groups into native Figma structure.
//
// Figma's SVG importer produces, per Mermaid node, a GROUP holding one VECTOR (fill + stroke),
// sometimes TWO stacked vectors with identical bounds (fill path + outline path), and a loose TEXT.
// This module converts such a group into:
//   - rect-like shapes (rect, rounded rect, stadium, circle): ONE Auto Layout FRAME carrying the
//     fill, stroke, dash and corner radius, FIXED size = Mermaid bounds, centered text child;
//   - complex shapes (diamond, hexagon, cylinder, ...): a wrapper Auto Layout FRAME (no paint,
//     FIXED size) holding the single merged VECTOR (layoutPositioning ABSOLUTE) + centered text.
// Node frames keep FIXED size and absolute position so Mermaid's connectors stay attached.
// Reusable by flowchart (8.3), sequence (8.4) and other diagram types (8.5).

import {
  classifyShape,
  groupStackedBounds,
  interStyleForWeight,
  isRealDash,
  mergePaints,
  offsetToPadding,
  type ShapeClass,
  type ShapeKind,
} from './shapeGeometry.ts'

export type { ShapeClass, ShapeKind }

export interface ConvertedShape {
  frame: any
  kind: ShapeKind
  rectLike: boolean
  label: string
  /** Label width after the Inter switch exceeded the (fixed) frame width. */
  textOverflow: boolean
  textWidth: number
  frameWidth: number
}

export interface ConvertShapeOptions {
  /** Mermaid node id, stored as plugin data so later phases can match connectors. */
  nodeId?: string
}

// ---------------------------------------------------------------- node helpers

const isLive = (n: any): boolean => Boolean(n) && !n.removed

export const hasFill = (v: any): boolean =>
  Array.isArray(v.fills) && v.fills.length > 0 && v.fills[0].visible !== false && v.fills[0].opacity !== 0
export const hasStroke = (v: any): boolean =>
  Array.isArray(v.strokes) &&
  v.strokes.length > 0 &&
  v.strokes[0].visible !== false &&
  v.strokes[0].opacity !== 0 &&
  Number(v.strokeWeight) > 0

/** Origin of the coordinate space children of `parent` live in (GROUPs are transparent). */
export function childOrigin(parent: any): { x: number; y: number } {
  if (!parent) return { x: 0, y: 0 }
  if (parent.type === 'GROUP') return childOrigin(parent.parent)
  if (parent.type === 'FRAME' || parent.type === 'COMPONENT' || parent.type === 'INSTANCE') {
    const o = childOrigin(parent.parent)
    return { x: o.x + (parent.x || 0), y: o.y + (parent.y || 0) }
  }
  return { x: 0, y: 0 }
}

/** Converts a position relative to `from`'s coordinate space into `to`'s coordinate space. */
export function rebase(x: number, y: number, from: any, to: any): { x: number; y: number } {
  const a = childOrigin(from)
  const b = childOrigin(to)
  return { x: x + a.x - b.x, y: y + a.y - b.y }
}

export interface Collected {
  vectors: any[]
  texts: any[]
  others: any[]
}

/** All VECTOR / non-empty TEXT descendants in z-order; anything else (not a GROUP) lands in `others`. */
export function collectParts(container: any): Collected {
  const out: Collected = { vectors: [], texts: [], others: [] }
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c)) continue
      if (c.type === 'VECTOR') out.vectors.push(c)
      else if (c.type === 'TEXT') {
        if ((c.characters || '').trim().length > 0) out.texts.push(c)
      } else if (c.type === 'GROUP') visit(c)
      else out.others.push(c)
    }
  }
  visit(container)
  return out
}

export function cloneAll<T>(arr: T[]): T[] {
  try {
    return JSON.parse(JSON.stringify(arr))
  } catch {
    return arr
  }
}

export function pathDataOf(v: any): string {
  const p = v && Array.isArray(v.vectorPaths) ? v.vectorPaths[0] : null
  return p && typeof p.data === 'string' ? p.data : ''
}

export function labelOf(texts: any[]): string {
  const s = texts
    .map((t) => (t.characters || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
  return s.length > 60 ? s.slice(0, 57) + '...' : s
}

// ---------------------------------------------------------------- text

/**
 * Switches a shape label from the imported Arial to Inter (weight mapped from the original),
 * keeps size and color, centers it and lets Figma re-measure the box.
 */
export function styleShapeText(t: any): void {
  const original = typeof t.fontWeight === 'number' ? t.fontWeight : t.fontName && /bold/i.test(t.fontName.style || '') ? 700 : 400
  const style = interStyleForWeight(original)
  const italic = Boolean(t.fontName && /italic/i.test(t.fontName.style || ''))
  const italicStyle = style === 'Regular' ? 'Italic' : `${style} Italic`
  try {
    t.fontName = { family: 'Inter', style: italic ? italicStyle : style }
  } catch {
    try {
      t.fontName = { family: 'Inter', style }
    } catch {
      try {
        t.fontName = { family: 'Inter', style: 'Regular' }
      } catch {}
    }
  }
  try {
    t.textAlignHorizontal = 'CENTER'
  } catch {}
  try {
    t.textAlignVertical = 'CENTER'
  } catch {}
  try {
    t.textAutoResize = 'WIDTH_AND_HEIGHT'
  } catch {}
  try {
    t.visible = true
  } catch {}
  const label = (t.characters || '').trim().replace(/\s+/g, ' ')
  t.name = label.length > 28 ? label.slice(0, 28) + '...' : label
}

// ---------------------------------------------------------------- frames

interface FrameSpec {
  name: string
  x: number
  y: number
  width: number
  height: number
  paddingTop?: number
  paddingBottom?: number
}

/** Fixed-size, center/center Auto Layout frame without paint (caller sets fills/strokes). */
export function createCenteredFrame(spec: FrameSpec): any {
  const f = figma.createFrame()
  f.name = spec.name
  f.layoutMode = 'HORIZONTAL'
  f.primaryAxisSizingMode = 'FIXED'
  f.counterAxisSizingMode = 'FIXED'
  f.primaryAxisAlignItems = 'CENTER'
  f.counterAxisAlignItems = 'CENTER'
  f.itemSpacing = 0
  f.paddingLeft = 0
  f.paddingRight = 0
  f.paddingTop = spec.paddingTop || 0
  f.paddingBottom = spec.paddingBottom || 0
  f.resize(spec.width, spec.height)
  f.x = spec.x
  f.y = spec.y
  f.fills = []
  f.strokes = []
  // Labels may be a hair wider than the shape after the Inter switch: never clip them.
  f.clipsContent = false
  return f
}

export function applyStroke(frame: any, src: any, dash: number[]): void {
  frame.strokes = src.strokes
  frame.strokeWeight = src.strokeWeight
  frame.strokeAlign = src.strokeAlign || 'CENTER'
  if (isRealDash(dash)) frame.dashPattern = dash
}

export function tag(frame: any, key: string, value: string | undefined): void {
  if (value && typeof frame.setPluginData === 'function') {
    try {
      frame.setPluginData(key, value)
    } catch {}
  }
}

/** Replaces `vector` + `text` (pill / badge style) by one Auto Layout frame carrying the vector's paint. */
export function convertVectorWithLabel(
  vector: any,
  text: any,
  name: string,
  cls: ShapeClass,
  extraTag?: string,
): any {
  const parent = vector.parent
  const index = parent.children.indexOf(vector)
  const w = vector.width
  const h = vector.height
  const frame = createCenteredFrame({ name, x: 0, y: 0, width: w, height: h })
  parent.insertChild(index, frame)
  frame.x = vector.x
  frame.y = vector.y
  frame.fills = hasFill(vector) ? vector.fills : []
  if (hasStroke(vector)) applyStroke(frame, vector, vector.dashPattern)
  frame.cornerRadius = cls.cornerRadius
  styleShapeText(text)
  frame.appendChild(text)
  vector.remove()
  tag(frame, 'mermapix:kind', extraTag)
  return frame
}

/**
 * Replaces a stack of identical-bounds vectors (fill path + outline path, Phase 8.5) by ONE fixed-size
 * frame carrying the merged fill + stroke + dash + corner radius. The frame is inserted into
 * `parentNode` at `index` (default: where the first vector was). Returns the frame; the vectors are removed.
 */
export function paintFrameFromVectors(
  vectors: any[],
  cls: ShapeClass,
  name: string,
  parentNode?: any,
  index?: number,
): any {
  const v0 = vectors[0]
  const parent = parentNode || v0.parent
  const at = index !== undefined ? index : parent.children.indexOf(v0)
  const merge = mergePaints(
    vectors.map((vec) => ({
      hasFill: hasFill(vec),
      hasStroke: hasStroke(vec),
      strokeWeight: Number(vec.strokeWeight) || 0,
      dashPattern: Array.isArray(vec.dashPattern) ? vec.dashPattern : [],
    })),
  )
  const frame = createCenteredFrame({ name, x: 0, y: 0, width: v0.width, height: v0.height })
  parent.insertChild(Math.max(0, Math.min(at, parent.children.length)), frame)
  const pos = rebase(v0.x, v0.y, v0.parent, parent)
  frame.x = pos.x
  frame.y = pos.y
  const fillSrc = merge.fillFrom >= 0 ? vectors[merge.fillFrom] : null
  const strokeSrc = merge.strokeFrom >= 0 ? vectors[merge.strokeFrom] : null
  frame.fills = fillSrc ? cloneAll(fillSrc.fills) : []
  if (strokeSrc) applyStroke(frame, strokeSrc, merge.dash)
  frame.cornerRadius = cls.cornerRadius
  for (const v of vectors) {
    if (isLive(v)) {
      try {
        v.remove()
      } catch {}
    }
  }
  tag(frame, 'mermapix:kind', cls.kind)
  return frame
}

// ---------------------------------------------------------------- shape groups

interface Visual {
  vectors: any[]
  x: number
  y: number
  width: number
  height: number
}

/**
 * Converts one Mermaid node group (shape vector(s) + label text) into a native frame.
 * Returns null (group untouched) when it has no vector, or contains unknown node types.
 */
export function convertShapeGroup(group: any, opts: ConvertShapeOptions = {}): ConvertedShape | null {
  if (!isLive(group) || !group.parent || !('children' in group)) return null
  const parts = collectParts(group)
  if (parts.vectors.length === 0 || parts.others.length > 0) return null

  // Merge stacked fill/outline duplicates: identical bounds = one visual.
  const visuals: Visual[] = groupStackedBounds(parts.vectors).map((vs) => ({
    vectors: vs,
    x: vs[0].x,
    y: vs[0].y,
    width: vs[0].width,
    height: vs[0].height,
  }))
  const area = (v: Visual): number => v.width * v.height
  const primary = visuals.reduce((a, b) => (area(b) > area(a) ? b : a))

  const merged = visuals.map((v) => {
    const m = mergePaints(
      v.vectors.map((vec) => ({
        hasFill: hasFill(vec),
        hasStroke: hasStroke(vec),
        strokeWeight: Number(vec.strokeWeight) || 0,
        dashPattern: Array.isArray(vec.dashPattern) ? vec.dashPattern : [],
      })),
    )
    return { visual: v, merge: m }
  })
  const primaryMerge = merged.find((m) => m.visual === primary)!
  const pathSource = primary.vectors[Math.max(0, primaryMerge.merge.fillFrom)]
  let cls: ShapeClass = classifyShape(pathDataOf(pathSource), primary.width, primary.height)
  if (visuals.length > 1) {
    const circles = visuals.every((v) => classifyShape(pathDataOf(v.vectors[0]), v.width, v.height).kind === 'Circle')
    cls = { kind: circles ? 'Double Circle' : cls.kind, rectLike: false, cornerRadius: 0 }
  }

  const label = labelOf(parts.texts)
  const parentNode = group.parent
  const index = parentNode.children.indexOf(group)
  const bx = Math.min(...visuals.map((v) => v.x))
  const by = Math.min(...visuals.map((v) => v.y))
  const bw = Math.max(...visuals.map((v) => v.x + v.width)) - bx
  const bh = Math.max(...visuals.map((v) => v.y + v.height)) - by

  // Single label: centered by Auto Layout, with the original vertical offset kept as padding.
  const single = parts.texts.length === 1 ? parts.texts[0] : null
  let padTop = 0
  let padBottom = 0
  if (single) {
    const delta = single.y + single.height / 2 - (by + bh / 2)
    const pad = offsetToPadding(delta)
    padTop = Math.min(pad.start, bh)
    padBottom = Math.min(pad.end, bh)
  }

  const groupOrigin = group.parent
  const frame = createCenteredFrame({
    name: label || 'Shape',
    x: 0,
    y: 0,
    width: bw,
    height: bh,
    paddingTop: padTop,
    paddingBottom: padBottom,
  })
  parentNode.insertChild(index, frame)
  const pos = rebase(bx, by, groupOrigin, parentNode)
  frame.x = pos.x
  frame.y = pos.y

  // Paint
  const kept: any[] = []
  for (const { visual, merge } of merged) {
    const fillSrc = merge.fillFrom >= 0 ? visual.vectors[merge.fillFrom] : null
    const strokeSrc = merge.strokeFrom >= 0 ? visual.vectors[merge.strokeFrom] : null
    const base = fillSrc || strokeSrc || visual.vectors[0]
    if (cls.rectLike && visual === primary) {
      frame.fills = fillSrc ? cloneAll(fillSrc.fills) : []
      if (strokeSrc) applyStroke(frame, strokeSrc, merge.dash)
      frame.cornerRadius = cls.cornerRadius
    } else {
      // Keep one vector per visual, carrying the merged fill + stroke + dash.
      base.fills = fillSrc ? cloneAll(fillSrc.fills) : []
      if (strokeSrc) {
        base.strokes = cloneAll(strokeSrc.strokes)
        base.strokeWeight = strokeSrc.strokeWeight
        base.strokeAlign = strokeSrc.strokeAlign || 'CENTER'
        if (isRealDash(merge.dash)) base.dashPattern = merge.dash
      } else {
        base.strokes = []
      }
      kept.push({ vec: base, visual })
    }
  }

  // Children: vectors first (bottom), label(s) on top.
  for (const { vec, visual } of kept) {
    frame.appendChild(vec)
    try {
      vec.layoutPositioning = 'ABSOLUTE'
    } catch {}
    vec.x = visual.x - bx
    vec.y = visual.y - by
    try {
      vec.constraints = { horizontal: 'SCALE', vertical: 'SCALE' }
    } catch {}
    vec.name = cls.kind
  }
  let textWidth = 0
  for (const t of parts.texts) {
    if (single) {
      styleShapeText(t)
      frame.appendChild(t)
      textWidth = t.width
    } else {
      // Several loose labels: keep each exactly where Mermaid put it.
      const rel = rebase(t.x, t.y, groupOrigin, frame)
      const rx = rel.x
      const ry = rel.y
      frame.appendChild(t)
      try {
        t.layoutPositioning = 'ABSOLUTE'
      } catch {}
      t.x = rx
      t.y = ry
      textWidth = Math.max(textWidth, t.width)
    }
  }

  // Remove every original vector that was not kept, then the emptied group shell.
  for (const v of parts.vectors) {
    if (isLive(v) && v.parent !== frame) {
      try {
        v.remove()
      } catch {}
    }
  }
  try {
    group.remove()
  } catch {}

  tag(frame, 'mermapix:kind', cls.kind)
  tag(frame, 'mermapix:node', opts.nodeId)

  return {
    frame,
    kind: cls.kind,
    rectLike: cls.rectLike,
    label,
    textOverflow: textWidth > bw + 0.5,
    textWidth,
    frameWidth: bw,
  }
}
