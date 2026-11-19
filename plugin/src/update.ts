// In-place regeneration of a source-linked diagram (Phase 11).
//
// The old root keeps its id, parent, z-order, top-left position and layer name; only its content is swapped.
// Keeping the root is what lets component instances (the user may have turned the diagram into a COMPONENT)
// follow the update. Pure node manipulation, no top-level `figma` access, so tests can import it directly.

import { DATA_PREFIX, DIAGRAM_KEY, FINGERPRINT_KEY } from './sourceLink.ts'

function dataKeys(node: any): string[] {
  try {
    if (typeof node.getPluginDataKeys === 'function') {
      return (node.getPluginDataKeys() as string[]).filter((k) => typeof k === 'string' && k.indexOf(DATA_PREFIX) === 0)
    }
  } catch {}
  return [DIAGRAM_KEY, FINGERPRINT_KEY]
}

/** Only a frame or a component can have its content swapped (a group would vanish when emptied). */
export function canTransplant(node: any): boolean {
  return !!node && !node.removed && (node.type === 'FRAME' || node.type === 'COMPONENT')
}

/** Assigns a root paint/clip property; a node type without it (or a refusing editor) just keeps its value. */
function copyProp(target: any, fresh: any, prop: string): void {
  try {
    const v = fresh[prop]
    if (v === undefined || typeof v === 'symbol') return
    target[prop] = Array.isArray(v) ? v.slice() : v
  } catch {}
}

/** The page a node lives on (the node itself when it is a page); null for detached nodes. */
export function pageOf(node: any): any | null {
  let n = node
  for (let guard = 0; n && guard < 10000; guard++) {
    if (n.type === 'PAGE') return n
    n = n.parent
  }
  return null
}

/**
 * Replaces the content of `target` with the content of `fresh` and removes the emptied `fresh`.
 *
 * Both are frames and share the same internal coordinate system (children are relative to the root), so each
 * child keeps its numbers: they are recorded before the move and written back after it, the same
 * convention as `moveKeepingAbs` in subgraphs.ts, instead of trusting appendChild to preserve them.
 *
 * Order is chosen so that a failure leaves the target as it was: the new children are appended first (on
 * failure they are removed again), the old children are deleted only after every new one is in place.
 *
 * Copied from `fresh` to `target`: `fills`, `strokes`, `strokeWeight`, `cornerRadius`, `clipsContent`, size,
 * and every `mermapix:*` plugin data entry (stale `mermapix:*` keys on the target are cleared first). Not
 * copied: name, x/y, parent, z-order, opacity, effects, constraints, `layoutSizing*`, exports, relaunch data
 * (the caller stamps that), and any plugin data without the `mermapix:` prefix.
 */
export function transplantDiagram(target: any, fresh: any): void {
  if (!target || !fresh || target === fresh) throw new Error('transplantDiagram: need two distinct nodes')
  if (!canTransplant(target)) throw new Error('transplantDiagram: target must be a live frame or component')

  const oldChildren: any[] = [...(target.children || [])]
  const incoming: any[] = [...(fresh.children || [])]
  const pos = incoming.map((c) => ({ x: c.x, y: c.y }))

  // A user may have switched the diagram root to Auto Layout; the new content is absolutely positioned.
  const prevLayout = target.layoutMode
  if (prevLayout !== undefined && prevLayout !== 'NONE') target.layoutMode = 'NONE'

  const moved: any[] = []
  try {
    incoming.forEach((c, i) => {
      target.appendChild(c)
      moved.push(c)
      c.x = pos[i].x
      c.y = pos[i].y
    })
  } catch (err) {
    for (const c of moved) {
      try {
        c.remove()
      } catch {}
    }
    if (prevLayout !== undefined && prevLayout !== 'NONE') {
      try {
        target.layoutMode = prevLayout
      } catch {}
    }
    throw err
  }

  for (const c of oldChildren) {
    try {
      if (!c.removed) c.remove()
    } catch {}
  }

  const w = fresh.width
  const h = fresh.height
  if (typeof target.resizeWithoutConstraints === 'function') target.resizeWithoutConstraints(w, h)
  else target.resize(w, h)

  for (const prop of ['fills', 'strokes', 'strokeWeight', 'cornerRadius', 'clipsContent']) copyProp(target, fresh, prop)

  // Plugin data: the target ends up with exactly the fresh root's mermapix:* entries.
  const freshKeys = dataKeys(fresh)
  for (const k of dataKeys(target)) {
    if (freshKeys.indexOf(k) < 0) {
      try {
        target.setPluginData(k, '')
      } catch {}
    }
  }
  for (const k of freshKeys) {
    try {
      target.setPluginData(k, fresh.getPluginData(k))
    } catch {}
  }

  try {
    fresh.remove()
  } catch {}
}
