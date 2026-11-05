// Figma Plugin sandbox entry for Mermapix.
// Receives SVG from ui.html, inlines missing SVG markers (crow's foot, arrows),
// and creates native vector/text nodes on canvas with column-based Auto Layout.
// Bundled with all ./*.ts modules into plugin/code.js by scripts/build-plugin.mjs.

import { prepareSvgForFigma } from './svgPrep.ts'
import { optimizeDiagramNodes } from './optimize.ts'
import { diagramTypeFromSvg } from './genericGeometry.ts'

figma.showUI(__html__, {
  width: 500,
  height: 680,
  themeColors: true,
})

figma.ui.onmessage = async (msg: {
  type: string
  svg?: string
  name?: string
  width?: number
  height?: number
  theme?: string
  themeVariables?: Record<string, any>
}) => {
  if (msg.type === 'create-svg' && msg.svg) {
    try {
      // Preload standard fonts asynchronously so text metrics and property operations never fail
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

      // Inline SVG markers only if the UI did not already (avoids stacked duplicates), then give
      // each inlined marker group a unique id so Figma names the layer (it ignores `class`).
      const processedSvg = prepareSvgForFigma(msg.svg)
      const node = figma.createNodeFromSvg(processedSvg)
      node.name = msg.name || 'Mermapix Diagram'

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
      ensureAllLayersVisible(node)

      figma.currentPage.appendChild(node)

      // Optimize layers: convert ERD tables to column-based Auto Layout & dissolve redundant groups
      optimizeDiagramNodes(node, msg.themeVariables, diagramTypeFromSvg(msg.svg))
      ensureAllLayersVisible(node)

      // Center in current user viewport
      const center = figma.viewport.center
      node.x = Math.round(center.x - node.width / 2)
      node.y = Math.round(center.y - node.height / 2)

      figma.currentPage.selection = [node]
      figma.viewport.scrollAndZoomIntoView([node])
      figma.notify('✓ Mermapix diagram added to canvas with clean Auto Layout layers!')
    } catch (err) {
      figma.notify(
        'Failed to create diagram: ' + (err instanceof Error ? err.message : String(err)),
        { error: true },
      )
    }
  } else if (msg.type === 'resize' && msg.width && msg.height) {
    figma.ui.resize(Math.round(msg.width), Math.round(msg.height))
  } else if (msg.type === 'close') {
    figma.closePlugin()
  }
}
