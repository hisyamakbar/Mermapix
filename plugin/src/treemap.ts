// Treemap conversion (Phase 9.2). Mermaid's treemap is a flat list of groups (one per section / leaf,
// positioned by an absolute translate). They become native nested frames:
//   section  -> FRAME `Section: <name> (<value>)` at the section rect's bounds, fill + stroke (with their
//               opacity) merged on the frame, a `Header` frame (Auto Layout HORIZONTAL, name left / value right)
//               and the child sections / leaves nested by geometry
//   leaf     -> FRAME `Leaf: <label> (<value>)` at the leaf rect's bounds, fill + stroke merged, label + value
//               stacked and centered by VERTICAL Auto Layout (every text keeps its own font size)
// Frames are FIXED size and keep Mermaid's absolute positions. The header strip, the label clip rects and
// the section/leaf rects leave no vectors behind. Recognition is geometric (the payload has no classes).

import { absRect } from './subgraphs.ts'
import {
  applyStroke,
  childOrigin,
  cloneAll,
  hasFill,
  hasStroke,
  styleShapeText,
  tag,
} from './shapes.ts'
import {
  headerSpec,
  leafTitle,
  parentIndices,
  pickHeader,
  sectionTextRoles,
  sectionTitle,
  stackSpec,
  type Rect,
  type TextFacts,
} from './treemapGeometry.ts'

export const TREEMAP_SECTION_KIND = 'Treemap Section'
export const TREEMAP_LEAF_KIND = 'Treemap Leaf'

const isLive = (n: any): boolean => Boolean(n) && !n.removed

export interface TreemapResult {
  sections: number
  leaves: number
}

interface Entry {
  group: any
  kind: 'section' | 'leaf'
  box: any
  header: any | null
  vectors: any[]
  texts: any[]
  abs: Rect
  order: number
  parent: number
  frame?: any
}

const weightOf = (t: any): number =>
  typeof t.fontWeight === 'number' ? t.fontWeight : t.fontName && /bold/i.test(t.fontName.style || '') ? 700 : 400

const textFacts = (t: any): TextFacts => {
  const a = absRect(t)
  return { ...a, weight: weightOf(t) }
}

const sizedVector = (v: any): boolean => Math.round(v.width) !== 0 && Math.round(v.height) !== 0

function readEntries(root: any): Entry[] {
  const out: Entry[] = []
  let order = 0
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c) || c.type !== 'GROUP') continue
      const kids = c.children.filter(isLive)
      const vectors = kids.filter((k: any) => k.type === 'VECTOR' && sizedVector(k))
      const texts = kids.filter((k: any) => k.type === 'TEXT' && (k.characters || '').trim().length > 0)
      const hasGroupChild = kids.some((k: any) => k.type === 'GROUP' || k.type === 'FRAME')
      if (hasGroupChild || vectors.length === 0) {
        visit(c)
        continue
      }
      const box = vectors.reduce((a: any, b: any) => (b.width * b.height > a.width * a.height ? b : a))
      const boxRect = absRect(box)
      const others = vectors.filter((v: any) => v !== box)
      const unpainted = others.filter((v: any) => !hasFill(v) && !hasStroke(v))
      const hi = pickHeader(boxRect, unpainted.map(absRect))
      const header = hi >= 0 ? unpainted[hi] : null
      const bold = texts.some((t: any) => weightOf(t) >= 600)
      out.push({
        group: c,
        kind: header || bold ? 'section' : 'leaf',
        box,
        header,
        vectors,
        texts,
        abs: boxRect,
        order: order++,
        parent: -1,
      })
    }
  }
  visit(root)
  return out
}

function paintFrame(frame: any, vec: any): void {
  frame.fills = hasFill(vec) ? cloneAll(vec.fills) : []
  frame.strokes = []
  if (hasStroke(vec)) applyStroke(frame, vec, Array.isArray(vec.dashPattern) ? vec.dashPattern : [])
  frame.cornerRadius = 0
}

function baseFrame(name: string, w: number, h: number): any {
  const f = figma.createFrame()
  f.name = name
  f.resize(w, h)
  f.fills = []
  f.strokes = []
  // Labels may be a hair wider than their box after the Arial -> Inter switch: never clip them.
  f.clipsContent = false
  return f
}

function setAutoLayout(f: any, mode: 'HORIZONTAL' | 'VERTICAL', primary: string): void {
  f.layoutMode = mode
  f.primaryAxisSizingMode = 'FIXED'
  f.counterAxisSizingMode = 'FIXED'
  f.primaryAxisAlignItems = primary
  f.counterAxisAlignItems = 'CENTER'
  f.itemSpacing = 0
  f.paddingLeft = 0
  f.paddingRight = 0
  f.paddingTop = 0
  f.paddingBottom = 0
}

const clean = (s: string): string => (s || '').trim().replace(/\s+/g, ' ')

function buildSection(e: Entry): void {
  const facts = e.texts.map(textFacts)
  const roles = sectionTextRoles(e.abs, facts)
  const nameText = roles.name >= 0 ? e.texts[roles.name] : null
  const valueText = roles.value >= 0 ? e.texts[roles.value] : null
  const name = nameText ? clean(nameText.characters) : ''
  const value = valueText ? clean(valueText.characters) : ''

  const frame = baseFrame(sectionTitle(name, value), e.abs.width, e.abs.height)
  paintFrame(frame, e.box)
  tag(frame, 'mermapix:kind', TREEMAP_SECTION_KIND)
  tag(frame, 'mermapix:label', name)
  tag(frame, 'mermapix:value', value)
  e.frame = frame

  if (e.texts.length === 0) return
  // Header strip: the (unpainted) header rect's bounds, else the section top with Mermaid's 25px band.
  const hdr: Rect = e.header ? absRect(e.header) : { x: e.abs.x, y: e.abs.y, width: e.abs.width, height: Math.min(25, e.abs.height) }
  const spec = headerSpec(hdr, nameText ? facts[roles.name] : null, valueText ? facts[roles.value] : null)

  const header = baseFrame('Header', hdr.width, hdr.height)
  setAutoLayout(header, 'HORIZONTAL', spec.primary)
  header.paddingLeft = spec.paddingLeft
  header.paddingRight = spec.paddingRight
  header.paddingTop = spec.paddingTop
  header.paddingBottom = spec.paddingBottom
  frame.appendChild(header)
  header.x = hdr.x - e.abs.x
  header.y = hdr.y - e.abs.y
  tag(header, 'mermapix:kind', 'Treemap Header')
  // Texts in DOM order (name first when both exist).
  const ordered = [nameText, valueText].filter(Boolean)
  for (const t of e.texts) if (!ordered.includes(t)) ordered.push(t)
  for (const t of ordered) {
    styleShapeText(t)
    try {
      t.textAlignHorizontal = t === valueText ? 'RIGHT' : 'LEFT'
    } catch {}
    header.appendChild(t)
  }
}

function buildLeaf(e: Entry): void {
  const texts = [...e.texts].sort((a, b) => a.y - b.y)
  const label = texts.length > 0 ? clean(texts[0].characters) : ''
  const value = texts.length > 1 ? clean(texts[texts.length - 1].characters) : ''
  const frame = baseFrame(leafTitle(label || 'Leaf', value), e.abs.width, e.abs.height)
  setAutoLayout(frame, 'VERTICAL', 'CENTER')
  paintFrame(frame, e.box)
  tag(frame, 'mermapix:kind', TREEMAP_LEAF_KIND)
  tag(frame, 'mermapix:label', label)
  tag(frame, 'mermapix:value', value)
  e.frame = frame

  // Original geometry first (the Inter switch re-measures every text).
  const centers = texts.map((t) => {
    const a = absRect(t)
    return a.y + a.height / 2 - e.abs.y
  })
  for (const t of texts) {
    styleShapeText(t)
    // Mermaid stacks label and value baseline to baseline, tighter than Inter's default line box (the boxes
    // would overlap): a line height equal to the font size makes the stack independent of font metrics.
    try {
      if (typeof t.fontSize === 'number') t.lineHeight = { unit: 'PIXELS', value: t.fontSize }
    } catch {}
    frame.appendChild(t)
  }
  const spec = stackSpec(
    { x: 0, y: 0, width: e.abs.width, height: e.abs.height },
    centers,
    texts.map((t) => t.height),
  )
  frame.itemSpacing = spec.itemSpacing
  frame.paddingTop = spec.paddingTop
  frame.paddingBottom = spec.paddingBottom
}

export function convertTreemap(root: any): TreemapResult {
  const entries = readEntries(root)
  const res: TreemapResult = { sections: 0, leaves: 0 }
  if (entries.length === 0) return res

  const parents = parentIndices(entries.map((e) => e.abs))
  entries.forEach((e, i) => {
    e.parent = parents[i]
    // A section can only contain things, a leaf never does: re-parent anything that landed in a leaf.
    while (e.parent >= 0 && entries[e.parent].kind === 'leaf') e.parent = parents[e.parent]
  })

  // Remember where the top-level frames go before anything is removed.
  const slots = new Map<Entry, { parent: any; index: number }>()
  for (const e of entries) {
    if (e.parent < 0) slots.set(e, { parent: e.group.parent, index: e.group.parent.children.indexOf(e.group) })
  }

  for (const e of entries) {
    // Capture the texts' layout before the frames take them over.
    if (e.kind === 'section') {
      buildSection(e)
      res.sections++
    } else {
      buildLeaf(e)
      res.leaves++
    }
  }

  // Place: children into their parent frame (DOM order), top-level frames where the group was.
  const byOrder = [...entries].sort((a, b) => a.order - b.order)
  for (const e of byOrder) {
    if (e.parent >= 0) {
      const p = entries[e.parent]
      p.frame.appendChild(e.frame)
      e.frame.x = e.abs.x - p.abs.x
      e.frame.y = e.abs.y - p.abs.y
    }
  }
  for (const e of byOrder) {
    const slot = slots.get(e)
    if (!slot) continue
    const at = Math.min(slot.index, slot.parent.children.length)
    slot.parent.insertChild(at, e.frame)
    const o = childOrigin(slot.parent)
    e.frame.x = e.abs.x - o.x
    e.frame.y = e.abs.y - o.y
  }

  // Drop every leftover vector (header strips, section/leaf rects, label clips) and the emptied groups.
  for (const e of entries) {
    for (const v of e.vectors) if (isLive(v)) {
      try {
        v.remove()
      } catch {}
    }
    let g = e.group
    while (isLive(g) && g.type === 'GROUP' && g.children.length === 0) {
      const up = g.parent
      try {
        g.remove()
      } catch {}
      g = up
    }
  }
  return res
}
