// usecase-beta conversion (Mermaid 12.3.0, Phase 14.3). See usecaseGeometry.ts for the SVG structure.
//
//   actor        `Actor: <name>`        plain frame (no Auto Layout, no clip) at the actor's hit-area bounds holding the
//                                       figure vector(s) at their exact positions + the name (Inter, centre kept)
//   use case     `Use Case: <label>`    `convertShapeGroup`: ellipse = wrapper frame holding the ellipse vector + centred
//                                       label (a frame cannot be elliptical), rect form = Auto Layout frame with the paint
//   boundary     `System Boundary: <t>` cluster frame (`convertClusterGroup`), package type `Package: <t>` = container
//                                       frame holding a `Tab` frame and a `Body` frame
//   note         `Note: <text>`         like class notes
// Everything is tagged like flowchart nodes / subgraphs (`mermapix:node` / `mermapix:cluster`), so the shared steps
// nest the use cases into their boundary (geometry) and group the relations into `Connectors` (connectors.ts).
// A group the rules do not recognise is left alone for the generic fallback.

import { classifyShape } from './shapeGeometry.ts'
import {
  collectParts,
  convertShapeGroup,
  convertVectorWithLabel,
  hasFill,
  hasStroke,
  labelOf,
  paintFrameFromVectors,
  pathDataOf,
  rebase,
  styleShapeText,
  tag,
} from './shapes.ts'
import {
  absRect,
  CLUSTER_ID_KEY,
  CLUSTER_LABEL_KEY,
  convertClusterGroup,
  nestIntoClusters,
} from './subgraphs.ts'
import { actorNameTexts, actorPartNames, classifyUsecaseGroup, usecaseNodeId, type UsecasePart, type UsecaseRole } from './usecaseGeometry.ts'

const isLive = (n: any): boolean => Boolean(n) && !n.removed
export const ROLE_KEY = 'mermapix:role'

export interface UsecaseResult {
  actors: number
  usecases: number
  notes: number
  boundaries: number
}

function describe(v: any): UsecasePart {
  const cls = classifyShape(pathDataOf(v), v.width, v.height)
  return {
    rect: absRect(v),
    painted: hasFill(v) || hasStroke(v),
    rectLike: cls.rectLike && cls.kind !== 'Circle' && cls.kind !== 'Stadium',
    ellipse: cls.kind === 'Ellipse' || cls.kind === 'Circle',
  }
}

// ---------------------------------------------------------------- actor

function convertActor(group: any, id: string, parts: ReturnType<typeof collectParts>): any | null {
  const hit = parts.vectors.filter((v) => !(hasFill(v) || hasStroke(v)))
  const figure = parts.vectors.filter((v) => hasFill(v) || hasStroke(v))
  if (figure.length === 0 || parts.texts.length === 0) return null
  const parentNode = group.parent
  const index = parentNode.children.indexOf(group)
  const label = labelOf(actorNameTexts(figure.map(absRect), parts.texts.map(absRect)).map((i) => parts.texts[i]))

  // The unpainted hit area is the actor's box (figure + name); without one, the union of what is there.
  const rects = [...hit, ...figure, ...parts.texts].map((n) => ({ ...rebase(n.x, n.y, n.parent, parentNode), width: n.width, height: n.height }))
  const box = hit.length > 0 ? rects.slice(0, hit.length).reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)) : null
  const x0 = box ? box.x : Math.min(...rects.map((r) => r.x))
  const y0 = box ? box.y : Math.min(...rects.map((r) => r.y))
  const x1 = box ? box.x + box.width : Math.max(...rects.map((r) => r.x + r.width))
  const y1 = box ? box.y + box.height : Math.max(...rects.map((r) => r.y + r.height))

  const frame = figma.createFrame()
  frame.name = `Actor: ${label || id}`
  frame.layoutMode = 'NONE'
  frame.resize(Math.max(1, x1 - x0), Math.max(1, y1 - y0))
  parentNode.insertChild(index, frame)
  frame.x = x0
  frame.y = y0
  frame.fills = []
  frame.strokes = []
  frame.clipsContent = false

  // Figure vectors keep their exact position (relative to the new frame).
  const names = actorPartNames(figure.map((v) => ({ ...rebase(v.x, v.y, v.parent, parentNode), width: v.width, height: v.height })))
  figure.forEach((v, i) => {
    const rel = rebase(v.x, v.y, v.parent, parentNode)
    frame.appendChild(v)
    v.x = rel.x - x0
    v.y = rel.y - y0
    v.name = names[i]
  })
  // Name(s): Inter, centre preserved (the same rule as the cluster titles and the sequence actors).
  for (const t of parts.texts) {
    const rel = rebase(t.x, t.y, t.parent, parentNode)
    const cx = rel.x + t.width / 2 - x0
    const cy = rel.y + t.height / 2 - y0
    styleShapeText(t)
    frame.appendChild(t)
    t.x = cx - t.width / 2
    t.y = cy - t.height / 2
    try {
      t.constraints = { horizontal: 'CENTER', vertical: 'MAX' }
    } catch {}
  }
  for (const v of hit) {
    try {
      v.remove()
    } catch {}
  }
  try {
    group.remove()
  } catch {}

  tag(frame, 'mermapix:node', id)
  tag(frame, CLUSTER_LABEL_KEY, label || id)
  tag(frame, 'mermapix:kind', 'Actor')
  tag(frame, ROLE_KEY, 'actor')
  return frame
}

// ---------------------------------------------------------------- package boundary

function convertPackage(group: any, id: string, parts: ReturnType<typeof collectParts>): any | null {
  const [a, b] = parts.vectors
  const tabVec = a.width * a.height <= b.width * b.height ? a : b
  const bodyVec = tabVec === a ? b : a
  const parentNode = group.parent
  const index = parentNode.children.indexOf(group)
  const title = labelOf(parts.texts)
  const tabClass = classifyShape(pathDataOf(tabVec), tabVec.width, tabVec.height)
  const bodyClass = classifyShape(pathDataOf(bodyVec), bodyVec.width, bodyVec.height)

  const tabRect = rebase(tabVec.x, tabVec.y, tabVec.parent, parentNode)
  const bodyRect = rebase(bodyVec.x, bodyVec.y, bodyVec.parent, parentNode)
  const x0 = Math.min(tabRect.x, bodyRect.x)
  const y0 = Math.min(tabRect.y, bodyRect.y)
  const x1 = Math.max(tabRect.x + tabVec.width, bodyRect.x + bodyVec.width)
  const y1 = Math.max(tabRect.y + tabVec.height, bodyRect.y + bodyVec.height)

  // Tab: paint frame + the title when it sits in the tab (Mermaid draws the tab first, the body over it).
  const tabText = parts.texts.find((t) => {
    const r = rebase(t.x, t.y, t.parent, parentNode)
    const cx = r.x + t.width / 2
    const cy = r.y + t.height / 2
    return cx >= tabRect.x && cx <= tabRect.x + tabVec.width && cy >= tabRect.y && cy <= tabRect.y + tabVec.height
  })
  const tabFrame = tabText
    ? convertVectorWithLabel(tabVec, tabText, 'Tab', tabClass)
    : paintFrameFromVectors([tabVec], tabClass, 'Tab', parentNode)
  const bodyFrame = paintFrameFromVectors([bodyVec], bodyClass, 'Body', parentNode)

  const container = figma.createFrame()
  container.name = `Package: ${title || id}`
  container.layoutMode = 'NONE'
  container.resize(x1 - x0, y1 - y0)
  parentNode.insertChild(Math.min(index, parentNode.children.length), container)
  container.x = x0
  container.y = y0
  container.fills = []
  container.strokes = []
  container.clipsContent = false
  for (const f of [tabFrame, bodyFrame]) {
    const rel = rebase(f.x, f.y, f.parent, parentNode)
    container.appendChild(f)
    f.x = rel.x - x0
    f.y = rel.y - y0
  }
  for (const t of parts.texts) {
    if (t === tabText) continue
    const rel = rebase(t.x, t.y, t.parent, parentNode)
    styleShapeText(t)
    container.appendChild(t)
    t.x = rel.x - x0
    t.y = rel.y - y0
  }
  try {
    group.remove()
  } catch {}

  tag(container, CLUSTER_ID_KEY, id)
  tag(container, CLUSTER_LABEL_KEY, title || id)
  tag(container, 'mermapix:kind', 'Package')
  tag(container, ROLE_KEY, 'package')
  return container
}

// ---------------------------------------------------------------- step

/** Converts the actors, use cases, notes and boundaries of a use case payload; nests them into their boundary. */
export function convertUsecase(root: any): UsecaseResult {
  const result: UsecaseResult = { actors: 0, usecases: 0, notes: 0, boundaries: 0 }
  const groups: Array<{ group: any; id: string }> = []
  const find = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c) || c.type !== 'GROUP') continue
      const id = usecaseNodeId(c.name)
      if (id !== null) groups.push({ group: c, id })
      else find(c)
    }
  }
  find(root)

  const todo = groups
    .map(({ group, id }) => {
      const parts = collectParts(group)
      const role: UsecaseRole | null =
        parts.others.length > 0
          ? null
          : classifyUsecaseGroup({ id, vectors: parts.vectors.map(describe), texts: parts.texts.map(absRect) })
      return { group, id, parts, role }
    })
    .filter((g) => g.role !== null)

  // Boundaries first: their frames must exist (and sit below) before nodes are nested into them.
  const order: UsecaseRole[] = ['boundary', 'package', 'actor', 'note', 'usecase']
  for (const role of order) {
    for (const { group, id, parts, role: r } of todo) {
      if (r !== role || !isLive(group)) continue
      if (role === 'boundary') {
        const v = parts.vectors[0]
        const f = convertClusterGroup({ group, id, vector: v, texts: parts.texts }, { prefix: 'System Boundary', kind: 'System Boundary' })
        tag(f.frame, ROLE_KEY, 'boundary')
        result.boundaries++
      } else if (role === 'package') {
        if (convertPackage(group, id, parts)) result.boundaries++
      } else if (role === 'actor') {
        if (convertActor(group, id, parts)) result.actors++
      } else {
        const res = convertShapeGroup(group, { nodeId: id })
        if (!res) continue
        const label = res.label || id
        res.frame.name = role === 'note' ? `Note: ${label}` : `Use Case: ${label}`
        tag(res.frame, CLUSTER_LABEL_KEY, label)
        tag(res.frame, ROLE_KEY, role)
        // A business slash or other decoration drawn inside the main shape.
        for (const k of res.frame.children) {
          if (k.type === 'VECTOR' && k.width * k.height < 0.5 * res.frame.width * res.frame.height) k.name = 'Detail'
        }
        if (role === 'note') {
          tag(res.frame, 'mermapix:kind', 'Note')
          result.notes++
        } else result.usecases++
      }
    }
  }
  if (result.actors + result.usecases + result.notes + result.boundaries === 0) return result
  nestIntoClusters(root)
  return result
}
