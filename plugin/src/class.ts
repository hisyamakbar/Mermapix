// classDiagram conversion (Phase 8.5).
//
// Mermaid draws a class as a GROUP `…-classId-<id>-<n>` holding a stacked rect pair (fill path +
// outline path), one divider stroke per compartment boundary, and one loose TEXT per line
// (annotation, title, every attribute, every method). This rebuilds it like an ERD table:
//   Class frame  = VERTICAL Auto Layout, FIXED at the exact box bounds, fill + border on the frame
//   Header       = annotation + title, centered, border-bottom = divider 1
//   Attributes   = left aligned member lines, border-bottom = divider 2
//   Methods      = left aligned member lines
// Dividers are the INSIDE-bottom border of the compartment above, spanning exactly the original
// centered stroke, so there are no divider vectors left. Namespaces are cluster frames
// (`Namespace: <name>`), notes are Auto Layout frames, relations are grouped by connectors.ts.

import { classifyShape, groupStackedBounds, isRealDash, mergePaints } from './shapeGeometry.ts'
import {
  applyStroke,
  cloneAll,
  collectParts,
  convertShapeGroup,
  hasFill,
  hasStroke,
  pathDataOf,
  rebase,
  styleShapeText,
  tag,
} from './shapes.ts'
import { CLUSTER_LABEL_KEY, NODE_ID_KEY } from './subgraphs.ts'
import {
  centerPadding,
  classIdFromName,
  classInterfaceIdFromName,
  classNoteIdFromName,
  compartmentIndex,
  compartmentName,
  isAnnotationText,
  splitCompartments,
  stackPadding,
  type Divider,
} from './classGeometry.ts'

const isLive = (n: any): boolean => Boolean(n) && !n.removed

export interface ClassResult {
  frame: any
  id: string
  title: string
  compartments: any[]
}

function findGroups(root: any, idOf: (name: string) => string | null): Array<{ group: any; id: string }> {
  const out: Array<{ group: any; id: string }> = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c) || c.type !== 'GROUP') continue
      const id = idOf(c.name)
      if (id !== null) out.push({ group: c, id })
      else visit(c)
    }
  }
  visit(root)
  return out
}

interface Box {
  vectors: any[]
  x: number
  y: number
  width: number
  height: number
}

/** Splits a class group's vectors into the box stack and its horizontal divider strokes, or null when it looks different. */
function analyze(vectors: any[]): { box: Box; dividers: Array<Divider & { vec: any }> } | null {
  const stacks = groupStackedBounds(vectors)
  const area = (s: any[]): number => s[0].width * s[0].height
  const boxStack = stacks.reduce((a, b) => (area(b) > area(a) ? b : a))
  const b = boxStack[0]
  if (b.width < 2 || b.height < 2) return null
  const dividers: Array<Divider & { vec: any }> = []
  for (const s of stacks) {
    if (s === boxStack) continue
    const v = s[0]
    const horizontal = v.height <= 1.5 && v.width >= b.width * 0.9
    const inside = v.y >= b.y - 1 && v.y <= b.y + b.height + 1
    if (!horizontal || !inside || s.length !== 1) return null
    dividers.push({ y: v.y + v.height / 2, weight: Number(v.strokeWeight) || 1, vec: v })
  }
  return { box: { vectors: boxStack, x: b.x, y: b.y, width: b.width, height: b.height }, dividers }
}

function makeCompartment(name: string, width: number, height: number, centered: boolean): any {
  const f = figma.createFrame()
  f.name = name
  f.layoutMode = 'VERTICAL'
  f.primaryAxisSizingMode = 'FIXED'
  f.counterAxisSizingMode = 'FIXED'
  f.primaryAxisAlignItems = 'MIN'
  f.counterAxisAlignItems = centered ? 'CENTER' : 'MIN'
  f.itemSpacing = 0
  f.paddingLeft = 0
  f.paddingRight = 0
  f.paddingTop = 0
  f.paddingBottom = 0
  f.resize(width, Math.max(0, height))
  f.fills = []
  f.strokes = []
  f.clipsContent = false
  return f
}

/** Converts one class group; returns null (group untouched) when its structure is not the expected one. */
function convertClassGroup(group: any, id: string): ClassResult | null {
  if (!isLive(group) || !group.parent) return null
  const parts = collectParts(group)
  if (parts.vectors.length === 0 || parts.others.length > 0) return null
  const found = analyze(parts.vectors)
  if (!found) return null
  const { box, dividers } = found
  const fillPath = box.vectors.find(hasFill) || box.vectors[0]
  if (!classifyShape(pathDataOf(fillPath), box.width, box.height).rectLike) return null

  const spans = splitCompartments(box.y, box.y + box.height, dividers)
  const buckets: any[][] = spans.map(() => [])
  const sorted = [...parts.texts].sort((a, b) => a.y - b.y || a.x - b.x)
  // Original centers (before the Arial -> Inter switch changes the heights).
  const geo = new Map<any, { cx: number; cy: number; left: number }>()
  for (const t of sorted) {
    const abs = rebase(t.x, t.y, t.parent, group.parent)
    geo.set(t, { cx: abs.x + t.width / 2, cy: abs.y + t.height / 2, left: abs.x })
    buckets[compartmentIndex(spans, abs.y + t.height / 2)].push(t)
  }

  const parentNode = group.parent
  const index = parentNode.children.indexOf(group)
  const merge = mergePaints(
    box.vectors.map((vec) => ({
      hasFill: hasFill(vec),
      hasStroke: hasStroke(vec),
      strokeWeight: Number(vec.strokeWeight) || 0,
      dashPattern: Array.isArray(vec.dashPattern) ? vec.dashPattern : [],
    })),
  )
  const fillSrc = merge.fillFrom >= 0 ? box.vectors[merge.fillFrom] : null
  const strokeSrc = merge.strokeFrom >= 0 ? box.vectors[merge.strokeFrom] : null

  // Title = first non-annotation line of the header (a class without annotation has just the title).
  const header = buckets[0]
  const titleText = header.find((t) => !isAnnotationText(t.characters)) || header[header.length - 1]
  const title = (titleText ? titleText.characters : id).trim().replace(/\s+/g, ' ') || id

  const frame = figma.createFrame()
  frame.name = `Class: ${title}`
  frame.layoutMode = 'VERTICAL'
  frame.primaryAxisSizingMode = 'FIXED'
  frame.counterAxisSizingMode = 'FIXED'
  frame.primaryAxisAlignItems = 'MIN'
  frame.counterAxisAlignItems = 'MIN'
  frame.itemSpacing = 0
  frame.paddingLeft = 0
  frame.paddingRight = 0
  frame.paddingTop = 0
  frame.paddingBottom = 0
  frame.resize(box.width, box.height)
  parentNode.insertChild(index, frame)
  const pos = rebase(box.x, box.y, box.vectors[0].parent, parentNode)
  frame.x = pos.x
  frame.y = pos.y
  frame.clipsContent = false
  frame.fills = fillSrc ? cloneAll(fillSrc.fills) : []
  frame.strokes = []
  if (strokeSrc) applyStroke(frame, strokeSrc, merge.dash)
  else if (isRealDash(merge.dash)) frame.dashPattern = merge.dash
  frame.cornerRadius = 0

  const compartments: any[] = []
  spans.forEach((span, i) => {
    const texts = buckets[i]
    const centered = i === 0
    const comp = makeCompartment(compartmentName(i, spans.length), box.width, span.bottom - span.top, centered)
    frame.appendChild(comp)
    try {
      comp.layoutAlign = 'STRETCH'
    } catch {}
    // Divider i is the inside-bottom border of compartment i (the last compartment has none).
    const d = dividers.slice().sort((a, b) => a.y - b.y)[i]
    if (d && d.vec) {
      comp.strokes = cloneAll(d.vec.strokes)
      comp.strokeAlign = 'INSIDE'
      comp.strokeTopWeight = 0
      comp.strokeLeftWeight = 0
      comp.strokeRightWeight = 0
      comp.strokeBottomWeight = d.weight
    }

    const centers = texts.map((t) => (geo.get(t) as any).cy)
    for (const t of texts) {
      styleShapeText(t)
      if (!centered) {
        try {
          t.textAlignHorizontal = 'LEFT'
        } catch {}
      }
      comp.appendChild(t)
      if (centered) t.name = isAnnotationText(t.characters) ? `Annotation: ${t.characters.trim()}` : `Title: ${t.characters.trim()}`
    }
    const heights = texts.map((t) => t.height)
    const sp = stackPadding(centers, heights, span.top)
    comp.paddingTop = Math.min(sp.paddingTop, Math.max(0, comp.height - 1))
    comp.itemSpacing = sp.itemSpacing
    if (texts.length > 0) {
      if (centered) {
        const mean = texts.reduce((a, t) => a + (geo.get(t) as any).cx, 0) / texts.length
        const cp = centerPadding(mean, box.x, box.width)
        comp.paddingLeft = cp.left
        comp.paddingRight = cp.right
      } else {
        const left = Math.min(...texts.map((t) => (geo.get(t) as any).left))
        comp.paddingLeft = Math.max(0, Math.round((left - box.x) * 100) / 100)
      }
    }
    compartments.push(comp)
  })

  // Drop the original group (box pair, dividers, emptied wrappers).
  try {
    group.remove()
  } catch {}

  tag(frame, NODE_ID_KEY, id)
  tag(frame, CLUSTER_LABEL_KEY, title)
  tag(frame, 'mermapix:kind', 'Class')
  return { frame, id, title, compartments }
}

/** Converts every class box below `root` into a native frame. */
export function convertClasses(root: any): ClassResult[] {
  const out: ClassResult[] = []
  for (const { group, id } of findGroups(root, classIdFromName)) {
    const res = convertClassGroup(group, id)
    if (res) out.push(res)
  }
  return out
}

/** `note for X "…"` boxes -> Auto Layout note frames (`Note: <text>`), tagged so they nest and connect like nodes. */
export function convertClassNotes(root: any): any[] {
  const out: any[] = []
  for (const { group, id } of findGroups(root, classNoteIdFromName)) {
    const res = convertShapeGroup(group, { nodeId: id })
    if (!res) continue
    res.frame.name = `Note: ${res.label || id}`
    tag(res.frame, CLUSTER_LABEL_KEY, res.label || id)
    tag(res.frame, 'mermapix:kind', 'Note')
    out.push(res.frame)
  }
  return out
}

/** Lollipop interface nodes (`A ()-- B`): one small rect + the interface name -> `Interface: <name>` frame. */
export function convertClassInterfaces(root: any): any[] {
  const out: any[] = []
  for (const { group, id } of findGroups(root, classInterfaceIdFromName)) {
    const res = convertShapeGroup(group, { nodeId: id })
    if (!res) continue
    res.frame.name = `Interface: ${res.label || id}`
    tag(res.frame, CLUSTER_LABEL_KEY, res.label || id)
    tag(res.frame, 'mermapix:kind', 'Interface')
    out.push(res.frame)
  }
  return out
}
