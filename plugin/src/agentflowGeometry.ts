// Pure helpers for agentflow diagrams (Mermaid 12.3.0 `agentflow-beta`, Phase 14.4); no `figma` usage.
//
// Structure Mermaid emits (classic look, htmlLabels false):
//   node        <g id="<svgId>-agentflow-<id>-<n>">  one shape element (rect / polygon / path pair) + label group
//   flow        <g id="<svgId>-<id>">                 one rect (rx 10, no fill) + title group; nodes are NOT inside it
//   edge        <path id="<svgId>-L_<from>_<to>_<n>"> + inlined marker group(s); like flowchart edges
//   edge kinds  `-->` sequence (arrowhead), `-.-` reference (dotted, no marker), `--x` failure (cross marker)
// The node shape is the only thing that tells the kind apart (the CSS class `af-kind-*` is stripped by the export):
//   task = rounded rect, tool = subroutine, input = parallelogram, decision = diamond, action = hexagon,
//   refdoc = lined document (a wavy-bottom path drawn twice: fill path + hand-drawn outline).

import type { ShapeKind } from './shapeGeometry.ts'
import type { EdgeStyle } from './connectors.ts'

const NODE_RE = /-agentflow-(.+)-(\d+)$/

/** Mermaid id of an agentflow node group (`mermaid-svg-0-agentflow-classify-2` -> `classify`), else null. */
export function agentflowNodeId(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string' || name.includes('inlined-marker')) return null
  const m = NODE_RE.exec(name)
  return m ? m[1] : null
}

export type AgentflowKind = 'Task' | 'Tool' | 'Input' | 'Decision' | 'Action' | 'Refdoc'

/**
 * Agentflow node kind from the classified shape. `stackedPair` = the node drew its outline twice (fill path +
 * hand-drawn outline path with identical bounds): only the lined document does that, and its polygon is not a
 * known shape. Anything else (a canonical shape name used directly: `shape: cyl`, `shape: rect`) gets no kind
 * and keeps its geometric name.
 */
export function agentflowKind(kind: ShapeKind, stackedPair: boolean): AgentflowKind | null {
  switch (kind) {
    case 'Rounded Rectangle':
      return 'Task'
    case 'Subroutine':
      return 'Tool'
    case 'Parallelogram':
      return 'Input'
    case 'Diamond':
      return 'Decision'
    case 'Hexagon':
      return 'Action'
    case 'Polygon':
    case 'Shape':
      return stackedPair ? 'Refdoc' : null
    default:
      return null
  }
}

const MARKER_NAME_RE = /^inlined-marker-\d+-([a-z-]+)-(?:start|end)$/

/** Marker kind encoded in a raw marker layer name (`inlined-marker-3-cross-end` -> `cross`), else ''. */
export function markerKindOfLayer(name: string | null | undefined): string {
  const m = MARKER_NAME_RE.exec(String(name || '').trim().toLowerCase())
  return m ? m[1] : ''
}

/**
 * Edge semantics of an agentflow connector (docs: sequence `-->`, reference `-.-`, failure `--x`) from its marker
 * kinds and dash. Null when the combination is none of the three, so the edge keeps the default naming.
 */
export function agentflowEdgeStyle(markerKinds: string[], dashed: boolean): EdgeStyle | null {
  if (markerKinds.includes('cross')) return { line: 'Failure', suffix: ' (failure)' }
  if (markerKinds.includes('arrowhead')) return { line: 'Sequence' }
  if (markerKinds.length === 0 && dashed) return { line: 'Reference', suffix: ' (reference)' }
  return null
}
