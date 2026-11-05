// Pure SVG string pre-processing run before `figma.createNodeFromSvg` (no `figma` usage).

import { inlineSvgMarkers } from './markers.ts'
import { buildMarkerLayerId, markerKindFromId } from './naming.ts'

/**
 * The web app's buildExportSvg already inlines markers; inlining again would stack
 * every crow's foot / arrowhead / badge twice. Only inline when none are present.
 */
export function ensureMarkersInlined(svg: string): string {
  if (!svg || typeof svg !== 'string') return svg
  if (svg.includes('inlined-marker')) return svg
  return inlineSvgMarkers(svg)
}

const SCAN_RE = /<(?:path|line)\b[^>]*>|<g\s+class="inlined-marker\s+inlined-marker-(start|end)\s+inlined-[^"]*"/g

function markerIdFromAttr(tag: string, attr: 'marker-start' | 'marker-end'): string | null {
  const m = tag.match(new RegExp(`${attr}=["']url\\(#?([^"')]+)\\)["']`))
  return m ? m[1] : null
}

/**
 * Figma's SVG importer ignores `class` but uses `id` as the layer name. Give each inlined
 * marker `<g>` a unique id encoding its kind (derived from the `marker-start`/`marker-end`
 * url of the path/line it was inlined after) and position.
 */
export function nameInlinedMarkers(svg: string): string {
  if (!svg || typeof svg !== 'string' || !svg.includes('inlined-marker')) return svg

  let out = ''
  let cursor = 0
  let counter = 0
  let lastStartId: string | null = null
  let lastEndId: string | null = null
  const re = new RegExp(SCAN_RE.source, 'g')
  let m: RegExpExecArray | null

  while ((m = re.exec(svg)) !== null) {
    const position = m[1] as 'start' | 'end' | undefined
    if (!position) {
      // Regular path/line: remember which markers it references.
      lastStartId = markerIdFromAttr(m[0], 'marker-start')
      lastEndId = markerIdFromAttr(m[0], 'marker-end')
      continue
    }

    // Inlined marker group: tag it, then skip over its (possibly nested) contents.
    const markerId = position === 'start' ? lastStartId : lastEndId
    counter += 1
    const id = buildMarkerLayerId(counter, markerKindFromId(markerId), position)
    const openLen = '<g'.length
    out += svg.slice(cursor, m.index + openLen) + ` id="${id}"`
    cursor = m.index + openLen

    const tagEnd = svg.indexOf('>', m.index)
    const depthRe = /<g\b|<\/g>/g
    depthRe.lastIndex = tagEnd + 1
    let depth = 1
    let d: RegExpExecArray | null
    while (depth > 0 && (d = depthRe.exec(svg)) !== null) {
      depth += d[0] === '</g>' ? -1 : 1
    }
    re.lastIndex = depth === 0 ? depthRe.lastIndex : tagEnd + 1
  }

  return out + svg.slice(cursor)
}

/** Full pre-processing pipeline for the SVG received from the UI. */
export function prepareSvgForFigma(svg: string): string {
  return nameInlinedMarkers(ensureMarkersInlined(svg))
}
