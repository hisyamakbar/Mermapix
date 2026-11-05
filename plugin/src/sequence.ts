// Sequence diagrams -> native Figma structure (Phase 8.4).
//
// Figma imports a Mermaid sequence diagram as loose pieces: participant boxes (rect VECTOR + TEXT),
// lifelines, 4 dashed border lines + a label tab + texts per alt/loop/opt/par/critical/break block,
// note rects, activation rects, stick-figure actors, and per message a label TEXT, a line VECTOR,
// marker groups, a badge group and a loose number TEXT.
//
// This module recognizes those pieces (by id names, paint and geometry, never by order alone) and
// rebuilds them as:
//   - Participant: <name> (top|bottom)   Auto Layout frame, FIXED size, merged paint + radius
//   - Actor: <name> (top|bottom)         plain frame holding the stick figure at its exact positions
//   - Lifeline: <name>                   the original line VECTOR, named
//   - Activation: <name>                 frame with merged paint
//   - Note: <text>                       Auto Layout frame, FIXED size (multi-line text kept as lines)
//   - Block: <word> [<condition>]        plain frame at the exact bounds, NO fill, the 4 border lines
//                                        merged into its stroke (color, weight, dash); divider lines,
//                                        label tab frame and condition texts live inside it
//   - Highlight: #rrggbb                 filled frame for `rect rgb(...)`
//   - Message <n>: <label> (A → B)       group: label + line + markers + `Badge <n>` frame
//   - Badge <n>                          Auto Layout frame (circle = cornerRadius w/2) with the number
//
// Z-ORDER (root, bottom -> top), reproducing Mermaid's own paint order:
//   Highlights < Participants (bottom) < Lifelines < Participants (top) < Actors < Activations
//   < Notes < Blocks < Messages < anything unrecognized.
// Mermaid draws bottom participant boxes first, then each lifeline followed by its top box, then
// activations, notes and blocks, and ALL messages last (see tests/unit/plugin-sequence.test.mjs, which
// compares the paint order of every overlapping pair of pieces before/after). Notes and messages that
// lie fully inside a block move into that block's frame (nested blocks nest by containment); inside a
// block the order is: own divider lines, label tab, condition texts, notes, nested blocks, messages.

import { classifyShape, isRealDash } from './shapeGeometry.ts'
import { smallestContainer, type Rect } from './connectorGeometry.ts'
import { absRect, moveKeepingAbs } from './subgraphs.ts'
import {
  applyStroke,
  childOrigin,
  cloneAll,
  collectParts,
  convertShapeGroup,
  convertVectorWithLabel,
  createCenteredFrame,
  hasFill,
  hasStroke,
  labelOf,
  pathDataOf,
  styleShapeText,
  tag,
} from './shapes.ts'
import {
  hexOfPaint,
  inlinedMarkerKind,
  isLifelineName,
  messageName,
  nearestIndex,
  pathEnds,
  pickBlockBorder,
  stackedLinePitch,
  type Seg,
} from './sequenceGeometry.ts'

const isLive = (n: any): boolean => Boolean(n) && !n.removed
const isMarkerGroup = (n: any): boolean => n.type === 'GROUP' && String(n.name || '').includes('inlined-marker')
const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

export const SEQ_KIND_KEY = 'mermapix:kind'

export interface SequenceResult {
  converted: boolean
  participants: number
  actors: number
  notes: number
  blocks: number
  activations: number
  highlights: number
  messages: number
}

// ---------------------------------------------------------------- classification

type EntryKind = 'figure' | 'block' | 'box' | 'rectish' | 'leaf'

interface Entry {
  kind: EntryKind
  node: any
  rect: Rect
}

const isStrokeLine = (v: any): boolean =>
  hasStroke(v) && !hasFill(v) && (v.width < 0.01 || v.height < 0.01) && (v.width > 0.01 || v.height > 0.01)

function hasMarkerDescendant(g: any): boolean {
  for (const c of g.children || []) {
    if (!isLive(c)) continue
    if (isMarkerGroup(c)) return true
    if (c.type === 'GROUP' && hasMarkerDescendant(c)) return true
  }
  return false
}

const isFilledRect = (v: any): boolean =>
  v.type === 'VECTOR' && hasFill(v) && v.width >= 1 && v.height >= 1 && classifyShape(pathDataOf(v), v.width, v.height).rectLike

function lineSegs(lines: any[]): Seg[] {
  return lines.map((v, id) => {
    const a = absRect(v)
    return v.height < 0.01
      ? { id, x1: a.x, y1: a.y, x2: a.x + a.width, y2: a.y }
      : { id, x1: a.x, y1: a.y, x2: a.x, y2: a.y + a.height }
  })
}

const hasTab = (vectors: any[]): boolean =>
  vectors.some((v) => hasFill(v) && hasStroke(v) && !classifyShape(pathDataOf(v), v.width, v.height).rectLike)

function classifyGroup(g: any): EntryKind | null {
  const parts = collectParts(g)
  if (parts.others.length > 0 || parts.vectors.length === 0 || hasMarkerDescendant(g)) return null
  if (parts.vectors.some((v) => /^actor-man-/.test(v.name || ''))) return 'figure'
  const lines = parts.vectors.filter(isStrokeLine)
  if (lines.length >= 4 && parts.texts.length >= 1 && hasTab(parts.vectors) && pickBlockBorder(lineSegs(lines))) return 'block'
  if (parts.vectors.length === 1 && isFilledRect(parts.vectors[0])) return parts.texts.length >= 1 ? 'box' : 'rectish'
  return null
}

/** All pieces below `parent` in z-order; recognized groups are taken whole, other groups are entered. */
function walk(parent: any, out: Entry[]): void {
  for (const c of [...(parent.children || [])]) {
    if (!isLive(c)) continue
    if (c.type === 'GROUP') {
      if (isMarkerGroup(c)) {
        out.push({ kind: 'leaf', node: c, rect: absRect(c) })
        continue
      }
      const kind = classifyGroup(c)
      if (kind) out.push({ kind, node: c, rect: absRect(c) })
      else walk(c, out)
    } else if (c.type === 'VECTOR') {
      out.push({ kind: isFilledRect(c) && !isLifelineName(c.name) ? 'rectish' : 'leaf', node: c, rect: absRect(c) })
    } else if (c.type === 'TEXT') {
      out.push({ kind: 'leaf', node: c, rect: absRect(c) })
    }
  }
}

// ---------------------------------------------------------------- small node helpers

/** Switches a text to Inter keeping its visual center (loose labels were anchored in the middle). */
function interKeepCenter(t: any): void {
  const a = absRect(t)
  const cx = a.x + a.width / 2
  const cy = a.y + a.height / 2
  styleShapeText(t)
  const o = childOrigin(t.parent)
  t.x = cx - t.width / 2 - o.x
  t.y = cy - t.height / 2 - o.y
}

function removeIfEmptyGroup(g: any): void {
  if (isLive(g) && g.type === 'GROUP' && Array.isArray(g.children) && g.children.length === 0) {
    try {
      g.remove()
    } catch {}
  }
}

/** Replaces a rect-like VECTOR by an (empty) Auto Layout frame carrying its fill, stroke and radius. */
function rectToFrame(v: any, name: string, kind: string): any {
  const parent = v.parent
  const index = parent.children.indexOf(v)
  const cls = classifyShape(pathDataOf(v), v.width, v.height)
  const f = createCenteredFrame({ name, x: 0, y: 0, width: v.width, height: v.height })
  parent.insertChild(index, f)
  f.x = v.x
  f.y = v.y
  f.fills = hasFill(v) ? cloneAll(v.fills) : []
  if (hasStroke(v)) applyStroke(f, v, Array.isArray(v.dashPattern) ? v.dashPattern : [])
  f.cornerRadius = cls.rectLike ? cls.cornerRadius : 0
  tag(f, SEQ_KIND_KEY, kind)
  v.remove()
  removeIfEmptyGroup(parent)
  return f
}

function makeGroup(members: any[], parent: any, name: string): any | null {
  const live = members.filter(isLive)
  if (live.length === 0) return null
  try {
    const g = figma.group(live, parent)
    g.name = name
    return g
  } catch {
    return null
  }
}

function unionRect(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.width))
  const y1 = Math.max(...rects.map((r) => r.y + r.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Joins the lines of a multi-line label (separate TEXT nodes, one per line) into ONE text with line breaks. */
function mergeStackedTexts(texts: any[]): void {
  if (texts.length < 2) return
  const sorted = [...texts].sort((a, b) => absRect(a).y - absRect(b).y)
  const pitch = stackedLinePitch(sorted.map(absRect))
  if (pitch === null) return
  const first = sorted[0]
  const u = unionRect(sorted.map(absRect))
  try {
    first.characters = sorted.map((t) => (t.characters || '').trim()).join('\n')
  } catch {
    return
  }
  try {
    first.lineHeight = { unit: 'PIXELS', value: pitch }
  } catch {}
  try {
    first.textAutoResize = 'WIDTH_AND_HEIGHT'
  } catch {}
  for (const t of sorted.slice(1)) {
    try {
      t.remove()
    } catch {}
  }
  // Keep the vertical center of the whole label where the separate lines had it.
  const a = absRect(first)
  first.y += u.y + u.height / 2 - (a.y + a.height / 2)
}

// ---------------------------------------------------------------- converters

interface Placed {
  node: any
  rect: Rect
  order: number
  /** Rect used to decide block membership (a message's badge may sit on a block border; the rest cannot). */
  core?: Rect
}

interface BlockPlaced extends Placed {
  word: string
}

interface Lifeline {
  vec: any
  cx: number
  y0: number
  y1: number
  name: string
}

function convertBox(entry: Entry, kind: string, side?: string): any | null {
  const res = convertShapeGroup(entry.node)
  if (!res) return null
  const f = res.frame
  f.name = kind === 'Note' ? `Note: ${clip(res.label, 40)}` : `Participant: ${clip(res.label, 40)} (${side})`
  tag(f, SEQ_KIND_KEY, kind)
  if (side) {
    tag(f, 'mermapix:participant', res.label)
    tag(f, 'mermapix:side', side)
  }
  return f
}

function convertFigure(entry: Entry, label: string, side: string): any | null {
  const g = entry.node
  const parts = collectParts(g)
  const members = [...parts.vectors, ...parts.texts]
  if (members.length === 0) return null
  const rect = unionRect(members.map(absRect))
  const f = figma.createFrame()
  f.name = `Actor: ${clip(label, 40)} (${side})`
  f.layoutMode = 'NONE'
  f.resize(rect.width, rect.height)
  f.fills = []
  f.strokes = []
  f.clipsContent = false
  const parent = g.parent
  parent.insertChild(parent.children.indexOf(g), f)
  const o = childOrigin(parent)
  f.x = rect.x - o.x
  f.y = rect.y - o.y

  const torso = parts.vectors.find((v) => /torso/.test(v.name || ''))
  const torsoX = torso ? absRect(torso).x : rect.x + rect.width / 2
  const legs = parts.vectors.filter((v) => !/^actor-man-/.test(v.name || '') && isStrokeLine(v) === false && !hasFill(v))
  for (const v of parts.vectors) {
    const a = absRect(v)
    let name = 'Figure Part'
    if (/torso/.test(v.name || '')) name = 'Torso'
    else if (/arms/.test(v.name || '')) name = 'Arms'
    else if (hasFill(v) && Math.abs(v.width - v.height) < 1) name = 'Head'
    else if (legs.includes(v)) name = a.x + a.width / 2 < torsoX ? 'Left Leg' : 'Right Leg'
    v.name = name
    moveKeepingAbs(v, f, a)
  }
  for (const t of parts.texts) {
    interKeepCenter(t)
    moveKeepingAbs(t, f, absRect(t))
  }
  removeIfEmptyGroup(g)
  tag(f, SEQ_KIND_KEY, 'Actor')
  tag(f, 'mermapix:participant', label)
  tag(f, 'mermapix:side', side)
  return f
}

function convertBlock(entry: Entry, root: any): BlockPlaced | null {
  const g = entry.node
  const parts = collectParts(g)
  const lines = parts.vectors.filter(isStrokeLine)
  const border = pickBlockBorder(lineSegs(lines))
  const tab = parts.vectors.find((v) => hasFill(v) && hasStroke(v) && !classifyShape(pathDataOf(v), v.width, v.height).rectLike)
  if (!border || !tab) return null
  const topLine = lines[border.top]
  const r = border.rect

  const frame = figma.createFrame()
  frame.layoutMode = 'NONE'
  frame.resize(r.width, r.height)
  frame.fills = []
  frame.clipsContent = false
  frame.cornerRadius = 0
  // Border merged into the frame: the four lines share color, weight and dash, so the frame stroke carries them.
  frame.strokes = cloneAll(topLine.strokes)
  frame.strokeWeight = topLine.strokeWeight
  frame.strokeAlign = 'CENTER'
  if (isRealDash(topLine.dashPattern)) frame.dashPattern = topLine.dashPattern
  moveKeepingAbs(frame, root, { x: r.x, y: r.y })

  // Own children, bottom -> top: dividers, label tab (+ its word), condition texts.
  for (const id of [...border.dividers, ...border.extras]) {
    const v = lines[id]
    v.name = border.dividers.includes(id) ? 'Divider' : 'Line'
    moveKeepingAbs(v, frame, absRect(v))
  }

  const tabRect = absRect(tab)
  const inTab = (t: any): boolean => {
    const a = absRect(t)
    const cx = a.x + a.width / 2
    const cy = a.y + a.height / 2
    return cx >= tabRect.x - 2 && cx <= tabRect.x + tabRect.width + 2 && cy >= tabRect.y - 2 && cy <= tabRect.y + tabRect.height + 2
  }
  const labelText = parts.texts.find(inTab) || null
  const word = labelText ? (labelText.characters || '').trim() : ''
  const conds = parts.texts.filter((t) => t !== labelText)

  if (labelText) {
    moveKeepingAbs(tab, root, tabRect)
    moveKeepingAbs(labelText, root, absRect(labelText))
    const tg = makeGroup([tab, labelText], root, 'Block Label')
    const res = tg ? convertShapeGroup(tg) : null
    if (res) {
      res.frame.name = `Block Label: ${clip(word, 24)}`
      tag(res.frame, SEQ_KIND_KEY, 'Block Label')
      for (const c of res.frame.children) if (c.type === 'VECTOR') c.name = 'Label Tab'
      moveKeepingAbs(res.frame, frame, absRect(res.frame))
    } else {
      tab.name = 'Label Tab'
      moveKeepingAbs(tab, frame, tabRect)
      interKeepCenter(labelText)
      moveKeepingAbs(labelText, frame, absRect(labelText))
    }
  } else {
    tab.name = 'Label Tab'
    moveKeepingAbs(tab, frame, tabRect)
  }

  // Condition texts ("[payment succeeded]"); wrapped ones are several texts one below the other.
  const sortedConds = [...conds].sort((a, b) => absRect(a).y - absRect(b).y)
  let firstCond = ''
  if (sortedConds.length > 0) {
    const f0 = absRect(sortedConds[0])
    const same = sortedConds.filter((t, i) => {
      if (i === 0) return true
      const a = absRect(t)
      return Math.abs(a.x + a.width / 2 - (f0.x + f0.width / 2)) <= 3 && a.y - f0.y < 60
    })
    firstCond = same.map((t) => (t.characters || '').trim()).join(' ')
  }
  for (const t of sortedConds) {
    interKeepCenter(t)
    moveKeepingAbs(t, frame, absRect(t))
  }

  for (const id of [border.top, border.right, border.bottom, border.left]) {
    try {
      lines[id].remove()
    } catch {}
  }
  removeIfEmptyGroup(g)

  frame.name = `Block: ${word || 'block'}${firstCond ? ' ' + clip(firstCond, 40) : ''}`
  tag(frame, SEQ_KIND_KEY, 'Block')
  tag(frame, 'mermapix:block', word)
  return { node: frame, rect: r, order: 0, word }
}

interface RawMessage {
  labels: any[]
  line: any
  markers: any[]
  badge: any | null
  number: any | null
}

const labelFits = (label: any, line: any): boolean => {
  const l = absRect(label)
  const r = absRect(line)
  const gap = r.y - (l.y + l.height)
  return gap > -4 && gap < 40 && l.x < r.x + r.width + 12 && l.x + l.width > r.x - 12
}

/** Groups the loose leaf pieces (label TEXT, line VECTOR, marker groups, badge group, number TEXT) per message. */
function parseMessages(leaves: any[]): RawMessage[] {
  const out: RawMessage[] = []
  let cur: RawMessage | null = null
  let pending: any[] = []
  for (const n of leaves) {
    if (n.type === 'TEXT') {
      const t = (n.characters || '').trim()
      if (cur && cur.badge && !cur.number && /^\d{1,4}$/.test(t)) {
        cur.number = n
        continue
      }
      pending.push(n)
    } else if (n.type === 'VECTOR') {
      if (!hasStroke(n)) continue
      if (cur) out.push(cur)
      cur = { labels: pending.filter((t) => labelFits(t, n)), line: n, markers: [], badge: null, number: null }
      pending = []
    } else if (isMarkerGroup(n) && cur) {
      const info = inlinedMarkerKind(n.name)
      if (info && info.kind === 'sequence-number') cur.badge = n
      else cur.markers.push(n)
    }
  }
  if (cur) out.push(cur)
  // A bare stroke with no arrow marker, badge or label is not a message (icons of non-rect participants, ...).
  return out.filter((m) => m.markers.length > 0 || m.badge || m.labels.length > 0)
}

// ---------------------------------------------------------------- main

export function convertSequence(root: any): SequenceResult {
  const result: SequenceResult = { converted: false, participants: 0, actors: 0, notes: 0, blocks: 0, activations: 0, highlights: 0, messages: 0 }
  if (!isLive(root) || root.type !== 'FRAME' || !Array.isArray(root.children)) return result

  const entries: Entry[] = []
  walk(root, entries)

  // 1. Lifelines identify a sequence diagram and anchor everything else.
  const lifelines: Lifeline[] = entries
    .filter((e) => e.kind === 'leaf' && e.node.type === 'VECTOR' && isLifelineName(e.node.name) && e.node.width < 0.01 && e.node.height > 1)
    .map((e) => ({ vec: e.node, cx: e.rect.x, y0: e.rect.y, y1: e.rect.y + e.rect.height, name: '' }))
    .sort((a, b) => a.cx - b.cx)
  if (lifelines.length === 0) return result
  const lifelineAt = (cx: number, tol: number): number => nearestIndex(cx, lifelines.map((l) => l.cx), tol)

  let order = 0
  const highlights: Placed[] = []
  const bottomBoxes: Placed[] = []
  const topBoxes: Placed[] = []
  const figures: Placed[] = []
  const activations: Placed[] = []
  const notes: Placed[] = []
  const blocks: BlockPlaced[] = []
  const consumed = new Set<any>()

  // 2. Boxes: participant (touches a lifeline end) or note.
  const participantNames: Array<{ cx: number; name: string }> = []
  for (const e of entries) {
    if (e.kind === 'box') {
      const parts = collectParts(e.node)
      const v = parts.vectors[0]
      const vr = absRect(v)
      const li = lifelineAt(vr.x + vr.width / 2, 1.5)
      let side: 'top' | 'bottom' | null = null
      if (li >= 0) {
        if (Math.abs(vr.y + vr.height - lifelines[li].y0) <= 2) side = 'top'
        else if (Math.abs(vr.y - lifelines[li].y1) <= 2) side = 'bottom'
      }
      const spansLifeline = lifelines.some((l) => l.cx >= vr.x && l.cx <= vr.x + vr.width && l.y0 >= vr.y - 2 && l.y1 <= vr.y + vr.height + 2)
      if (spansLifeline) {
        // `box Name ... end`: a filled rect behind the participants (Mermaid paints it first).
        const res = convertShapeGroup(e.node)
        if (!res) continue
        res.frame.name = `Participant Group: ${clip(res.label, 40)}`
        tag(res.frame, SEQ_KIND_KEY, 'Participant Group')
        highlights.push({ node: res.frame, rect: absRect(res.frame), order: order++ })
        result.highlights++
      } else if (side) {
        const label = labelOf(parts.texts)
        const f = convertBox(e, 'Participant', side)
        if (!f) continue
        const placed = { node: f, rect: absRect(f), order: order++ }
        ;(side === 'top' ? topBoxes : bottomBoxes).push(placed)
        if (side === 'top') participantNames.push({ cx: vr.x + vr.width / 2, name: label })
        result.participants++
      } else {
        mergeStackedTexts(parts.texts)
        const f = convertBox(e, 'Note')
        if (!f) continue
        notes.push({ node: f, rect: absRect(f), order: order++ })
        result.notes++
      }
    } else if (e.kind === 'figure') {
      const parts = collectParts(e.node)
      const torso = parts.vectors.find((v) => /torso/.test(v.name || ''))
      const cx = torso ? absRect(torso).x : e.rect.x + e.rect.width / 2
      const li = lifelineAt(cx, 6)
      const mid = li >= 0 ? (lifelines[li].y0 + lifelines[li].y1) / 2 : -Infinity
      const side = e.rect.y + e.rect.height / 2 < mid || li < 0 ? 'top' : 'bottom'
      const label = labelOf(parts.texts)
      const f = convertFigure(e, label, side)
      if (!f) continue
      figures.push({ node: f, rect: absRect(f), order: order++ })
      if (side === 'top') participantNames.push({ cx, name: label })
      result.actors++
    }
  }

  const nameAt = (x: number, tol = 40): string => {
    const i = nearestIndex(x, participantNames.map((p) => p.cx), tol)
    return i >= 0 ? participantNames[i].name : ''
  }
  // Participants drawn as icons (database, queue, ...) have no rect: use the label text next to the lifeline end.
  const looseTexts = entries.filter((e) => e.kind === 'leaf' && e.node.type === 'TEXT' && isLive(e.node)).map((e) => ({ node: e.node, r: absRect(e.node) }))
  const labelNear = (l: Lifeline): string => {
    let best: { d: number; s: string } | null = null
    for (const t of looseTexts) {
      const cx = t.r.x + t.r.width / 2
      const cy = t.r.y + t.r.height / 2
      const d = Math.min(Math.abs(cy - l.y0), Math.abs(cy - l.y1))
      if (Math.abs(cx - l.cx) <= 8 && d <= 80 && (!best || d < best.d)) best = { d, s: (t.node.characters || '').trim() }
    }
    return best ? best.s : ''
  }
  lifelines.forEach((l, i) => {
    l.name = nameAt(l.cx, 20) || labelNear(l)
    l.vec.name = l.name ? `Lifeline: ${clip(l.name, 40)}` : `Lifeline ${i + 1}`
    tag(l.vec, SEQ_KIND_KEY, 'Lifeline')
    consumed.add(l.vec)
  })

  // 3. Activation bars and `rect` highlights.
  for (const e of entries) {
    if (e.kind !== 'rectish') continue
    const v = e.node.type === 'VECTOR' ? e.node : collectParts(e.node).vectors[0]
    const a = absRect(v)
    const li = lifelines.findIndex((l) => l.cx >= a.x - 1 && l.cx <= a.x + a.width + 1)
    if (li >= 0 && a.width <= 24 && hasStroke(v)) {
      const nm = lifelines[li].name
      const f = rectToFrame(v, `Activation: ${clip(nm || String(li + 1), 40)}`, 'Activation')
      activations.push({ node: f, rect: a, order: order++ })
      result.activations++
    } else if (!hasStroke(v)) {
      const f = rectToFrame(v, `Highlight: ${hexOfPaint(v.fills) || 'rect'}`, 'Highlight')
      highlights.push({ node: f, rect: a, order: order++ })
      result.highlights++
    }
  }

  // 4. Blocks.
  for (const e of entries) {
    if (e.kind !== 'block') continue
    const b = convertBlock(e, root)
    if (!b) continue
    b.order = order++
    blocks.push(b)
    result.blocks++
  }

  // 5. Messages from the remaining loose pieces.
  const leaves = entries
    .filter((e) => e.kind === 'leaf' && !consumed.has(e.node) && isLive(e.node))
    .map((e) => e.node)
  const raw = parseMessages(leaves)
  const messages: Placed[] = []
  const xs = lifelines.map((l) => l.cx)
  raw.forEach((m, i) => {
    const numberText = m.number ? (m.number.characters || '').trim() : ''
    const n = numberText || String(i + 1)
    const label = m.labels.map((t) => (t.characters || '').trim()).join(' ')
    const a = absRect(m.line)
    const ends = pathEnds(pathDataOf(m.line), a.x, a.y)
    const fi = ends ? nearestIndex(ends.start.x, xs, 120) : -1
    const ti = ends ? nearestIndex(ends.end.x, xs, 120) : -1
    const from = fi >= 0 ? lifelines[fi].name : ''
    const to = ti >= 0 ? lifelines[ti].name : ''

    for (const t of m.labels) interKeepCenter(t)
    m.line.name = 'Line'

    let badgeFrame: any = null
    if (m.badge) {
      const bparts = collectParts(m.badge)
      const circle = bparts.vectors[0]
      if (circle) {
        const cls = classifyShape(pathDataOf(circle), circle.width, circle.height)
        badgeFrame = m.number
          ? convertVectorWithLabel(circle, m.number, `Badge ${n}`, cls, 'Sequence Badge')
          : rectToFrame(circle, `Badge ${n}`, 'Sequence Badge')
        moveKeepingAbs(badgeFrame, root, absRect(badgeFrame))
        removeIfEmptyGroup(m.badge)
      }
    }

    const members = [...m.labels, m.line, ...m.markers, ...(badgeFrame ? [badgeFrame] : [])]
    for (const p of members) moveKeepingAbs(p, root, absRect(p))
    const rect = unionRect(members.map(absRect))
    const core = unionRect([...m.labels, m.line, ...m.markers].map(absRect))
    const g = makeGroup(members, root, messageName(n, label, from, to))
    if (!g) return
    tag(g, SEQ_KIND_KEY, 'Message')
    tag(g, 'mermapix:from', from)
    tag(g, 'mermapix:to', to)
    tag(g, 'mermapix:label', label)
    messages.push({ node: g, rect, core, order: order++ })
    result.messages++
  })

  // 6. Blocks own the notes / messages / nested blocks that lie fully inside them.
  const blockCands = blocks.map((b) => ({ ...b.rect, b }))
  const owner = (rect: Rect, self?: BlockPlaced): BlockPlaced | null => {
    const found = smallestContainer(
      rect,
      blockCands.filter((c) => c.b !== self),
    )
    return found ? found.b : null
  }
  const inBlock = new Map<BlockPlaced, { notes: Placed[]; blocks: BlockPlaced[]; messages: Placed[] }>()
  const slot = (b: BlockPlaced) => {
    if (!inBlock.has(b)) inBlock.set(b, { notes: [], blocks: [], messages: [] })
    return inBlock.get(b)!
  }
  const topNotes: Placed[] = []
  const topBlocks: BlockPlaced[] = []
  const topMessages: Placed[] = []
  for (const n of notes) {
    const o = owner(n.rect)
    if (o) slot(o).notes.push(n)
    else topNotes.push(n)
  }
  for (const b of blocks) {
    const o = owner(b.rect, b)
    if (o) slot(o).blocks.push(b)
    else topBlocks.push(b)
  }
  for (const m of messages) {
    const o = owner(m.core || m.rect)
    if (o) slot(o).messages.push(m)
    else topMessages.push(m)
  }
  for (const [b, content] of inBlock) {
    for (const p of [...content.notes, ...content.blocks, ...content.messages]) {
      moveKeepingAbs(p.node, b.node, { x: p.rect.x, y: p.rect.y })
    }
  }

  // 7. Root: strata in Mermaid's paint order, then anything unrecognized on top.
  const placed = new Set<any>()
  const strata: Array<{ name: string | null; items: Placed[] }> = [
    { name: null, items: highlights },
    { name: 'Participants (bottom)', items: bottomBoxes },
    { name: 'Lifelines', items: lifelines.map((l) => ({ node: l.vec, rect: { x: l.cx, y: l.y0, width: 0, height: l.y1 - l.y0 }, order: 0 })) },
    { name: 'Participants (top)', items: topBoxes },
    { name: 'Actors', items: figures },
    { name: 'Activations', items: activations },
    { name: 'Notes', items: topNotes },
    { name: 'Blocks', items: topBlocks },
    { name: 'Messages', items: topMessages },
  ]
  const leftovers = [...root.children].filter((c: any) => isLive(c))
  for (const s of strata) for (const it of s.items) placed.add(it.node)
  for (const s of strata) {
    const nodes = s.items.map((it) => it.node).filter(isLive)
    if (nodes.length === 0) continue
    for (const n of nodes) {
      if (n.parent !== root) moveKeepingAbs(n, root, absRect(n))
      else root.appendChild(n)
    }
    if (s.name) {
      const g = makeGroup(nodes, root, s.name)
      if (g) root.appendChild(g)
    }
  }
  for (const c of leftovers) {
    if (!isLive(c) || placed.has(c)) continue
    if (c.type === 'GROUP' && Array.isArray(c.children) && c.children.length === 0) {
      try {
        c.remove()
      } catch {}
      continue
    }
    root.appendChild(c)
  }

  result.converted = true
  return result
}
