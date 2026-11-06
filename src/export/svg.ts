import { inlineSvgMarkers } from './markers.ts'

export const SVG_PRESENTATION_PROPERTIES = [
  'color',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'visibility',
  'display',
  'paint-order',
] as const

// Elements Mermaid hides itself with `display: none` (for example the treemap root
// section value). `display` is not inherited, so a descendant's own `none` is
// Mermaid's choice and not the host UI's: those elements are dropped from the export
// instead of becoming visible in Figma. Only painted graphics and containers qualify;
// <defs> content, <style>, <title> and friends have a UA `display: none` and stay.
const HIDDEN_DROPPABLE_TAGS = new Set([
  'g', 'rect', 'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline',
  'text', 'tspan', 'image', 'use', 'a', 'switch', 'foreignObject',
])
const NON_RENDERED_CONTAINERS = 'defs, clipPath, mask, marker, pattern, symbol, linearGradient, radialGradient'

const SVG_NS = 'http://www.w3.org/2000/svg'

function parseCssColor(value: string): { rgb: string; alpha: number } | null {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(value)
  if (!match) return null
  const raw = match[4]
  const alpha = raw === undefined ? 1 : raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)
  return { rgb: `rgb(${match[1]}, ${match[2]}, ${match[3]})`, alpha }
}

let baselineProbe: CanvasRenderingContext2D | null | undefined
function fontAscent(computed: CSSStyleDeclaration, fallback: number): number {
  if (baselineProbe === undefined) {
    baselineProbe = document.createElement('canvas').getContext('2d')
  }
  if (!baselineProbe) return fallback
  baselineProbe.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`
  const ascent = baselineProbe.measureText('Hg').fontBoundingBoxAscent
  return Number.isFinite(ascent) && ascent > 0 ? ascent : fallback
}

// Mermaid's eventmodeling renders card labels as <foreignObject><div><span><b>..
// even with htmlLabels:false, and Figma ignores foreignObject. Rebuild each label as a
// <text> with flat, absolute <tspan> rows (the same shape the rest of the export uses)
// from where the browser actually drew every character, in the foreignObject's own
// user space so the surrounding transforms apply as before.
function convertForeignObjectLabels(sourceRoot: SVGSVGElement, exportedRoot: SVGSVGElement) {
  const sources = Array.from(sourceRoot.querySelectorAll('foreignObject'))
  const targets = Array.from(exportedRoot.querySelectorAll('foreignObject'))
  sources.forEach((source, index) => {
    const target = targets[index]
    // <switch> (journey) already carries a <text> fallback: do not duplicate it.
    if (!target || !target.parentNode || source.closest('switch')) return
    if (window.getComputedStyle(source).display === 'none') return
    const matrix = source.getScreenCTM()
    if (!matrix) return
    const inverse = matrix.inverse()

    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent ?? ''
      const owner = node.parentElement
      if (!owner || !value.trim()) continue
      const computed = window.getComputedStyle(owner)
      if (computed.visibility === 'hidden') continue

      // Group characters into visual lines by their drawn vertical position.
      const lines: { chars: { ch: string; rect: DOMRect }[] }[] = []
      const range = document.createRange()
      for (let i = 0; i < value.length; i++) {
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const rect = range.getClientRects()[0]
        if (!rect || (rect.width === 0 && rect.height === 0)) continue // collapsed whitespace
        const line = lines[lines.length - 1]
        const first = line?.chars[0].rect
        if (line && first && Math.abs(rect.top - first.top) <= Math.max(1, first.height * 0.5)) {
          line.chars.push({ ch: value[i], rect })
        } else {
          lines.push({ chars: [{ ch: value[i], rect }] })
        }
      }

      const fontSize = parseFloat(computed.fontSize) || 13
      const color = parseCssColor(computed.color)
      const fill = color?.rgb ?? 'rgb(0, 0, 0)'
      const rows: { text: string; x: number; y: number }[] = []
      lines.forEach((line) => {
        const start = line.chars.findIndex((c) => c.ch.trim())
        if (start < 0) return
        const chars = line.chars.slice(start)
        const text = chars.map((c) => c.ch).join('').replace(/\s+/g, ' ').trimEnd()
        if (!text) return
        const local = new DOMPoint(chars[0].rect.left, chars[0].rect.top).matrixTransform(inverse)
        const ascent = fontAscent(computed, fontSize * 0.8)
        rows.push({ text, x: local.x, y: local.y + ascent })
      })
      if (!rows.length) continue

      const label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('text-anchor', 'start')
      label.setAttribute('fill', fill)
      if (color && color.alpha < 1) label.setAttribute('fill-opacity', `${color.alpha}`)
      label.setAttribute('stroke', 'none')
      label.setAttribute('visibility', 'visible')
      label.setAttribute('font-family', 'Arial, sans-serif')
      label.setAttribute('font-size', `${fontSize}`)
      label.setAttribute('font-weight', computed.fontWeight || '400')
      if (computed.fontStyle && computed.fontStyle !== 'normal') {
        label.setAttribute('font-style', computed.fontStyle)
      }
      rows.forEach((row) => {
        const tspan = document.createElementNS(SVG_NS, 'tspan')
        tspan.setAttribute('x', `${row.x}`)
        tspan.setAttribute('y', `${row.y}`)
        tspan.setAttribute('fill', fill)
        tspan.setAttribute('stroke', 'none')
        tspan.textContent = row.text
        label.appendChild(tspan)
      })
      target.parentNode.insertBefore(label, target)
    }
  })
}

/**
 * Pads one axis of Mermaid's viewBox (`min`, `size`) with `pad` (24 left / 16 top) before and 12 after.
 * A positive origin is padded around its own origin so the far side widens too (the old code only moved
 * the box). An origin in (-pad, 0] keeps the old convention (box anchored at -pad, widened by
 * `pad - min + 12`; identical output for 0), and one already beyond -pad is left as Mermaid drew it.
 */
export function padViewBoxAxis(min: number, size: number, pad: number): { min: number; size: number } {
  if (min > 0) return { min: min - pad, size: size + pad + 12 }
  if (min > -pad) return { min: -pad, size: size + (pad - min) + 12 }
  return { min, size }
}

// Some shapes are only transformed by CSS, e.g. gantt milestones get their diamond
// from `.milestone { transform: rotate(45deg) scale(0.8) }` plus a `transform-origin`
// attribute. The export drops <style> and Figma ignores `transform-origin`, so the
// milestone landed as an upright square. Bake the element's effective local
// transform (CSS transform + origin, read back from the live CTMs) into a plain
// `transform` matrix. Elements that already carry a `transform` attribute are left
// alone: their computed transform is that attribute, which Figma already reads.
function bakeCssTransform(
  element: SVGElement,
  target: SVGElement,
  computed: CSSStyleDeclaration,
  sourceRoot: SVGSVGElement,
) {
  if (element === sourceRoot || element.hasAttribute('transform')) return
  if (!computed.transform || computed.transform === 'none') return
  if (!(element instanceof SVGGraphicsElement)) return
  const parent = element.parentElement
  if (!(parent instanceof SVGGraphicsElement)) return
  const own = element.getCTM()
  const base = parent.getCTM()
  if (!own || !base) return
  const local = base.inverse().multiply(own)
  const isIdentity =
    Math.abs(local.a - 1) < 1e-6 && Math.abs(local.b) < 1e-6 && Math.abs(local.c) < 1e-6 &&
    Math.abs(local.d - 1) < 1e-6 && Math.abs(local.e) < 1e-6 && Math.abs(local.f) < 1e-6
  if (isIdentity) return
  const r = (v: number) => Math.round(v * 1e6) / 1e6
  target.setAttribute(
    'transform',
    `matrix(${r(local.a)} ${r(local.b)} ${r(local.c)} ${r(local.d)} ${r(local.e)} ${r(local.f)})`,
  )
  target.removeAttribute('transform-origin')
}

// The rendered text color of the HTML label that a <switch>'s <text> fallback stands in for.
function switchSiblingTextColor(text: SVGTextElement): string | null {
  const parent = text.parentElement
  if (!parent || parent.tagName.toLowerCase() !== 'switch') return null
  const html = Array.from(parent.children).find(
    (c) => c.tagName.toLowerCase() === 'foreignobject' && c.textContent?.trim(),
  )
  if (!html) return null
  // The deepest element that holds the label text carries the color it was drawn with.
  let holder: Element = html
  for (;;) {
    const next = Array.from(holder.children).find((c) => c.textContent?.trim())
    if (!next) break
    holder = next
  }
  const color = window.getComputedStyle(holder).color
  return color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color) ? color : null
}

export function buildExportSvg(
  diagramContainer: HTMLElement | null,
): { serialized: string; width: number; height: number } | null {
  const sourceRoot = diagramContainer?.querySelector('svg') as SVGSVGElement | null
  if (!sourceRoot) return null

  // Figma's SVG importer does not reliably resolve Mermaid's internal CSS.
  // Capture the browser-resolved style and write it directly onto each SVG element.
  const exportedRoot = sourceRoot.cloneNode(true) as SVGSVGElement
  const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll<SVGElement>('*'))]
  const exportedElements = [
    exportedRoot,
    ...Array.from(exportedRoot.querySelectorAll<SVGElement>('*')),
  ]

  const hiddenByDiagram: SVGElement[] = []
  sourceElements.forEach((element, index) => {
    const target = exportedElements[index]
    const computed = window.getComputedStyle(element)
    if (
      element !== sourceRoot &&
      computed.display === 'none' &&
      HIDDEN_DROPPABLE_TAGS.has(element.tagName) &&
      !element.closest(NON_RENDERED_CONTAINERS)
    ) {
      hiddenByDiagram.push(target)
    }
    SVG_PRESENTATION_PROPERTIES.forEach((property) => {
      const value = computed.getPropertyValue(property)
      if (value) {
        // Diagram elements exported to Figma must ALWAYS be visible, never hidden
        // by the host UI editor's tab switching or off-screen states.
        if (property === 'visibility') {
          target.setAttribute('visibility', 'visible')
          return
        }
        if (property === 'opacity' && (parseFloat(value) === 0 || element === sourceRoot)) {
          target.setAttribute('opacity', '1')
          return
        }
        if (property === 'display' && value === 'none') {
          return
        }
        target.setAttribute(property, value)
      }
    })

    bakeCssTransform(element, target, computed, sourceRoot)

    if (element instanceof SVGTextElement && target instanceof SVGTextElement) {
      // Mermaid lays out labels with nested <tspan>s using em-relative y/dy
      // offsets. Figma's importer mishandles both (it falls back to the
      // <text> element's own y, dropping every label to the top of its box).
      // Instead of replaying Mermaid's math, measure where each character is
      // actually drawn in the live DOM and rebuild the label as flat tspans
      // with absolute, pixel coordinates that Figma renders faithfully.
      const fontSize = parseFloat(computed.fontSize) || 13
      const rows: { text: string; x: number; y: number }[] = []
      const rowEls = element.querySelectorAll(':scope > tspan')
      let charIndex = 0

      // Figma ignores SVG dominant-baseline (hanging, middle, central) and always
      // interprets text y as an alphabetic baseline.
      // We calculate the exact vertical baseline offset so text renders at the identical visual position in Figma.
      const domBaseline = (
        element.getAttribute('dominant-baseline') ||
        computed.dominantBaseline ||
        ''
      ).toLowerCase()

      let baselineShift = 0
      if (
        domBaseline === 'hanging' ||
        domBaseline === 'text-before-edge' ||
        domBaseline === 'top'
      ) {
        // Hanging baseline sits at the top of uppercase characters; alphabetic is ~0.78 * fontSize below.
        baselineShift = fontSize * 0.78
      } else if (domBaseline === 'middle' || domBaseline === 'central') {
        // Middle baseline is vertically centered (~0.35 * fontSize above alphabetic baseline).
        baselineShift = fontSize * 0.35
      } else if (domBaseline === 'text-after-edge' || domBaseline === 'bottom') {
        baselineShift = -fontSize * 0.2
      }

      const textAnchor = (
        element.getAttribute('text-anchor') ||
        computed.textAnchor ||
        'start'
      ).toLowerCase()

      const addRow = (text: string, rowEl?: Element) => {
        if (!text) return
        try {
          const point = element.getStartPositionOfChar(charIndex)
          if (point.x === 0 && point.y === 0) {
            let fallbackX = parseFloat(rowEl?.getAttribute('x') || element.getAttribute('x') || '0')
            let fallbackY = parseFloat(rowEl?.getAttribute('y') || element.getAttribute('y') || '0')
            if (textAnchor === 'middle') {
              const estimatedWidth = text.length * fontSize * 0.55
              fallbackX -= estimatedWidth / 2
            } else if (textAnchor === 'end') {
              const estimatedWidth = text.length * fontSize * 0.55
              fallbackX -= estimatedWidth
            }
            rows.push({ text, x: fallbackX, y: fallbackY + baselineShift })
          } else {
            rows.push({ text, x: point.x, y: point.y + baselineShift })
          }
        } catch {
          let fallbackX = parseFloat(rowEl?.getAttribute('x') || element.getAttribute('x') || '0')
          let fallbackY = parseFloat(rowEl?.getAttribute('y') || element.getAttribute('y') || '0')
          if (textAnchor === 'middle') {
            const estimatedWidth = text.length * fontSize * 0.55
            fallbackX -= estimatedWidth / 2
          } else if (textAnchor === 'end') {
            const estimatedWidth = text.length * fontSize * 0.55
            fallbackX -= estimatedWidth
          }
          rows.push({ text, x: fallbackX, y: fallbackY + baselineShift })
        }
        charIndex += text.length
      }
      if (rowEls.length) rowEls.forEach((row) => addRow(row.textContent ?? '', row))
      else addRow(element.textContent ?? '')

      while (target.firstChild) target.removeChild(target.firstChild)
      target.removeAttribute('y')
      target.removeAttribute('x')
      target.removeAttribute('dominant-baseline')
      target.removeAttribute('alignment-baseline')
      // Resolve true text fill:
      // In Mermaid, text colors are frequently defined on child tspans (e.g. `text.actor > tspan`,
      // `.noteText > tspan`, `.labelText > tspan`, `.loopText > tspan`), while the parent <text>
      // element inadvertently inherits the container's background fill and border stroke.
      const firstTspan = element.querySelector('tspan')
      const tspanComputed = firstTspan ? window.getComputedStyle(firstTspan) : null
      const isSequenceNumber = element.classList.contains('sequenceNumber')

      let textFill = '#1f2733'
      if (tspanComputed && tspanComputed.fill && tspanComputed.fill !== 'none' && tspanComputed.fill !== 'transparent') {
        textFill = tspanComputed.fill
      } else if (computed.fill && computed.fill !== 'none' && computed.fill !== 'transparent') {
        textFill = computed.fill
      } else if (computed.color && computed.color !== 'none') {
        textFill = computed.color
      }

      // Journey wraps each label in <switch>: the browser shows the <foreignObject> HTML label,
      // and the <text> fallback is what the export keeps. Mermaid's section rule
      // (`.section-type-N { fill: … }`) also hits that fallback, so the section titles came out
      // in the section's own fill color (invisible, 1:1). Use the color the HTML label was
      // actually drawn with.
      const switchHtmlColor = switchSiblingTextColor(element)
      if (switchHtmlColor) textFill = switchHtmlColor

      target.setAttribute('text-anchor', 'start')
      target.setAttribute('fill', textFill)
      // Text glyphs in Figma must render solid without border strokes
      target.setAttribute('stroke', 'none')
      target.removeAttribute('stroke-width')
      target.removeAttribute('stroke-opacity')
      target.removeAttribute('stroke-dasharray')

      target.setAttribute('font-family', 'Arial, sans-serif')
      target.setAttribute('font-size', `${fontSize}`)
      target.setAttribute('font-weight', isSequenceNumber ? '700' : (computed.fontWeight || '400'))
      rows.forEach((row) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
        tspan.setAttribute('x', `${row.x}`)
        tspan.setAttribute('y', `${row.y}`)
        tspan.setAttribute('fill', textFill)
        tspan.setAttribute('stroke', 'none')
        tspan.textContent = row.text
        target.appendChild(tspan)
      })
    }
    target.removeAttribute('class')
    target.removeAttribute('style')
    target.removeAttribute('dominant-baseline')
    target.removeAttribute('alignment-baseline')
  })

  // Must run before anything is removed: it pairs source and exported foreignObjects by index.
  convertForeignObjectLabels(sourceRoot, exportedRoot)
  hiddenByDiagram.forEach((element) => element.remove())
  exportedRoot.querySelectorAll('style').forEach((style) => style.remove())
  exportedRoot.querySelectorAll('foreignObject').forEach((element) => element.remove())
  exportedRoot.querySelectorAll('g').forEach((g) => {
    if (g.children.length === 0 && !g.textContent?.trim()) g.remove()
  })

  const viewBox = exportedRoot.getAttribute('viewBox')
  if (!viewBox) return null
  const [minXStr, minYStr, widthStr, heightStr] = viewBox.trim().split(/[ ,]+/)
  let minX = parseFloat(minXStr) || 0
  let minY = parseFloat(minYStr) || 0
  let width = parseFloat(widthStr)
  let height = parseFloat(heightStr)

  // Margins around Mermaid's own viewBox: at least 24px left, 16px top, 12px right and
  // bottom (actor text such as the stick-figure Customer must never touch the frame
  // edge), and never a smaller box. The old code only handled an origin at or below 0
  // (it moved the box to -24/-16 and widened it by `24 - origin + 12`); with a positive
  // origin (treemap 2,27; kanban 90,-310; timeline 100,-57; mindmap 5,5) the box moved
  // out but did not widen, which cropped the right/bottom. A positive origin is now
  // padded around its own origin. An origin of 0 or below keeps the old result exactly
  // (`-24 -16 (w+36) (h+28)` for 0), as does a box already starting beyond the margin.
  const paddedX = padViewBoxAxis(minX, width, 24)
  const paddedY = padViewBoxAxis(minY, height, 16)
  minX = paddedX.min
  width = paddedX.size
  minY = paddedY.min
  height = paddedY.size

  exportedRoot.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  exportedRoot.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  exportedRoot.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`)
  exportedRoot.setAttribute('width', `${width}`)
  exportedRoot.setAttribute('height', `${height}`)
  exportedRoot.setAttribute('role', 'img')
  exportedRoot.setAttribute('aria-labelledby', 'mermapix-title mermapix-desc')

  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
  title.setAttribute('id', 'mermapix-title')
  title.textContent = 'Mermapix diagram'
  const description = document.createElementNS('http://www.w3.org/2000/svg', 'desc')
  description.setAttribute('id', 'mermapix-desc')
  description.textContent = 'Exported from Mermapix (Mermaid to editable Figma)'
  exportedRoot.prepend(description)
  exportedRoot.prepend(title)

  const rawSerialized = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(exportedRoot)}`
  const serialized = inlineSvgMarkers(rawSerialized)
  return { serialized, width, height }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function exportSvg(diagramContainer: HTMLElement | null) {
  const built = buildExportSvg(diagramContainer)
  if (!built) return
  downloadBlob(
    new Blob([built.serialized], { type: 'image/svg+xml;charset=utf-8' }),
    'mermapix-diagram.svg',
  )
}

export async function copyToFigma(diagramContainer: HTMLElement | null): Promise<boolean> {
  const built = buildExportSvg(diagramContainer)
  if (!built) return false
  try {
    await navigator.clipboard.writeText(built.serialized)
    return true
  } catch {
    // Clipboard blocked: fall back to downloading the SVG file.
    exportSvg(diagramContainer)
    return false
  }
}

export async function exportPng(
  diagramContainer: HTMLElement | null,
  backgroundColor = '#ffffff',
): Promise<void> {
  const built = buildExportSvg(diagramContainer)
  if (!built) return
  const scale = 2
  const url = URL.createObjectURL(
    new Blob([built.serialized], { type: 'image/svg+xml;charset=utf-8' }),
  )
  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Failed to rasterise SVG'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(built.width * scale))
    canvas.height = Math.max(1, Math.round(built.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.drawImage(image, 0, 0, built.width, built.height)
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, 'mermapix-diagram.png')
    }, 'image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
