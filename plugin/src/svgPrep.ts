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

const CLIP_PATH_RE = /<clipPath\b[^>]*>[\s\S]*?<\/clipPath>/g
const SIMPLE_CLIP_SHAPE_RE = /^\s*<(rect|circle|ellipse|polygon|path)\b[^>]*?(?:\/>|>\s*<\/\1>)\s*$/
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Figma's SVG importer does not turn `<clipPath>` into a mask: an inline clipPath (Mermaid's treemap puts
 * one in every section and leaf to clip its labels) lands as a VISIBLE shape painted with the fill it
 * inherits, covering the real shapes and their labels. Drop every clipPath that only clips text (its content
 * is a single simple shape and every `clip-path="url(#id)"` reference is on a `<text>`/`<tspan>`), together
 * with those references. Clips on shapes, multi-shape clips and unreferenced-but-complex ones are left alone.
 */
export function stripLabelClipPaths(svg: string): string {
  if (!svg || typeof svg !== 'string' || !svg.includes('<clipPath')) return svg
  const dropIds = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(CLIP_PATH_RE.source, 'g')
  while ((m = re.exec(svg)) !== null) {
    const open = m[0].match(/^<clipPath\b[^>]*>/)
    const idMatch = open && open[0].match(/\bid=["']([^"']+)["']/)
    if (!idMatch) continue
    const id = idMatch[1]
    const inner = m[0].slice(open![0].length, m[0].length - '</clipPath>'.length)
    if (!SIMPLE_CLIP_SHAPE_RE.test(inner)) continue
    const idRe = escapeRe(id)
    const refTags = svg.match(new RegExp(`<[a-zA-Z][^<>]*?\\sclip-path=["']url\\(#?${idRe}\\)["'][^<>]*>`, 'g')) || []
    const allRefs = svg.match(new RegExp(`url\\(#?${idRe}\\)`, 'g')) || []
    const onlyText = refTags.every((tag) => /^<(?:text|tspan)\b/.test(tag))
    // Every mention of the id must be one of the attributes we are about to remove (e.g. no style="clip-path:...").
    if (onlyText && refTags.length === allRefs.length) dropIds.add(id)
  }
  if (dropIds.size === 0) return svg
  let out = svg.replace(new RegExp(CLIP_PATH_RE.source, 'g'), (block) => {
    const idMatch = block.match(/^<clipPath\b[^>]*?\bid=["']([^"']+)["']/)
    return idMatch && dropIds.has(idMatch[1]) ? '' : block
  })
  out = out.replace(/<(?:text|tspan)\b[^<>]*>/g, (tag) =>
    tag.replace(/\sclip-path=["']url\(#?([^"')]+)\)["']/, (attr, id) => (dropIds.has(id) ? '' : attr)),
  )
  return out
}

/** Full pre-processing pipeline for the SVG received from the UI. */
export function prepareSvgForFigma(svg: string): string {
  return nameInlinedMarkers(ensureMarkersInlined(stripLabelClipPaths(svg)))
}
