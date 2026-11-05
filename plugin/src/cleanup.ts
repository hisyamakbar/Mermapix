import { markerLayerName, isShapeLayerName, isConnectorLayerName } from './naming.ts'

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
        name === 'connectors'

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
      if (/^[0-9]{1,3}$/.test(text) && child.width <= 24 && child.height <= 24) {
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
