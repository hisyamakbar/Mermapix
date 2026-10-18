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

  sourceElements.forEach((element, index) => {
    const target = exportedElements[index]
    const computed = window.getComputedStyle(element)
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

  // Ensure minimum breathing room on the left edge so actor text (e.g. stick-figure Customer)
  // or leftmost elements are never clipped by the frame boundary.
  if (minX > -24) {
    const padLeft = 24 - minX
    minX = -24
    width += padLeft + 12
  }
  if (minY > -16) {
    const padTop = 16 - minY
    minY = -16
    height += padTop + 12
  }

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
