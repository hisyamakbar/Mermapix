// Edge labels (flowchart "yes"/"no", ERD relationship names, ...) -> Auto Layout pill frames.
//
// Mermaid draws an edge label as a background rect (the diagram background color, masking the
// connector line behind the text) plus a text, siblings in one group. Figma imports them as a
// filled VECTOR + TEXT. This converts such a pair into one FRAME with that fill, FIXED size =
// background bounds and the text centered. To avoid grabbing unrelated vectors the text must be
// centered on the vector and the vector must be an unstroked rect-like shape.

import { classifyShape } from './shapeGeometry.ts'
import { convertVectorWithLabel, labelOf } from './shapes.ts'

const SKIP_NAME_RE = /inlined-marker|entity-|flowchart-|L_[A-Za-z0-9]/

const hasVisible = (paints: any): boolean =>
  Array.isArray(paints) && paints.length > 0 && paints[0].visible !== false && paints[0].opacity !== 0

/** True when `text` is centered on `vector` (tolerant to Arial vs Inter width differences). */
export function isCenteredLabel(text: any, vector: any): boolean {
  const dx = text.x + text.width / 2 - (vector.x + vector.width / 2)
  const dy = text.y + text.height / 2 - (vector.y + vector.height / 2)
  const tolX = Math.max(3, vector.width * 0.12)
  const tolY = Math.max(3, vector.height * 0.2)
  const fits = text.width <= vector.width + 6 && text.height <= vector.height + 6
  return Math.abs(dx) <= tolX && Math.abs(dy) <= tolY && fits
}

export function convertEdgeLabels(rootNode: any): number {
  let converted = 0
  const visit = (n: any): void => {
    if (!n || n.removed || !('children' in n)) return
    for (const c of [...n.children]) {
      if (c && !c.removed && c.type === 'GROUP' && !SKIP_NAME_RE.test(c.name || '')) visit(c)
    }
    if (n.type !== 'GROUP') return
    const kids = [...n.children].filter((c: any) => c && !c.removed)
    const vectors = kids.filter((c: any) => c.type === 'VECTOR' && c.width >= 1 && c.height >= 1)
    const texts = kids.filter((c: any) => c.type === 'TEXT' && (c.characters || '').trim().length > 0)
    if (vectors.length !== 1 || texts.length !== 1) return
    const v = vectors[0]
    const t = texts[0]
    if (!hasVisible(v.fills) || hasVisible(v.strokes) && Number(v.strokeWeight) > 0) return
    if (v.height > 80 || !isCenteredLabel(t, v)) return
    const data = Array.isArray(v.vectorPaths) && v.vectorPaths[0] ? v.vectorPaths[0].data : ''
    const cls = classifyShape(data, v.width, v.height)
    if (!cls.rectLike || cls.kind === 'Circle') return
    convertVectorWithLabel(v, t, `Label: ${labelOf([t])}`, cls, 'Edge Label')
    converted++
  }
  visit(rootNode)
  return converted
}
