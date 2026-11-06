// Shared diagram insertion steps used by the production plugin (main.ts) and the developer
// test runner (plugin-dev/src/main.ts), so both go through exactly the same conversion.

import { prepareSvgForFigma } from './svgPrep.ts'
import { optimizeDiagramNodes } from './optimize.ts'
import { diagramTypeFromSvg } from './genericGeometry.ts'

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
 * Imports the UI's SVG payload as editable layers on the current page and runs the optimizer.
 * Fonts must already be loaded (`loadDiagramFonts`). Returns the diagram root node.
 */
export function createDiagramNode(msg: {
  svg: string
  name?: string
  themeVariables?: Record<string, any>
}): any {
  // Inline SVG markers only if the UI did not already (avoids stacked duplicates), then give
  // each inlined marker group a unique id so Figma names the layer (it ignores `class`).
  const processedSvg = prepareSvgForFigma(msg.svg)
  const node = figma.createNodeFromSvg(processedSvg)
  node.name = msg.name || 'Mermapix Diagram'

  ensureAllLayersVisible(node)

  figma.currentPage.appendChild(node)

  // Optimize layers: convert ERD tables to column-based Auto Layout & dissolve redundant groups
  optimizeDiagramNodes(node, msg.themeVariables, diagramTypeFromSvg(msg.svg))
  ensureAllLayersVisible(node)
  return node
}
