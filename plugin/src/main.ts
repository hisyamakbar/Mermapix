// Figma Plugin sandbox entry for Mermapix.
// Receives SVG from ui.html, inlines missing SVG markers (crow's foot, arrows),
// and creates native vector/text nodes on canvas with column-based Auto Layout.
// Bundled with all ./*.ts modules into plugin/code.js by scripts/build-plugin.mjs.
// The conversion itself lives in ./diagram.ts (shared with the developer test runner).

import { createDiagramNode, loadDiagramFonts } from './diagram.ts'

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
      await loadDiagramFonts()
      const node = createDiagramNode({
        svg: msg.svg,
        name: msg.name,
        themeVariables: msg.themeVariables,
      })

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
