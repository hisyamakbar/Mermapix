// Structural metrics of a (mock) Figma tree, used by the Phase 8.5 survey and the generic fallback tests.
import { walk } from './figma-mock.mjs'

// Names the SVG importer invents (Vector, Group, Frame, Text, empty, raw mermaid-svg ids). Kind names such as 'Line' or 'Rectangle' are descriptive.
export const GENERIC_NAME_RE = /^(vector|group|frame|text)( ?\d+)?$|^$|mermaid-(svg|\d)/i
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol

export const isGenericName = (name) => GENERIC_NAME_RE.test(String(name ?? '').trim())

/** Bounds relative to the root frame (GROUPs transparent, FRAME positions accumulate). */
export function relBounds(n, root) {
  let x = n.x, y = n.y, p = n.parent
  while (p && p !== root) { if (p.type === 'FRAME') { x += p.x; y += p.y } p = p.parent }
  return { x, y, width: n.width, height: n.height }
}

const sameBounds = (a, b, tol = 0.5) => near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.width, b.width, tol) && near(a.height, b.height, tol)

/** { texts, vectors, frames, loose, stacked, generic } for a serialized tree (children without parent links). */
export function metrics(tree) {
  const m = { texts: 0, vectors: 0, frames: 0, loose: 0, stacked: 0, generic: 0, textList: [] }
  const rec = (n, inFrame, parentVectors) => {
    if (n.type === 'TEXT') {
      if ((n.characters || '').trim()) { m.texts++; m.textList.push(n.characters.trim()) }
      if (isGenericName(n.name)) m.generic++
      return
    }
    if (n.type === 'VECTOR') {
      m.vectors++
      if (!inFrame) m.loose++
      if (isGenericName(n.name)) m.generic++
      return
    }
    if (n.type === 'FRAME') m.frames++
    if (n.type === 'GROUP' && isGenericName(n.name)) m.generic++
    if (n.type === 'FRAME' && isGenericName(n.name) && !n.__root) m.generic++
    const kids = n.children || []
    // stacked = vectors of one parent with identical bounds
    const vs = kids.filter((c) => c.type === 'VECTOR' && c.width >= 1 && c.height >= 1)
    const seen = []
    for (const v of vs) {
      if (seen.some((s) => sameBounds(s, v))) m.stacked++
      else seen.push(v)
    }
    for (const c of kids) rec(c, inFrame || (n.type === 'FRAME' && n.__root !== true && n !== tree), null)
  }
  rec(tree, false, null)
  return m
}

/** Flat list of leaf marks (VECTOR/TEXT) with root-relative bounds and a stable index, from a live node tree. */
export function leafMarks(root) {
  const out = []
  walk(root, (n) => { if ((n.type === 'VECTOR' || n.type === 'TEXT') && !n.removed) out.push(n) })
  return out
}
