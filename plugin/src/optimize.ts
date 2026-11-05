// Orchestrates the diagram optimization passes on an imported SVG node tree.
//
// Pipeline (order matters and must stay identical):
//   1. purgeJunkNodes        - drop ghost/empty layers
//   2. DIAGRAM_STEPS         - per-diagram-type conversions (ERD tables, flowchart nodes/subgraphs/connectors, sequence,
//                              class, state, edge labels, connectors) and, LAST, the generic fallback for every other type
//   3. flattenWrappers       - dissolve redundant wrapper groups (5 passes, each followed by a purge)
//   4. elevateSequenceNumbers
//   5. unwrapRootGroup
//   6. finalClean            - semantic layer naming
//   7. applyRootBackground   - theme background on the root frame
//
// To add a diagram type, create `plugin/src/<type>.ts` exporting a DiagramStep
// and register it in DIAGRAM_STEPS below. Steps run in array order.

import { convertErdTables } from './erd.ts'
import { convertFlowchartNodes } from './flowchart.ts'
import { convertClusters, nestIntoClusters } from './subgraphs.ts'
import { arrangeFlowchart } from './connectors.ts'
import { convertEdgeLabels } from './edgeLabels.ts'
import { convertSequence } from './sequence.ts'
import { convertClasses, convertClassInterfaces, convertClassNotes } from './class.ts'
import { convertStates } from './state.ts'
import { applyGenericFallback } from './generic.ts'
import { parseColorToFigma } from './theme.ts'
import {
  purgeJunkNodes,
  flattenWrappers,
  elevateSequenceNumbers,
  unwrapRootGroup,
  finalClean,
} from './cleanup.ts'

export interface StepContext {
  /** `aria-roledescription` of the SVG root (`pie`, `gantt`, `class`, ...), '' when unknown. */
  diagramType?: string
}

export interface DiagramStep {
  name: string
  run(rootNode: any, themeVariables?: Record<string, any>, ctx?: StepContext): void
}

const erdStep: DiagramStep = {
  name: 'erd',
  run: (rootNode, themeVariables) => convertErdTables(rootNode, themeVariables),
}

const flowchartStep: DiagramStep = {
  name: 'flowchart',
  run: (rootNode) => {
    const nodes = convertFlowchartNodes(rootNode)
    if (nodes.length === 0) return
    // Subgraphs -> frames, then every node/cluster frame into the smallest cluster that contains it.
    convertClusters(rootNode)
    nestIntoClusters(rootNode)
  },
}

/**
 * Sequence diagrams (Phase 8.4): participants, actors, notes, activations, blocks and messages become
 * frames / groups. Runs only when lifeline vectors (`actorN`) exist, so other diagram types are untouched.
 */
const sequenceStep: DiagramStep = {
  name: 'sequence',
  run: (rootNode) => {
    try {
      convertSequence(rootNode)
    } catch {
      // A failure must never abort the insert: the partially converted tree is still valid Figma content.
    }
  },
}

/**
 * classDiagram (Phase 8.5): class boxes -> Auto Layout class frames, namespaces -> container frames,
 * notes -> frames. Relations are grouped later by the connectors step.
 */
const classStep: DiagramStep = {
  name: 'class',
  run: (rootNode) => {
    try {
      const classes = convertClasses(rootNode)
      const notes = convertClassNotes(rootNode).concat(convertClassInterfaces(rootNode))
      if (classes.length === 0 && notes.length === 0) return
      convertClusters(rootNode, { prefix: 'Namespace', kind: 'Namespace' })
      nestIntoClusters(rootNode)
    } catch {
      // Never abort the insert: a partially converted tree is still valid Figma content.
    }
  },
}

/** stateDiagram-v2 (Phase 8.5): states, composite containers, start/end/choice/fork/join and notes -> frames. */
const stateStep: DiagramStep = {
  name: 'state',
  run: (rootNode) => {
    try {
      convertStates(rootNode)
    } catch {
      // see classStep
    }
  },
}

/** Edge/relationship labels of every diagram type; must run after the node/table steps. */
const edgeLabelStep: DiagramStep = {
  name: 'edge-labels',
  run: (rootNode) => {
    convertEdgeLabels(rootNode)
  },
}

/**
 * Flowchart connectors: edge line + markers + label -> `Edge: A → B` groups inside one `Connectors`
 * group on top of subgraphs and nodes. Needs the edge-label frames, so it runs last.
 */
const connectorsStep: DiagramStep = {
  name: 'connectors',
  run: (rootNode) => {
    arrangeFlowchart(rootNode)
  },
}

/**
 * Fallback for every type without a dedicated converter (Phase 8.5): stacked fill/outline pairs and
 * single-label cards become frames (node diagrams only), remaining generic layers get descriptive
 * names. Must stay LAST: it gates itself on the structure the earlier steps produced.
 */
const genericStep: DiagramStep = {
  name: 'generic',
  run: (rootNode, _theme, ctx) => {
    try {
      applyGenericFallback(rootNode, ctx && ctx.diagramType)
    } catch {
      // Never abort the insert.
    }
  },
}

/** Per-diagram-type steps, executed in order between the initial purge and the generic cleanup. */
export const DIAGRAM_STEPS: DiagramStep[] = [erdStep, flowchartStep, sequenceStep, classStep, stateStep, edgeLabelStep, connectorsStep, genericStep]

/**
 * Figma imports the SVG root as a frame whose white fill is not shown (canvas shows through),
 * while the web preview has the theme background. Paint the theme background so both match.
 */
export function applyRootBackground(rootNode: any, themeVariables?: Record<string, any>): void {
  const color = parseColorToFigma(themeVariables && themeVariables.background)
  if (!color || !rootNode || rootNode.type !== 'FRAME') return
  try {
    rootNode.fills = [{ type: 'SOLID', color, opacity: 1, visible: true }]
  } catch {}
}

export function optimizeDiagramNodes(rootNode: any, themeVariables?: Record<string, any>, diagramType?: string): void {
  purgeJunkNodes(rootNode)

  for (const step of DIAGRAM_STEPS) {
    step.run(rootNode, themeVariables, { diagramType })
  }

  flattenWrappers(rootNode)
  elevateSequenceNumbers(rootNode)
  unwrapRootGroup(rootNode)
  finalClean(rootNode)
  applyRootBackground(rootNode, themeVariables)
}
