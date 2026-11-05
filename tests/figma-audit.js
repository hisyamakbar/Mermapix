// Mermapix Figma structure audit (Phase 8.6).
//
// Paste-ready body for the Figma MCP `use_figma` tool (or a scratch plugin):
// it reads every diagram on the current page that was inserted by the Mermapix
// plugin and reports structural quality. Read-only — it never mutates the file.
//
// Targets (Phase 8 goal):
//   duplicateStacks   0  — no two shapes stacked at the exact same bounds (double markers, fill+outline pairs)
//   looseShapes       0  — no fill/outline VECTOR outside a frame, except connectors/markers
//   unconvertedTables 0  — every ERD entity became an Auto Layout table
//   overflowingText   0  — no text wider than its Auto Layout cell
//   unnamedLayers     ↓  — generic "Vector"/"Group" names should trend to 0

function walk(n, fn, depth = 0) {
  fn(n, depth)
  if ('children' in n) for (const c of n.children) walk(c, fn, depth + 1)
}

function isInsideAutoLayout(n, root) {
  for (let p = n.parent; p && p !== root; p = p.parent) {
    if (p.type === 'FRAME' && p.layoutMode !== 'NONE') return true
  }
  return false
}

function auditDiagram(root) {
  const counts = { GROUP: 0, VECTOR: 0, TEXT: 0, FRAME: 0, autoLayoutFrames: 0, maxDepth: 0 }
  const stacks = {}
  const unconvertedTables = []
  const overflowingText = []
  let looseShapes = 0
  let unnamedLayers = 0

  walk(root, (n, depth) => {
    if (counts[n.type] !== undefined) counts[n.type]++
    counts.maxDepth = Math.max(counts.maxDepth, depth)
    if (n.type === 'FRAME' && n.layoutMode !== 'NONE') counts.autoLayoutFrames++
    if (n !== root && (n.name === 'Vector' || n.name === 'Group')) unnamedLayers++

    if (n.type === 'VECTOR' && n.absoluteBoundingBox) {
      const b = n.absoluteBoundingBox
      const key = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)}`
      stacks[key] = (stacks[key] || 0) + 1
      // A vector that encloses an area (both dimensions > 1px), is not inside a frame,
      // and is not a connector/marker is a shape that should have become a frame.
      const name = n.name.toLowerCase()
      const isLine = b.width < 1 || b.height < 1
      const isConnectorish = /connector|edge|arrow|crow|marker|badge|line|l_|id_entity/.test(name)
      const wrappedInShapeFrame = n.parent && n.parent !== root && n.parent.type === 'FRAME'
      if (!isLine && !isConnectorish && !isInsideAutoLayout(n, root) && !wrappedInShapeFrame) looseShapes++
    }

    if (n.type === 'GROUP' && /-entity-.+-\d+$/.test(n.name) && !/id_entity|cyclic-special/.test(n.name)) {
      unconvertedTables.push(n.name.replace(/^.*-entity-/, ''))
    }

    if (n.type === 'TEXT' && n.parent && n.parent.type === 'FRAME' && n.parent.layoutMode !== 'NONE') {
      const cell = n.parent
      const inner = cell.width - cell.paddingLeft - cell.paddingRight
      const used =
        cell.layoutMode === 'HORIZONTAL'
          ? cell.children.reduce((sum, c) => sum + c.width, 0) + cell.itemSpacing * (cell.children.length - 1)
          : n.width
      if (used > inner + 0.5) overflowingText.push(`${n.characters} (${used.toFixed(0)}px > ${inner.toFixed(0)}px)`)
    }
  })

  return {
    id: root.id,
    name: root.name,
    size: `${Math.round(root.width)}x${Math.round(root.height)}`,
    counts,
    duplicateStacks: Object.values(stacks).filter((v) => v > 1).length,
    looseShapes,
    unconvertedTables,
    overflowingText: overflowingText.slice(0, 20),
    unnamedLayers,
  }
}

return figma.currentPage.children.filter((n) => n.type === 'FRAME').map(auditDiagram)
