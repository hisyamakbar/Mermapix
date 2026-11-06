import { markerLayerName, isShapeLayerName, isConnectorLayerName } from './naming.ts'
import { isSequenceGroupName } from './sequenceGeometry.ts'

// Generic layer cleanup passes shared by all diagram types.
// Each function mutates the Figma node tree rooted at `rootNode` in place.

/** Pass 1: safe purge of empty text nodes, empty groups and zero-size vectors. */
export function purgeJunkNodes(n: any): void {
  if (!n || n.removed) return
  if ('children' in n) {
    try {
      const children = [...n.children]
      for (const child of children) {
        if (child && !child.removed) purgeJunkNodes(child)
      }
    } catch {}
  }
  if (n.removed) return
  if (n.type === 'TEXT') {
    const txt = (n.characters || '').trim()
    if (txt.length === 0) {
      try {
        n.remove()
      } catch {}
    }
  } else if (n.type === 'VECTOR') {
    if (Math.round(n.width) === 0 && Math.round(n.height) === 0) {
      try {
        n.remove()
      } catch {}
    }
  } else if (n.type === 'GROUP') {
    try {
      if ('children' in n && n.children.length === 0) {
        n.remove()
      }
    } catch {}
  }
}

/** Pass 4: dissolve redundant single-child wrapper groups (preserving named nodes & inlined markers). */
export function dissolveRedundantWrappers(parent: any): void {
  if (!parent || parent.removed || !('children' in parent)) return

  // Process children bottom-up
  for (const child of [...parent.children]) {
    if (child && !child.removed && 'children' in child) {
      dissolveRedundantWrappers(child)
    }
  }

  // Inspect children of current parent
  for (const child of [...parent.children]) {
    if (!child || child.removed) continue
    if (child.type === 'GROUP' && 'children' in child) {
      if (child.children.length === 0) {
        try { child.remove() } catch {}
        continue
      }

      const name = (child.name || '').toLowerCase()
      const isGeneric =
        name === 'group' ||
        name === '' ||
        name === 'label' ||
        name.startsWith('root-') ||
        name === 'edgepath' ||
        name === 'edgelabel'
      const isSingleChild = child.children.length === 1
      const isProtectedNode =
        name.includes('flowchart-') ||
        name.includes('entity-') ||
        name.includes('actor') ||
        name.includes('subgraph') ||
        name.includes('cluster') ||
        name.includes('inlined-marker') ||
        name.includes('marker') ||
        // Phase 8.3 structure: edge groups may hold a single line and must stay a group
        name.startsWith('edge: ') ||
        // Phase 9.2: railroad rule groups
        name.startsWith('rule: ') ||
        name === 'connectors' ||
        // Phase 8.4 structure: sequence strata and message groups
        isSequenceGroupName(name)

      // Dissolve if it's a generic wrapper OR a single-child group that isn't a protected node
      if ((isGeneric || isSingleChild) && !isProtectedNode) {
        const childIndex = parent.children.indexOf(child)
        const grandChildren = [...child.children]
        for (let i = 0; i < grandChildren.length; i++) {
          const gc = grandChildren[i]
          if (childIndex !== -1 && typeof parent.insertChild === 'function') {
            parent.insertChild(childIndex + i, gc)
          } else {
            parent.appendChild(gc)
          }
        }
        try { child.remove() } catch {}
      }
    }
  }
}

/** Run dissolution passes to flatten deeply nested wrapper hierarchies while preserving layer order. */
export function flattenWrappers(rootNode: any): void {
  for (let pass = 0; pass < 5; pass++) {
    dissolveRedundantWrappers(rootNode)
    purgeJunkNodes(rootNode)
  }
}

/** Phase 8.4: a number that already sits inside its `Badge <n>` frame is in the right place. */
function isInsideBadge(parent: any): boolean {
  if (!parent || parent.type !== 'FRAME' || typeof parent.getPluginData !== 'function') return false
  try {
    return parent.getPluginData('mermapix:kind') === 'Sequence Badge'
  } catch {
    return false
  }
}

/** Pass 4b: ensure sequence number text layers are never occluded by badge vector circles. */
export function elevateSequenceNumbers(parent: any): void {
  if (!parent || parent.removed || !('children' in parent)) return
  for (const child of [...parent.children]) {
    if (child && !child.removed && 'children' in child) {
      elevateSequenceNumbers(child)
    }
  }
  for (const child of [...parent.children]) {
    if (child && !child.removed && child.type === 'TEXT') {
      const text = (child.characters || '').trim()
      if (/^[0-9]{1,3}$/.test(text) && child.width <= 24 && child.height <= 24 && !isInsideBadge(parent)) {
        try {
          parent.appendChild(child)
        } catch {}
      }
    }
  }
}

/** If root frame has only 1 group child, unwrap it into the root frame directly. */
export function unwrapRootGroup(rootNode: any): void {
  if (rootNode.type === 'FRAME' && rootNode.children && rootNode.children.length === 1 && rootNode.children[0].type === 'GROUP') {
    const singleGroup = rootNode.children[0]
    for (const c of [...singleGroup.children]) {
      rootNode.appendChild(c)
    }
    try { singleGroup.remove() } catch {}
  }
}

/** Unnamed vectors/groups inside a named marker group become "Marker Path" (no leftover "Vector"). */
function nameMarkerParts(marker: any): void {
  if (!marker || !('children' in marker)) return
  const base = 'Marker Path'
  const visit = (n: any): void => {
    for (const c of [...(n.children || [])]) {
      if (!c || c.removed) continue
      if (c.type === 'VECTOR' && (!c.name || c.name === 'Vector')) c.name = base
      else if (c.type === 'GROUP' && (!c.name || c.name === 'Group')) {
        c.name = base
        visit(c)
      }
    }
  }
  visit(marker)
}

/** Pass 5: final sweep to clean remaining layer names and label connectors & markers. */
export function finalClean(n: any): void {
  if (!n || n.removed) return
  const name = (n.name || '').toLowerCase()

  if (name.includes('inlined-marker')) {
    n.name = markerLayerName(n.name)
    nameMarkerParts(n)
  } else if (n.type === 'TEXT') {
    const preview = (n.characters || '').trim().replace(/\s+/g, ' ')
    if (!n.name || n.name === 'Text' || n.name === 'Group') {
      n.name = preview.length > 28 ? preview.slice(0, 28) + '...' : preview
    }
  } else if (n.type === 'VECTOR') {
    if (!n.name || n.name === 'Vector') {
      const parentName = (n.parent && n.parent.name ? n.parent.name : '').toLowerCase()
      if (isShapeLayerName(parentName)) {
        n.name = 'Shape'
      } else if (isConnectorLayerName(parentName)) {
        n.name = 'Connector'
      }
    }
  } else if ('children' in n && !n.removed) {
    try {
      for (const child of [...n.children]) {
        if (child && !child.removed) finalClean(child)
      }
    } catch {}
  }
}

/** Export margins (px) kept around content when the root frame has to grow: left, top, right, bottom. */
const ROOT_MARGIN = { left: 24, top: 16, right: 12, bottom: 12 }
/** Overflow below this is rounding noise, not a crop. */
const ROOT_OVERFLOW_TOLERANCE = 0.5

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Bounds of everything the root frame is supposed to show, in root coordinates. GROUPs are coordinate
 * transparent (Figma keeps their children in the parent frame's space); a nested FRAME contributes its
 * own bounds and is entered only when it does not clip (a clipping frame hides its overflow by design) and
 * does not use Auto Layout (Figma positions those children itself, their stored x/y mean nothing).
 */
function collectContentBoxes(parent: any, ox: number, oy: number, out: Box[]): void {
  if (!parent || !('children' in parent) || !Array.isArray(parent.children)) return
  for (const child of parent.children) {
    if (!child || child.removed || child.visible === false) continue
    const x = ox + (child.x || 0)
    const y = oy + (child.y || 0)
    const w = child.width || 0
    const h = child.height || 0
    if (child.type === 'GROUP') {
      collectContentBoxes(child, ox, oy, out)
      continue
    }
    if (w > 0 || h > 0) out.push({ x0: x, y0: y, x1: x + w, y1: y + h })
    const autoLayout = child.layoutMode && child.layoutMode !== 'NONE'
    if (child.type === 'FRAME' && child.clipsContent === false && !autoLayout) collectContentBoxes(child, x, y, out)
  }
}

/**
 * Safety net (Phase 10.1): the root frame must never crop its content. The export pads Mermaid's viewBox,
 * but font substitution (Inter text is wider than the Arial the importer measures with), a converter or a
 * future Mermaid change can still push a layer past the frame. When that happens the frame grows (and is
 * shifted, with every child moved the other way so nothing moves on screen) until the content fits with
 * at least the export margins on the sides that grew. A layer lying entirely outside the frame is Mermaid
 * clipping on purpose (gantt's today marker far outside the chart range) and is ignored. Returns whether
 * the frame changed.
 */
export function growRootToFitContent(rootNode: any): boolean {
  if (!rootNode || rootNode.type !== 'FRAME' || rootNode.removed) return false
  const width = rootNode.width
  const height = rootNode.height
  if (!(width > 0) || !(height > 0)) return false
  const boxes: Box[] = []
  collectContentBoxes(rootNode, 0, 0, boxes)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    // wholly outside: clipped on purpose
    if (b.x1 <= 0 || b.x0 >= width || b.y1 <= 0 || b.y0 >= height) continue
    x0 = Math.min(x0, b.x0)
    y0 = Math.min(y0, b.y0)
    x1 = Math.max(x1, b.x1)
    y1 = Math.max(y1, b.y1)
  }
  if (x0 === Infinity) return false

  const left = -x0 > ROOT_OVERFLOW_TOLERANCE ? Math.ceil(-x0 + ROOT_MARGIN.left) : 0
  const top = -y0 > ROOT_OVERFLOW_TOLERANCE ? Math.ceil(-y0 + ROOT_MARGIN.top) : 0
  const right = x1 - width > ROOT_OVERFLOW_TOLERANCE ? Math.ceil(x1 - width + ROOT_MARGIN.right) : 0
  const bottom = y1 - height > ROOT_OVERFLOW_TOLERANCE ? Math.ceil(y1 - height + ROOT_MARGIN.bottom) : 0
  if (!left && !top && !right && !bottom) return false

  try {
    if (left || top) {
      // Move the frame by the opposite amount so the diagram stays where it was.
      for (const child of [...rootNode.children]) {
        child.x = (child.x || 0) + left
        child.y = (child.y || 0) + top
      }
      rootNode.x = (rootNode.x || 0) - left
      rootNode.y = (rootNode.y || 0) - top
    }
    rootNode.resize(width + left + right, height + top + bottom)
  } catch {
    return false
  }
  return true
}
