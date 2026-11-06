// Mermapix Figma structure audit - single source of truth.
//
// Plain JS on purpose: this module is imported by the developer test runner (plugin-dev/src/main.ts)
// and by unit tests, and `scripts/gen-figma-audit.mjs` copies it (minus `export`) into the paste-ready
// `tests/figma-audit.js` for the Figma MCP `use_figma` tool. So: no imports, no TypeScript, no
// top-level side effects, only function declarations. Read-only: never mutates the file.

export const AUDIT_NS = 'mermapix'

/** Calls fn(node, depth) for n and every descendant. */
export function walk(n, fn, depth = 0) {
  fn(n, depth)
  if ('children' in n) for (const c of n.children) walk(c, fn, depth + 1)
}

export function isInsideAutoLayout(n, root) {
  for (let p = n.parent; p && p !== root; p = p.parent) {
    if (p.type === 'FRAME' && p.layoutMode !== 'NONE') return true
  }
  return false
}

/** Number of non-empty <text> elements in an SVG payload (what the Figma import should keep as TEXT). */
export function countSvgTexts(svg) {
  let count = 0
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g
  let m
  while ((m = re.exec(svg))) {
    if (m[1].replace(/<[^>]*>/g, '').trim() !== '') count++
  }
  return count
}

function visibleSolid(n) {
  const fills = n.fills
  if (!Array.isArray(fills)) return null
  for (const f of fills) {
    if (f && f.type === 'SOLID' && f.visible !== false && (f.opacity === undefined || f.opacity >= 0.5)) return f.color
  }
  return null
}

/** Near-black on light themes / near-white on dark themes is the wrong-colour "black box" signature. */
export function isWrongThemeInk(color, theme) {
  if (!color) return false
  if (theme === 'light') return color.r < 0.12 && color.g < 0.12 && color.b < 0.12
  if (theme === 'dark') return color.r > 0.94 && color.g > 0.94 && color.b > 0.94
  return false
}

/** Reads the metadata the test runner stored on a diagram root ({fixture, theme, svgTextCount, ...}). */
export function readMeta(n) {
  try {
    const raw = n.getSharedPluginData(AUDIT_NS, 'meta')
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

/**
 * Audits one diagram root. `meta` is optional: `{ theme: 'light'|'dark', svgTextCount: number }`
 * enables the theme-dependent black-box check and the lost-text check.
 */
export function auditDiagram(root, meta) {
  meta = meta || {}
  const counts = { GROUP: 0, VECTOR: 0, TEXT: 0, FRAME: 0, autoLayoutFrames: 0, maxDepth: 0 }
  const stacks = {}
  const unconvertedTables = []
  const overflowingText = []
  const blackBoxes = []
  const outside = []
  const over = { left: 0, top: 0, right: 0, bottom: 0 }
  const rb = root.absoluteBoundingBox
  let looseShapes = 0
  let unnamedLayers = 0

  walk(root, (n, depth) => {
    if (counts[n.type] !== undefined) counts[n.type]++
    counts.maxDepth = Math.max(counts.maxDepth, depth)
    if (n.type === 'FRAME' && n.layoutMode !== 'NONE') counts.autoLayoutFrames++
    if (n !== root && (n.name === 'Vector' || n.name === 'Group')) unnamedLayers++

    // Content outside the root frame's bounds: the frame is too small / content is cropped.
    if (n !== root && rb && n.absoluteBoundingBox) {
      const b = n.absoluteBoundingBox
      const l = rb.x - b.x
      const t = rb.y - b.y
      const r = b.x + b.width - (rb.x + rb.width)
      const bt = b.y + b.height - (rb.y + rb.height)
      if (l > 1 || t > 1 || r > 1 || bt > 1) {
        outside.push(n.name)
        over.left = Math.max(over.left, l)
        over.top = Math.max(over.top, t)
        over.right = Math.max(over.right, r)
        over.bottom = Math.max(over.bottom, bt)
      }
    }

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

    // Near-black (light) / near-white (dark) shape covering over a quarter of its parent.
    if (
      n !== root &&
      meta.theme &&
      (n.type === 'VECTOR' || n.type === 'RECTANGLE' || n.type === 'ELLIPSE' || n.type === 'POLYGON' || n.type === 'FRAME') &&
      n.absoluteBoundingBox &&
      n.parent &&
      n.parent.absoluteBoundingBox &&
      isWrongThemeInk(visibleSolid(n), meta.theme)
    ) {
      const b = n.absoluteBoundingBox
      const pb = n.parent.absoluteBoundingBox
      const area = b.width * b.height
      const parentArea = pb.width * pb.height
      if (area >= 1600 && parentArea > 0 && area / parentArea > 0.25) {
        blackBoxes.push(`${n.type} ${n.name} ${Math.round(b.width)}x${Math.round(b.height)} in ${n.parent.name}`)
      }
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

  const hasSvgText = typeof meta.svgTextCount === 'number'
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
    contentOverflow: {
      count: outside.length,
      px: { left: Math.round(over.left), top: Math.round(over.top), right: Math.round(over.right), bottom: Math.round(over.bottom) },
      examples: outside.slice(0, 5),
    },
    textsExpected: hasSvgText ? meta.svgTextCount : null,
    textsLost: hasSvgText ? Math.max(0, meta.svgTextCount - counts.TEXT) : null,
    blackBoxes: meta.theme ? { count: blackBoxes.length, examples: blackBoxes.slice(0, 5) } : null,
  }
}

/** Failing metrics of an audit as short labels. Informational counters (unnamedLayers) never fail a diagram. */
export function summarizeAudit(a) {
  const issues = []
  if (a.duplicateStacks) issues.push(`duplicateStacks:${a.duplicateStacks}`)
  if (a.looseShapes) issues.push(`looseShapes:${a.looseShapes}`)
  if (a.unconvertedTables.length) issues.push(`unconvertedTables:${a.unconvertedTables.length}`)
  if (a.overflowingText.length) issues.push(`overflowingText:${a.overflowingText.length}`)
  if (a.contentOverflow && a.contentOverflow.count) issues.push(`contentOverflow:${a.contentOverflow.count}`)
  if (a.textsLost) issues.push(`textsLost:${a.textsLost}`)
  if (a.blackBoxes && a.blackBoxes.count) issues.push(`blackBoxes:${a.blackBoxes.count}`)
  return { ok: issues.length === 0, issues }
}

/** Diagram roots on a page: top-level FRAMEs plus FRAMEs inside SECTIONs (the test runner's layout). */
export function findDiagramRoots(page) {
  const roots = []
  for (const n of page.children) {
    if (n.type === 'FRAME') roots.push(n)
    else if (n.type === 'SECTION') for (const c of n.children) if (c.type === 'FRAME') roots.push(c)
  }
  return roots
}
