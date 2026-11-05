// Orchestrates the diagram optimization passes on an imported SVG node tree.
//
// Pipeline (order matters and must stay identical):
//   1. purgeJunkNodes        - drop ghost/empty layers
//   2. DIAGRAM_STEPS         - per-diagram-type conversions (ERD tables today)
//   3. flattenWrappers       - dissolve redundant wrapper groups (5 passes, each followed by a purge)
//   4. elevateSequenceNumbers
//   5. unwrapRootGroup
//   6. finalClean            - semantic layer naming
//
// To add a diagram type, create `plugin/src/<type>.ts` exporting a DiagramStep
// and register it in DIAGRAM_STEPS below. Steps run in array order.

import { convertErdTables } from './erd.ts'
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

/** Per-diagram-type steps, executed in order between the initial purge and the generic cleanup. */
export const DIAGRAM_STEPS: DiagramStep[] = [erdStep]

export function optimizeDiagramNodes(rootNode: any, themeVariables?: Record<string, any>): void {
  purgeJunkNodes(rootNode)

  for (const step of DIAGRAM_STEPS) {
    step.run(rootNode, themeVariables)
  }

  flattenWrappers(rootNode)
  elevateSequenceNumbers(rootNode)
  unwrapRootGroup(rootNode)
  finalClean(rootNode)
}
