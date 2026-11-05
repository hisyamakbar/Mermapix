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
