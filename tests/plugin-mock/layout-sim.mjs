// Minimal Auto Layout simulation for the vertical compartment frames built in Phase 8.5 (the mock Figma
// does not lay out children). Returns each child's position inside its frame, like Figma would.

/** Child positions of a VERTICAL Auto Layout frame (primary axis MIN, counter axis MIN|CENTER|MAX). */
export function layoutVertical(frame) {
  const padL = frame.paddingLeft || 0, padR = frame.paddingRight || 0
  const padT = frame.paddingTop || 0
  const spacing = frame.itemSpacing || 0
  const innerW = frame.width - padL - padR
  let y = padT
  return frame.children.map((c) => {
    const x = frame.counterAxisAlignItems === 'CENTER' ? padL + (innerW - c.width) / 2 : frame.counterAxisAlignItems === 'MAX' ? padL + innerW - c.width : padL
    const pos = { node: c, x, y }
    y += c.height + spacing
    return pos
  })
}

/** Positions of a child of a CENTER/CENTER horizontal frame: centered with the asymmetric padding. */
export function layoutCentered(frame, child) {
  const innerW = frame.width - (frame.paddingLeft || 0) - (frame.paddingRight || 0)
  const innerH = frame.height - (frame.paddingTop || 0) - (frame.paddingBottom || 0)
  return { x: (frame.paddingLeft || 0) + (innerW - child.width) / 2, y: (frame.paddingTop || 0) + (innerH - child.height) / 2 }
}

/**
 * General single-line Auto Layout simulation (Phase 9.2): HORIZONTAL or VERTICAL, FIXED frame size,
 * primary axis MIN | CENTER | MAX | SPACE_BETWEEN, counter axis MIN | CENTER | MAX, padding + itemSpacing.
 * Returns each in-flow child's position inside its frame (children with layoutPositioning ABSOLUTE keep x/y).
 */
export function layoutAuto(frame) {
  const horizontal = frame.layoutMode === 'HORIZONTAL'
  const padStart = horizontal ? frame.paddingLeft || 0 : frame.paddingTop || 0
  const padEnd = horizontal ? frame.paddingRight || 0 : frame.paddingBottom || 0
  const padCStart = horizontal ? frame.paddingTop || 0 : frame.paddingLeft || 0
  const padCEnd = horizontal ? frame.paddingBottom || 0 : frame.paddingRight || 0
  const main = horizontal ? frame.width : frame.height
  const cross = horizontal ? frame.height : frame.width
  const kids = frame.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE')
  const size = (c) => (horizontal ? c.width : c.height)
  const crossSize = (c) => (horizontal ? c.height : c.width)
  const gap0 = frame.itemSpacing || 0
  const total = kids.reduce((s, c) => s + size(c), 0)
  const inner = main - padStart - padEnd
  let start = padStart
  let gap = gap0
  const align = frame.primaryAxisAlignItems || 'MIN'
  if (align === 'SPACE_BETWEEN') gap = kids.length > 1 ? (inner - total) / (kids.length - 1) : 0
  else {
    const used = total + gap0 * Math.max(0, kids.length - 1)
    start = align === 'CENTER' ? padStart + (inner - used) / 2 : align === 'MAX' ? padStart + inner - used : padStart
  }
  const cAlign = frame.counterAxisAlignItems || 'MIN'
  const cInner = cross - padCStart - padCEnd
  let p = start
  return kids.map((c) => {
    const cp = cAlign === 'CENTER' ? padCStart + (cInner - crossSize(c)) / 2 : cAlign === 'MAX' ? padCStart + cInner - crossSize(c) : padCStart
    const pos = horizontal ? { node: c, x: p, y: cp } : { node: c, x: cp, y: p }
    p += size(c) + gap
    return pos
  })
}
