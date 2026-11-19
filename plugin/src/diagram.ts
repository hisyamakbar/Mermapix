// Shared diagram insertion steps used by the production plugin (main.ts) and the developer
// test runner (plugin-dev/src/main.ts), so both go through exactly the same conversion.

import { prepareSvgForFigma } from './svgPrep.ts'
import { optimizeDiagramNodes } from './optimize.ts'
import { diagramTypeFromSvg } from './genericGeometry.ts'
import { encodeDiagram, storeDiagram } from './sourceLink.ts'
import { stampLayers } from './snapshot.ts'
import type { DiagramTheme } from './protocol.ts'

/** Preload standard fonts so text metrics and property operations never fail. */
export async function loadDiagramFonts(): Promise<void> {
  try {
    const fonts = [
      { family: 'Inter', style: 'Regular' },
      { family: 'Inter', style: 'Medium' },
      { family: 'Inter', style: 'Semi Bold' },
      { family: 'Inter', style: 'Bold' },
      { family: 'Inter', style: 'Italic' },
      { family: 'Inter', style: 'Bold Italic' },
      { family: 'Arial', style: 'Regular' },
      { family: 'Arial', style: 'Bold' },
    ]
    // One missing style must not block the others.
    await Promise.all(fonts.map((f) => figma.loadFontAsync(f).catch(() => {})))
  } catch (fontErr) {
    // Non-blocking fallback if custom style unavailable
  }
}

function ensureAllLayersVisible(n: any): void {
  if (!n || n.removed) return
  try {
    n.visible = true
  } catch {}
  if ('children' in n && Array.isArray(n.children)) {
    for (const child of n.children) {
      ensureAllLayersVisible(child)
    }
  }
}

/**
 * Imports the UI's SVG payload as editable layers and runs the optimizer. The node goes on `msg.parent`
 * (default: the current page). Fonts must already be loaded (`loadDiagramFonts`). Returns the diagram root node.
 *
 * With `source` the Mermaid source is stored on the root (Phase 11), every layer is stamped for change detection
 * (Phase 12, ./snapshot.ts) and the root gets a relaunch button; read
 * `getPluginData('mermapix:diagram')` on the result to see whether it fit into plugin data. A failure after the
 * node was created leaves that node on its parent (the developer test runner inspects it); callers that need
 * a clean failure remove it themselves.
 */
export function createDiagramNode(msg: {
  svg: string
  name?: string
  themeVariables?: Record<string, any>
  source?: string
  theme?: DiagramTheme
  parent?: any
}): any {
  // Inline SVG markers only if the UI did not already (avoids stacked duplicates), then give
  // each inlined marker group a unique id so Figma names the layer (it ignores `class`).
  const processedSvg = prepareSvgForFigma(msg.svg)
  const node = figma.createNodeFromSvg(processedSvg)
  node.name = msg.name || 'Mermapix Diagram'

  ensureAllLayersVisible(node)

  const parent = msg.parent || figma.currentPage
  parent.appendChild(node)

  // Optimize layers: convert ERD tables to column-based Auto Layout & dissolve redundant groups
  optimizeDiagramNodes(node, msg.themeVariables, diagramTypeFromSvg(msg.svg))
  ensureAllLayersVisible(node)

  // Written last: the fingerprint describes the final tree. It ignores the root's x/y, so positioning the node afterwards is fine.
  if (typeof msg.source === 'string') {
    const link = { source: msg.source, theme: msg.theme === 'dark' ? 'dark' : 'light', type: diagramTypeFromSvg(msg.svg) } as const
    // Phase 12: per-layer stamps (what was generated, where each text came from), only for diagrams that get linked.
    if (encodeDiagram(link) !== null) stampLayers(node)
    storeDiagram(node, link)
  }
  return node
}
