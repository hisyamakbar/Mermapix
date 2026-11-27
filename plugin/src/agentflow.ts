// agentflow-beta conversion (Mermaid 12.3.0, Phase 14.4).
//
// An agentflow is a flowchart in everything the plugin cares about: node groups (one shape + label), flow
// containers as cluster rects that do NOT contain their nodes in the SVG, edges `L_<from>_<to>_<n>` with inlined
// markers. So this reuses the flowchart pipeline:
//   nodes   `convertShapeGroup` (Auto Layout frame for task, wrapper frame + one merged vector for the other shapes),
//           named by kind: `Task: <label>`, `Tool: ...`, `Input: ...`, `Decision: ...`, `Action: ...`, `Refdoc: ...`
//   flows   `convertClusters` -> `Flow: <title>` frames, then `nestIntoClusters` (geometry, any depth)
//   edges   `arrangeFlowchart` (connectors.ts) with `agentflowEdgeStyle`: Sequence / Reference / Failure
// Beta syntax: every rule below degrades to the generic fallback (a group it does not understand is left alone).

import { classifyShape, groupStackedBounds } from './shapeGeometry.ts'
import { collectParts, convertShapeGroup, pathDataOf, tag } from './shapes.ts'
import { CLUSTER_LABEL_KEY, convertClusters, nestIntoClusters } from './subgraphs.ts'
import { agentflowKind, agentflowNodeId, type AgentflowKind } from './agentflowGeometry.ts'

const isLive = (n: any): boolean => Boolean(n) && !n.removed

export const ROLE_KEY = 'mermapix:role'

export interface AgentflowResult {
  nodes: number
  flows: number
}

/** Converts the nodes and flow containers of an agentflow payload. Returns what it found (0 / 0 = not agentflow). */
export function convertAgentflow(root: any): AgentflowResult {
  const groups: Array<{ group: any; id: string }> = []
  const find = (n: any): void => {
    if (!isLive(n) || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!isLive(c) || c.type !== 'GROUP') continue
      const id = agentflowNodeId(c.name)
      if (id !== null) groups.push({ group: c, id })
      else find(c)
    }
  }
  find(root)

  let nodes = 0
  for (const { group, id } of groups) {
    // Look before converting: the lined document is the only node that draws its (non-rect) outline twice.
    const parts = collectParts(group)
    const stackedPair = groupStackedBounds(parts.vectors).some((s) => s.length === 2 && !classifyShape(pathDataOf(s[0]), s[0].width, s[0].height).rectLike)
    const res = convertShapeGroup(group, { nodeId: id })
    if (!res) continue
    const kind: AgentflowKind | null = agentflowKind(res.kind, stackedPair)
    const label = res.label || id
    res.frame.name = `${kind || res.kind}: ${label}`
    tag(res.frame, CLUSTER_LABEL_KEY, label)
    tag(res.frame, ROLE_KEY, (kind || res.kind).toLowerCase())
    nodes++
  }
  if (nodes === 0) return { nodes: 0, flows: 0 }

  // Nodes are frames now, so the only cluster-shaped groups left are the flow containers.
  const flows = convertClusters(root, { prefix: 'Flow', kind: 'Flow' })
  for (const f of flows) tag(f.frame, ROLE_KEY, 'flow')
  nestIntoClusters(root)
  return { nodes, flows: flows.length }
}
