// Figma Plugin sandbox entry for Mermapix.
// Receives SVG from ui.html, inlines missing SVG markers (crow's foot, arrows),
// and creates native vector/text nodes on canvas with column-based Auto Layout.
// Bundled with all ./*.ts modules into plugin/code.js by scripts/build-plugin.mjs.

import { prepareSvgForFigma } from './svgPrep.ts'
import { optimizeDiagramNodes } from './optimize.ts'

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
        await Promise.all([
          figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
          figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
          figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
          figma.loadFontAsync({ family: 'Arial', style: 'Regular' }),
          figma.loadFontAsync({ family: 'Arial', style: 'Bold' }),
        ])
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
      optimizeDiagramNodes(node, msg.themeVariables)
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
