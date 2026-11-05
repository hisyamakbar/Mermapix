// Orchestrates the diagram optimization passes on an imported SVG node tree.
//
// Pipeline (order matters and must stay identical):
//   1. purgeJunkNodes        - drop ghost/empty layers
//   2. DIAGRAM_STEPS         - per-diagram-type conversions (ERD tables today)
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
import { convertEdgeLabels } from './edgeLabels.ts'
import { parseColorToFigma } from './theme.ts'
import {
  purgeJunkNodes,
  flattenWrappers,
  elevateSequenceNumbers,
  unwrapRootGroup,
  finalClean,
} from './cleanup.ts'

export interface DiagramStep {
  name: string
  run(rootNode: any, themeVariables?: Record<string, any>): void
}

const erdStep: DiagramStep = {
  name: 'erd',
  run: (rootNode, themeVariables) => convertErdTables(rootNode, themeVariables),
}

const flowchartStep: DiagramStep = {
  name: 'flowchart',
  run: (rootNode) => {
    convertFlowchartNodes(rootNode)
  },
}

/** Edge/relationship labels of every diagram type; must run after the node/table steps. */
const edgeLabelStep: DiagramStep = {
  name: 'edge-labels',
  run: (rootNode) => {
    convertEdgeLabels(rootNode)
  },
}

/** Per-diagram-type steps, executed in order between the initial purge and the generic cleanup. */
export const DIAGRAM_STEPS: DiagramStep[] = [erdStep, flowchartStep, edgeLabelStep]

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

export function optimizeDiagramNodes(rootNode: any, themeVariables?: Record<string, any>): void {
  purgeJunkNodes(rootNode)

  for (const step of DIAGRAM_STEPS) {
    step.run(rootNode, themeVariables)
  }

  flattenWrappers(rootNode)
  elevateSequenceNumbers(rootNode)
  unwrapRootGroup(rootNode)
  finalClean(rootNode)
  applyRootBackground(rootNode, themeVariables)
}
