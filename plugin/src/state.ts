// stateDiagram-v2 conversion (Phase 8.5). Mermaid draws one GROUP `…-state-<id>-<n>` per state.
//   state            rounded rect + label            -> `State: <label>` Auto Layout frame (FIXED)
//   composite state  outer rect (title band) + title + inner body rect -> `State: <title>` container
//                    frame (title inside) holding a `Body` frame; nested states move into the body
//   [*] start        filled circle                   -> `Start` circle frame
//   [*] end          circle + inner circle           -> `End` circle frame with an `Inner` circle frame
//   choice           diamond                         -> `Choice`
//   fork / join      thin filled bar                 -> `Fork` / `Join`
//   note             rect + text                     -> `Note: <text>`
// Containers use the cluster machinery of subgraphs.ts (membership by geometry), transitions are
// grouped by connectors.ts (endpoints resolved by geometry because the SVG names carry no ids).

import { classifyShape, groupStackedBounds } from './shapeGeometry.ts'
import {
  collectParts,
  convertShapeGroup,
  hasFill,
  hasStroke,
  paintFrameFromVectors,
  pathDataOf,
  tag,
} from './shapes.ts'
import {
  CLUSTER_ID_KEY,
  CLUSTER_LABEL_KEY,
  convertClusterGroup,
  nestIntoClusters,
  NODE_ID_KEY,
  type ClusterGroup,
} from './subgraphs.ts'
import { isCompositePair, pseudoStateKind, stateInfoFromName } from './stateGeometry.ts'

const isLive = (n: any): boolean => Boolean(n) && !n.removed

export interface StateResults {
  states: number
  composites: number
  pseudo: number
  notes: number
}

function findStateGroups(root: any): Array<{ group: any; id: string; role: string }> {
  const out: Array<{ group: any; id: string; role: string }> = []
  const visit = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c) || c.type !== 'GROUP') continue
      const info = stateInfoFromName(c.name)
      if (info) out.push({ group: c, id: info.id, role: info.role })
      else visit(c)
    }
  }
  visit(root)
  return out
}

const visible = (v: any): boolean => hasFill(v) || hasStroke(v)

function circleClass(w: number): any {
  return { kind: 'Circle', rectLike: true, cornerRadius: w / 2 }
}

/** `[*]` end state: ring circle + inner dot -> circle frame with a centered inner circle frame. */
function convertEnd(group: any, id: string): any | null {
  const parts = collectParts(group)
  const stacks = groupStackedBounds(parts.vectors)
  if (stacks.length !== 2 || parts.texts.length > 0 || parts.others.length > 0) return null
  const [outer, inner] = stacks[0][0].width >= stacks[1][0].width ? [stacks[0], stacks[1]] : [stacks[1], stacks[0]]
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.6
  if (!near(outer[0].width, outer[0].height) || !near(inner[0].width, inner[0].height)) return null
  const parentNode = group.parent
  const index = parentNode.children.indexOf(group)
  const frame = paintFrameFromVectors(outer, circleClass(outer[0].width), 'End', parentNode, index)
  const dot = paintFrameFromVectors(inner, circleClass(inner[0].width), 'Inner', frame, 0)
  tag(dot, 'mermapix:kind', 'End Inner')
  try {
    group.remove()
  } catch {}
  return frame
}

function convertStateGroup(group: any, id: string, role: string, results: StateResults): void {
  const parts = collectParts(group)
  if (role === 'parent') {
    // Mermaid's invisible anchor rect of a note (no fill, no stroke): nothing to show.
    if (parts.texts.length === 0 && parts.vectors.length > 0 && parts.vectors.every((v) => !visible(v))) {
      try {
        group.remove()
      } catch {}
    }
    return
  }
  if (parts.vectors.length === 0 || parts.others.length > 0) return

  if (role === 'end') {
    const f = convertEnd(group, id)
    if (f) {
      tag(f, 'mermapix:kind', 'End')
      tag(f, NODE_ID_KEY, id)
      tag(f, CLUSTER_LABEL_KEY, 'End')
      results.pseudo++
      return
    }
  }

  if (role === 'note') {
    const res = convertShapeGroup(group, { nodeId: id })
    if (!res) return
    res.frame.name = `Note: ${res.label || id}`
    tag(res.frame, CLUSTER_LABEL_KEY, res.label || id)
    tag(res.frame, 'mermapix:kind', 'Note')
    results.notes++
    return
  }

  // Composite state: outer rect (title band) + body rect, both full width, label = title.
  const stacks = groupStackedBounds(parts.vectors)
  if (role === 'node' && stacks.length === 2 && parts.texts.length >= 1) {
    const [a, b] = stacks[0][0].height >= stacks[1][0].height ? [stacks[0], stacks[1]] : [stacks[1], stacks[0]]
    if (isCompositePair(a[0], b[0]) && stacks.every((s) => s.length === 1)) {
      const outerFill = a[0]
      const innerBody = b[0]
      const parentNode = group.parent
      const index = parentNode.children.indexOf(group)
      const body = paintFrameFromVectors([innerBody], { kind: 'Rectangle', rectLike: true, cornerRadius: 0 }, 'Body', parentNode, index)
      body.layoutMode = 'NONE'
      body.clipsContent = false
      tag(body, CLUSTER_ID_KEY, `${id}#body`)
      tag(body, CLUSTER_LABEL_KEY, id)
      tag(body, 'mermapix:kind', 'State Body')
      const cg: ClusterGroup = { group, id, vector: outerFill, texts: parts.texts }
      convertClusterGroup(cg, { prefix: 'State', kind: 'Composite State' })
      results.composites++
      return
    }
  }

  // Concurrent region (`--` inside a composite): a label-less panel big enough to hold states. It is a
  // container like a composite body, so the states inside it move into it.
  if (role === 'node' && stacks.length === 1 && parts.texts.length === 0) {
    const v = stacks[0].find(hasFill) || stacks[0][0]
    const cls = classifyShape(pathDataOf(v), v.width, v.height)
    if (cls.rectLike && Math.min(v.width, v.height) >= 40 && pseudoStateKind(cls.kind, v.width, v.height, id) === null && stacks[0].every((x) => x.width > 0)) {
      const parentNode = group.parent
      const frame = paintFrameFromVectors(stacks[0], cls, 'Region', parentNode, parentNode.children.indexOf(group))
      frame.layoutMode = 'NONE'
      frame.clipsContent = false
      tag(frame, CLUSTER_ID_KEY, id)
      tag(frame, CLUSTER_LABEL_KEY, 'Region')
      tag(frame, 'mermapix:kind', 'State Region')
      try {
        group.remove()
      } catch {}
      results.composites++
      return
    }
  }

  const res = convertShapeGroup(group, { nodeId: id })
  if (!res) return
  const { frame } = res
  if (role === 'start') {
    frame.name = 'Start'
    tag(frame, CLUSTER_LABEL_KEY, 'Start')
    tag(frame, 'mermapix:kind', 'Start')
    results.pseudo++
    return
  }
  if (parts.texts.length === 0) {
    const pseudo = pseudoStateKind(res.kind, frame.width, frame.height, id)
    const name = pseudo || 'State'
    frame.name = name
    tag(frame, CLUSTER_LABEL_KEY, pseudo ? (pseudo === 'Choice' ? 'Choice' : name) : id)
    tag(frame, 'mermapix:kind', pseudo || 'State')
    results.pseudo++
    return
  }
  frame.name = `State: ${res.label || id}`
  tag(frame, CLUSTER_LABEL_KEY, res.label || id)
  tag(frame, 'mermapix:kind', 'State')
  results.states++
}

/** Converts every state group below `root`, then nests states / composites by geometry. */
export function convertStates(root: any): StateResults {
  const results: StateResults = { states: 0, composites: 0, pseudo: 0, notes: 0 }
  for (const { group, id, role } of findStateGroups(root)) {
    if (!isLive(group) || !group.parent) continue
    convertStateGroup(group, id, role, results)
  }
  if (results.states + results.composites + results.pseudo + results.notes > 0) nestIntoClusters(root)
  return results
}
