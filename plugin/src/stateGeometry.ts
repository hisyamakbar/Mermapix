// Pure helpers for stateDiagram-v2 (Phase 8.5), no `figma` usage so they are unit-testable in node.

export type StateRole = 'start' | 'end' | 'note' | 'parent' | 'node'

export interface StateGroupInfo {
  /** Mermaid state id (`Idle`, `root_start`, `Active_end`, `Idle----note`). */
  id: string
  role: StateRole
}

/** State groups are named `<svgId>-state-<id>-<n>`. */
export function stateInfoFromName(name: string | null | undefined): StateGroupInfo | null {
  if (!name || typeof name !== 'string' || name.includes('inlined-marker')) return null
  const m = /-state-(.+)-(\d+)$/.exec(name)
  if (!m) return null
  const id = m[1]
  if (id.endsWith('----note')) return { id, role: 'note' }
  if (id.endsWith('----parent')) return { id, role: 'parent' }
  if (/_start$/.test(id)) return { id, role: 'start' }
  if (/_end$/.test(id)) return { id, role: 'end' }
  return { id, role: 'node' }
}

export type PseudoKind = 'Choice' | 'Fork' | 'Join' | 'Fork/Join'

/**
 * Name of a label-less state shape: a diamond is a choice, a thin bar is a fork or join. Mermaid does
 * not keep the kind in the SVG, so fork vs join is read from the user's id when it says so.
 */
export function pseudoStateKind(kind: string, width: number, height: number, id: string): PseudoKind | null {
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (kind === 'Diamond') return 'Choice'
  if (short > 0 && long / short >= 3) {
    if (/join/i.test(id)) return 'Join'
    if (/fork/i.test(id)) return 'Fork'
    return 'Fork/Join'
  }
  return null
}

/** True when `inner` is a smaller box inside `outer` sharing its horizontal extent (a composite state's body panel). */
export function isCompositePair(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
  tol = 1,
): boolean {
  return (
    outer.height > inner.height &&
    inner.height > 10 &&
    Math.abs(outer.x - inner.x) <= tol &&
    Math.abs(outer.width - inner.width) <= tol &&
    inner.y >= outer.y - tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  )
}
