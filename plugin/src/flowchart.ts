// Flowchart / sitemap node conversion (Phase 8.2). Subgraphs -> frames + membership live in
// subgraphs.ts, edge grouping/naming in connectors.ts (Phase 8.3); optimize.ts wires the steps.
//
// Mermaid flowchart node groups are named `<svgId>-flowchart-<nodeId>-<n>` by Figma's importer
// (it names every GROUP by its SVG id). Cluster/subgraph groups and edge vectors (`…-L_a_b_0`)
// do not match this pattern; they are handled by the 8.3 modules.

import { convertShapeGroup, type ConvertedShape } from './shapes.ts'

const FLOWCHART_NODE_RE = /-flowchart-(.+)-(\d+)$/

/** Returns the Mermaid node id when `name` is a flowchart node group name, otherwise null. */
export function flowchartNodeId(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null
  if (name.includes('inlined-marker') || name.includes('L_')) return null
  const m = FLOWCHART_NODE_RE.exec(name)
  return m ? m[1] : null
}

export interface FlowchartNodeResult extends ConvertedShape {
  nodeId: string
}

/** Converts every flowchart node group below `rootNode` into a native Auto Layout frame. */
export function convertFlowchartNodes(rootNode: any): FlowchartNodeResult[] {
  const groups: Array<{ group: any; nodeId: string }> = []
  const find = (n: any): void => {
    if (!n || n.removed || !('children' in n)) return
    for (const c of [...n.children]) {
      if (!c || c.removed) continue
      if (c.type === 'GROUP') {
        const nodeId = flowchartNodeId(c.name)
        if (nodeId !== null) {
          groups.push({ group: c, nodeId })
          continue
        }
        find(c)
      }
    }
  }
  find(rootNode)

  const results: FlowchartNodeResult[] = []
  for (const { group, nodeId } of groups) {
    const res = convertShapeGroup(group, { nodeId })
    if (res) results.push({ ...res, nodeId })
  }
  return results
}
