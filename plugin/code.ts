// Figma Plugin sandbox code for Mermapix
// Receives SVG from ui.html, inlines missing SVG markers (crow's foot, arrows),
// and creates native vector/text nodes on canvas with column-based Auto Layout.

declare const figma: any
declare const __html__: string

figma.showUI(__html__, {
  width: 500,
  height: 680,
  themeColors: true,
})

// Canonical Mermapix Mermaid Design Tokens (identical to src/themes/presets.ts)
const SYSTEM_THEME_PRESETS: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    primaryColor: '#f8fafc',
    primaryTextColor: '#09090b',
    primaryBorderColor: '#e4e4e7',
    lineColor: '#e4e4e7',
    secondaryColor: '#ffffff',
    tertiaryColor: '#ffffff',
    background: '#ffffff',
    attributeBackgroundColorOdd: '#ffffff',
    attributeBackgroundColorEven: '#fafafa',
  },
  dark: {
    darkMode: 'true',
    primaryColor: '#1e293b',
    primaryTextColor: '#f8fafc',
    primaryBorderColor: '#38bdf8',
    lineColor: '#38bdf8',
    secondaryColor: '#0f172a',
    tertiaryColor: '#1e293b',
    background: '#090d16',
    attributeBackgroundColorOdd: '#1e293b',
    attributeBackgroundColorEven: '#131b2e',
  },
}

function parseColorToFigma(colorStr?: any): { r: number; g: number; b: number } | null {
  if (!colorStr || typeof colorStr !== 'string') return null
  const str = colorStr.trim().toLowerCase()

  if (str.startsWith('#')) {
    let hex = str.slice(1)
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('')
    }
    if (hex.length === 6) {
      const num = parseInt(hex, 16)
      if (!isNaN(num)) {
        return {
          r: ((num >> 16) & 255) / 255,
          g: ((num >> 8) & 255) / 255,
          b: (num & 255) / 255,
        }
      }
    }
  }

  const rgbMatch = str.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/)
  if (rgbMatch) {
    const r = parseFloat(rgbMatch[1]) / 255
    const g = parseFloat(rgbMatch[2]) / 255
    const b = parseFloat(rgbMatch[3]) / 255
    return {
      r: Math.min(1, Math.max(0, r)),
      g: Math.min(1, Math.max(0, g)),
      b: Math.min(1, Math.max(0, b)),
    }
  }

  return null
}

/**
 * SVG Marker Inliner for Figma:
 * Figma's createNodeFromSvg completely ignores SVG <defs><marker> tags.
 * This preprocessor inlines marker elements directly as positioned & rotated
 * SVG <g> vector groups at path endpoints so Figma renders them natively 1:1.
 */
interface MarkerDef {
  id: string
  refX: number
  refY: number
  markerWidth: number
  markerHeight: number
  viewBox: [number, number, number, number] | null
  stroke: string | null
  fill: string | null
  content: string
}

interface PathEndpoint {
  point: { x: number; y: number }
  angle: number
}

interface PathGeometry {
  start: PathEndpoint | null
  end: PathEndpoint | null
}

function parsePathGeometry(d: string): PathGeometry | null {
  if (!d || typeof d !== 'string') return null

  const commandRegex = /([a-df-z])([^a-df-z]*)/gi
  const segments: Array<{ cmd: string; args: number[] }> = []
  let match: RegExpExecArray | null

  while ((match = commandRegex.exec(d)) !== null) {
    const cmd = match[1]
    const argsStr = match[2].trim()
    const args: number[] = []
    if (argsStr) {
      const numRegex = /[-+]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?/g
      let numMatch: RegExpExecArray | null
      while ((numMatch = numRegex.exec(argsStr)) !== null) {
        args.push(parseFloat(numMatch[0]))
      }
    }
    segments.push({ cmd, args })
  }

  if (segments.length === 0) return null

  let cx = 0
  let cy = 0
  let startPt: { x: number; y: number } | null = null
  let startTan: { x: number; y: number } | null = null
  let endTan: { x: number; y: number } | null = null

  for (let s = 0; s < segments.length; s++) {
    const { cmd, args } = segments[s]
    const isRel = cmd === cmd.toLowerCase()
    const upper = cmd.toUpperCase()

    if (upper === 'M') {
      if (args.length >= 2) {
        cx = isRel ? cx + args[0] : args[0]
        cy = isRel ? cy + args[1] : args[1]
        if (!startPt) {
          startPt = { x: cx, y: cy }
        }
        for (let i = 2; i < args.length - 1; i += 2) {
          const nx = isRel ? cx + args[i] : args[i]
          const ny = isRel ? cy + args[i + 1] : args[i + 1]
          if (!startTan) {
            startTan = { x: nx - cx, y: ny - cy }
          }
          endTan = { x: nx - cx, y: ny - cy }
          cx = nx
          cy = ny
        }
      }
    } else if (upper === 'L') {
      for (let i = 0; i < args.length - 1; i += 2) {
        const nx = isRel ? cx + args[i] : args[i]
        const ny = isRel ? cy + args[i + 1] : args[i + 1]
        if (!startTan) {
          startTan = { x: nx - cx, y: ny - cy }
        }
        endTan = { x: nx - cx, y: ny - cy }
        cx = nx
        cy = ny
      }
    } else if (upper === 'H') {
      for (let i = 0; i < args.length; i++) {
        const nx = isRel ? cx + args[i] : args[i]
        if (!startTan) {
          startTan = { x: nx - cx, y: 0 }
        }
        endTan = { x: nx - cx, y: 0 }
        cx = nx
      }
    } else if (upper === 'V') {
      for (let i = 0; i < args.length; i++) {
        const ny = isRel ? cy + args[i] : args[i]
        if (!startTan) {
          startTan = { x: 0, y: ny - cy }
        }
        endTan = { x: 0, y: ny - cy }
        cy = ny
      }
    } else if (upper === 'C') {
      for (let i = 0; i < args.length - 5; i += 6) {
        const c1x = isRel ? cx + args[i] : args[i]
        const c1y = isRel ? cy + args[i + 1] : args[i + 1]
        const c2x = isRel ? cx + args[i + 2] : args[i + 2]
        const c2y = isRel ? cy + args[i + 3] : args[i + 3]
        const nx = isRel ? cx + args[i + 4] : args[i + 4]
        const ny = isRel ? cy + args[i + 5] : args[i + 5]

        if (!startTan) {
          const dx = c1x - cx
          const dy = c1y - cy
          if (dx !== 0 || dy !== 0) {
            startTan = { x: dx, y: dy }
          } else {
            startTan = { x: nx - cx, y: ny - cy }
          }
        }

        const edx = nx - c2x
        const edy = ny - c2y
        if (edx !== 0 || edy !== 0) {
          endTan = { x: edx, y: edy }
        } else {
          endTan = { x: nx - cx, y: ny - cy }
        }

        cx = nx
        cy = ny
      }
    } else if (upper === 'Q') {
      for (let i = 0; i < args.length - 3; i += 4) {
        const qx = isRel ? cx + args[i] : args[i]
        const qy = isRel ? cy + args[i + 1] : args[i + 1]
        const nx = isRel ? cx + args[i + 2] : args[i + 2]
        const ny = isRel ? cy + args[i + 3] : args[i + 3]

        if (!startTan) {
          startTan = { x: qx - cx, y: qy - cy }
        }
        endTan = { x: nx - qx, y: ny - qy }
        cx = nx
        cy = ny
      }
    }
  }

  const endPt = { x: cx, y: cy }
  if (!startPt) return null

  const startAngle = startTan
    ? (Math.atan2(startTan.y, startTan.x) * 180) / Math.PI
    : 0

  const endAngle = endTan
    ? (Math.atan2(endTan.y, endTan.x) * 180) / Math.PI
    : 0

  return {
    start: { point: startPt, angle: startAngle },
    end: { point: endPt, angle: endAngle },
  }
}

function inlineSvgMarkers(svg: string): string {
  if (!svg || typeof svg !== 'string') return svg
  if (!svg.includes('<marker')) return svg

  // 1. Extract all marker definitions from <defs>
  const markers = new Map<string, MarkerDef>()
  const markerRegex = /<marker\s+([\s\S]*?)>([\s\S]*?)<\/marker>/gi
  let match: RegExpExecArray | null

  while ((match = markerRegex.exec(svg)) !== null) {
    const attrsStr = match[1]
    const content = match[2].trim()

    const idMatch = attrsStr.match(/id=["']([^"']+)["']/)
    if (!idMatch) continue
    const id = idMatch[1]

    const refXMatch = attrsStr.match(/refX=["']([^"']+)["']/)
    const refYMatch = attrsStr.match(/refY=["']([^"']+)["']/)
    const viewBoxMatch = attrsStr.match(/viewBox=["']([^"']+)["']/)
    const widthMatch = attrsStr.match(/markerWidth=["']([^"']+)["']/)
    const heightMatch = attrsStr.match(/markerHeight=["']([^"']+)["']/)
    const strokeMatch = attrsStr.match(/stroke=["']([^"']+)["']/)
    const fillMatch = attrsStr.match(/fill=["']([^"']+)["']/)

    let viewBox: [number, number, number, number] | null = null
    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(parseFloat)
      if (parts.length === 4 && !parts.some(isNaN)) {
        viewBox = [parts[0], parts[1], parts[2], parts[3]]
      }
    }

    markers.set(id, {
      id,
      refX: refXMatch ? parseFloat(refXMatch[1]) : 0,
      refY: refYMatch ? parseFloat(refYMatch[1]) : 0,
      markerWidth: widthMatch ? parseFloat(widthMatch[1]) : 0,
      markerHeight: heightMatch ? parseFloat(heightMatch[1]) : 0,
      viewBox,
      stroke: strokeMatch ? strokeMatch[1] : null,
      fill: fillMatch ? fillMatch[1] : null,
      content,
    })
  }

  if (markers.size === 0) return svg

  const isDarkTheme =
    svg.includes('#1e293b') ||
    svg.includes('#38bdf8') ||
    svg.includes('#090d16') ||
    svg.includes('rgb(30, 41, 59)') ||
    svg.includes('rgb(56, 189, 248)') ||
    svg.includes('data-theme="dark"')

  // Helper to extract path coordinates fallback from data-points (base64 JSON) or d attribute numbers
  function getPoints(pathElementStr: string): Array<{ x: number; y: number }> | null {
    const dataPointsMatch = pathElementStr.match(/data-points=["']([^"']+)["']/)
    if (dataPointsMatch) {
      try {
        let decoded = ''
        if (typeof atob === 'function') {
          decoded = atob(dataPointsMatch[1])
        } else if (typeof Buffer !== 'undefined') {
          decoded = Buffer.from(dataPointsMatch[1], 'base64').toString('utf-8')
        }
        if (decoded) {
          const pts = JSON.parse(decoded)
          if (Array.isArray(pts) && pts.length >= 2) {
            return pts.map((p) => ({ x: parseFloat(p.x), y: parseFloat(p.y) }))
          }
        }
      } catch {}
    }

    // Fallback: parse numbers from d attribute
    const dMatch = pathElementStr.match(/\bd=["']([^"']+)["']/)
    if (!dMatch) return null

    const nums = dMatch[1].match(/[-+]?[0-9]*\.?[0-9]+/g)
    if (!nums || nums.length < 4) return null

    const pts: Array<{ x: number; y: number }> = []
    for (let i = 0; i < nums.length - 1; i += 2) {
      pts.push({ x: parseFloat(nums[i]), y: parseFloat(nums[i + 1]) })
    }
    return pts.length >= 2 ? pts : null
  }

  function createInlinedMarker(
    markerId: string,
    pos: { x: number; y: number },
    angle: number,
    type: 'start' | 'end',
    elementStroke?: string | null,
  ): string {
    const marker = markers.get(markerId)
    if (!marker) return ''

    let scaleTransform = ''
    if (marker.viewBox && marker.markerWidth && marker.markerHeight) {
      const sx = marker.markerWidth / marker.viewBox[2]
      const sy = marker.markerHeight / marker.viewBox[3]
      scaleTransform = ` scale(${sx}, ${sy})`
    }

    const isSeqNum = marker.id.includes('sequencenumber')
    const isExtension = marker.id.includes('extension')
    const isComposition = marker.id.includes('composition')
    const isAggregation = marker.id.includes('aggregation')
    const isDependency = marker.id.includes('dependency')
    const isCross = marker.id.includes('cross')

    const isDark =
      isDarkTheme ||
      Boolean(
        elementStroke &&
          (elementStroke.includes('38bdf8') ||
            elementStroke.includes('56, 189, 248') ||
            elementStroke.includes('rgb(56, 189, 248)')),
      )
    const cardBg = isDark ? '#1e293b' : '#ffffff'
    const defaultStroke = isDark ? '#38bdf8' : '#1f2733'

    let markerContent = marker.content
    if (isSeqNum) {
      // Mermaid autonumber marker defines <circle cx="15" cy="15" r="6"/> inside a 60x40 marker.
      // Under SVG default markerUnits="strokeWidth" (2px stroke line), the badge renders at 24px diameter (r=12).
      // Scale radius to 12px so the badge circle comfortably encloses the sequence number glyph.
      markerContent = markerContent.replace(/\br=["'][0-9.]+["']/, 'r="12"')
    }

    let strokeAttr = marker.stroke ? ` stroke="${marker.stroke}"` : ''
    let fillAttr = marker.fill ? ` fill="${marker.fill}"` : ''

    if (!fillAttr) {
      if (isExtension || isAggregation) {
        fillAttr = ` fill="${cardBg}"`
      } else if (
        isSeqNum ||
        isComposition ||
        marker.id.includes('filled-head') ||
        marker.id.includes('arrowhead') ||
        marker.id.includes('point') ||
        marker.id.includes('head')
      ) {
        fillAttr = ` fill="${elementStroke || defaultStroke}"`
      }
    }
    if (!strokeAttr) {
      if (isSeqNum) {
        strokeAttr = ' stroke="none"'
      } else if (
        isExtension ||
        isComposition ||
        isAggregation ||
        isDependency ||
        isCross ||
        marker.id.includes('arrowhead') ||
        marker.id.includes('crosshead') ||
        marker.id.includes('point') ||
        marker.id.includes('head')
      ) {
        strokeAttr = ` stroke="${elementStroke || defaultStroke}"`
      }
    }

    const role = isSeqNum
      ? 'sequence-number-badge'
      : isExtension
        ? 'extension-arrow'
        : isComposition
          ? 'composition-diamond'
          : isAggregation
            ? 'aggregation-diamond'
            : isDependency
              ? 'dependency-arrow'
              : marker.id.includes('arrowhead') ||
                  marker.id.includes('point') ||
                  marker.id.includes('head')
                ? 'arrowhead'
                : 'marker'

    return `<g class="inlined-marker inlined-marker-${type} inlined-${role}" transform="translate(${pos.x}, ${pos.y}) rotate(${angle})${scaleTransform} translate(${-marker.refX}, ${-marker.refY})"${strokeAttr}${fillAttr}>${markerContent}</g>`
  }

  // 2. Scan for path elements with marker-start or marker-end
  const pathRegex = /<path\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/path>)/gi
  let transformedSvg = svg.replace(pathRegex, (fullMatch, attrs) => {
    const startMatch = attrs.match(/marker-start=["']url\(#?([^"')]+)\)["']/)
    const endMatch = attrs.match(/marker-end=["']url\(#?([^"')]+)\)["']/)

    if (!startMatch && !endMatch) return fullMatch

    const strokeMatch = attrs.match(/\bstroke=["']([^"']+)["']/)
    const elementStroke = strokeMatch ? strokeMatch[1] : null

    const dMatch = attrs.match(/\bd=["']([^"']+)["']/)
    const geometry = dMatch ? parsePathGeometry(dMatch[1]) : null

    let generatedMarkers = ''

    if (startMatch) {
      if (geometry?.start) {
        generatedMarkers += createInlinedMarker(
          startMatch[1],
          geometry.start.point,
          geometry.start.angle,
          'start',
          elementStroke,
        )
      } else {
        const points = getPoints(fullMatch)
        if (points && points.length >= 2) {
          const dx = points[1].x - points[0].x
          const dy = points[1].y - points[0].y
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI
          generatedMarkers += createInlinedMarker(
            startMatch[1],
            points[0],
            angle,
            'start',
            elementStroke,
          )
        }
      }
    }

    if (endMatch) {
      if (geometry?.end) {
        generatedMarkers += createInlinedMarker(
          endMatch[1],
          geometry.end.point,
          geometry.end.angle,
          'end',
          elementStroke,
        )
      } else {
        const points = getPoints(fullMatch)
        if (points && points.length >= 2) {
          const last = points[points.length - 1]
          const prev = points[points.length - 2]
          const dx = last.x - prev.x
          const dy = last.y - prev.y
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI
          generatedMarkers += createInlinedMarker(
            endMatch[1],
            last,
            angle,
            'end',
            elementStroke,
          )
        }
      }
    }

    return fullMatch + generatedMarkers
  })

  // 3. Scan for line elements with marker-start or marker-end (sequence diagram messages & autonumber)
  const lineRegex = /<line\s+([^>]*?)(\/?>)/gi
  transformedSvg = transformedSvg.replace(lineRegex, (fullMatch, attrs) => {
    const startMatch = attrs.match(/marker-start=["']url\(#?([^"')]+)\)["']/)
    const endMatch = attrs.match(/marker-end=["']url\(#?([^"')]+)\)["']/)

    if (!startMatch && !endMatch) return fullMatch

    const x1Match = attrs.match(/\bx1=["']([^"']+)["']/)
    const y1Match = attrs.match(/\by1=["']([^"']+)["']/)
    const x2Match = attrs.match(/\bx2=["']([^"']+)["']/)
    const y2Match = attrs.match(/\by2=["']([^"']+)["']/)

    if (!x1Match || !y1Match || !x2Match || !y2Match) return fullMatch

    const x1 = parseFloat(x1Match[1])
    const y1 = parseFloat(y1Match[1])
    const x2 = parseFloat(x2Match[1])
    const y2 = parseFloat(y2Match[1])

    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return fullMatch

    const strokeMatch = attrs.match(/\bstroke=["']([^"']+)["']/)
    const elementStroke = strokeMatch ? strokeMatch[1] : null

    const dx = x2 - x1
    const dy = y2 - y1
    const angle = dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI

    let generatedMarkers = ''

    if (startMatch) {
      generatedMarkers += createInlinedMarker(
        startMatch[1],
        { x: x1, y: y1 },
        angle,
        'start',
        elementStroke,
      )
    }

    if (endMatch) {
      generatedMarkers += createInlinedMarker(
        endMatch[1],
        { x: x2, y: y2 },
        angle,
        'end',
        elementStroke,
      )
    }

    return fullMatch + generatedMarkers
  })

  return transformedSvg
}

/**
 * Optimizes an imported SVG node tree:
 * 1. Purges ghost/empty layers (empty text nodes, empty groups, 0x0 vectors).
 * 2. Converts ERD table/entity groups into native Column-Based Auto Layout Frames
 *    (modeled after user reference table 13:1284 "Content"):
 *    - Main Table Card: Vertical Auto Layout, rounded corners (8px), border stroke (#eaecf0).
 *    - Header: Horizontal Auto Layout with table name and bottom border separator.
 *    - Content: Horizontal Auto Layout container holding vertical Column frames:
 *        • Column: Field Name (layoutGrow: 1, FILL width, bold #101828)
 *        • Column: Type (fixed content-aware width, muted #475467)
 *        • Column: Key (fixed width, pill badges with soft tints #eef2ff PK, #ecfdf5 FK, #fffbeb UK)
 *        • Column: Description (if comments exist, muted #667085)
 *      Every cell in every column has uniform height (40px) and bottom border (#eaecf0).
 * 3. Dissolves redundant nested wrapper groups so text and vector layers are directly accessible.
 * 4. Cleans layer names to reflect table names, field names, connectors, and crow's foot markers.
 */
function optimizeDiagramNodes(rootNode: any, themeVariables?: Record<string, any>): void {
  // Pass 1: Safe purge of empty text nodes and zero-size vectors
  function purgeJunkNodes(n: any): void {
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

  purgeJunkNodes(rootNode)

  // Pass 2: Identify entity table groups (strictly excluding relationship lines/labels)
  const entityContainers: any[] = []
  function findEntities(n: any): void {
    if (!n || n.removed) return
    const name = (n.name || '').toLowerCase()

    // Strictly skip relationship lines, labels, and markers
    if (
      name.includes('id_entity') ||
      name.includes('_entity') ||
      name.includes('edge') ||
      name.includes('relationshiplabel') ||
      name.includes('inlined-marker')
    ) {
      return
    }

    // Match entity table containers: Mermaid formats id/name as mermaid-svg-N-entity-<Name>-<Index>
    const isEntity =
      name.includes('-entity-') ||
      name.startsWith('entity-') ||
      name.includes('entitybox')

    if (isEntity) {
      entityContainers.push(n)
    } else if ('children' in n && !n.removed) {
      try {
        for (const child of [...n.children]) {
          if (child && !child.removed) findEntities(child)
        }
      } catch {}
    }
  }
  findEntities(rootNode)

  // Pass 3: Convert each entity box into a native Column-Based Auto Layout Frame
  for (const entity of entityContainers) {
    if (!entity || entity.removed) continue

    // Collect all valid text nodes inside entity
    const texts: any[] = []
    function scanEntityTexts(n: any) {
      if (!n || n.removed) return
      if (n.type === 'TEXT') {
        if ((n.characters || '').trim().length > 0) texts.push(n)
      } else if ('children' in n && !n.removed) {
        try {
          for (const child of [...n.children]) {
            if (child && !child.removed) scanEntityTexts(child)
          }
        } catch {}
      }
    }
    scanEntityTexts(entity)

    if (texts.length === 0) continue

    // Extract exact fills and border strokes from the original entity SVG vector nodes
    let extractedBgFills: any[] = []
    let extractedBorderStrokes: any[] = []
    let isDark = false

    function scanEntityStyles(n: any) {
      if (!n || n.removed) return
      if (n.type === 'VECTOR') {
        if (n.fills && n.fills.length > 0 && n.fills[0].visible !== false) {
          const c = n.fills[0].color
          if (c) {
            const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
            if (lum < 0.45) isDark = true
          }
          if (n.width > 30 && n.height > 20) {
            if (extractedBgFills.length === 0 || (n.width * n.height > 2000)) {
              extractedBgFills = n.fills
            }
          }
        }
        if (n.strokes && n.strokes.length > 0 && n.strokes[0].visible !== false) {
          if (extractedBorderStrokes.length === 0) {
            extractedBorderStrokes = n.strokes
          }
        }
      } else if ('children' in n && !n.removed) {
        try {
          for (const child of n.children) {
            if (child && !child.removed) scanEntityStyles(child)
          }
        } catch {}
      }
    }
    scanEntityStyles(entity)

    // Resolve active theme tokens from the Mermaid design system:
    const activeTokens = themeVariables || (isDark ? SYSTEM_THEME_PRESETS.dark : SYSTEM_THEME_PRESETS.light)
    const systemPrimaryBg = parseColorToFigma(activeTokens.primaryColor) || (isDark ? { r: 0.1176, g: 0.1608, b: 0.2314 } : { r: 1, g: 1, b: 1 })
    const systemBorder = parseColorToFigma(activeTokens.primaryBorderColor) || (isDark ? { r: 0.2196, g: 0.7412, b: 0.9725 } : { r: 0.8941, g: 0.8941, b: 0.9059 })

    // 100% 1:1 color fidelity: use live extracted SVG fills/strokes, fallback to Mermaid system tokens
    const cardBgFill = extractedBgFills.length > 0
      ? extractedBgFills
      : [{ type: 'SOLID', color: systemPrimaryBg }]

    const tableBorder = extractedBorderStrokes.length > 0
      ? extractedBorderStrokes
      : [{ type: 'SOLID', color: systemBorder }]

    const headerBgFill = cardBgFill

    // Cluster text nodes by Y position (12px tolerance) into rows
    texts.sort((a, b) => a.y - b.y)
    const rows: any[][] = []
    let currentRow: any[] = []
    let currentY: number | null = null

    for (const t of texts) {
      if (currentY === null || Math.abs(t.y - currentY) > 12) {
        if (currentRow.length > 0) rows.push(currentRow)
        currentRow = [t]
        currentY = t.y
      } else {
        currentRow.push(t)
      }
    }
    if (currentRow.length > 0) rows.push(currentRow)

    // Sort texts within each row by X coordinate (left to right)
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
    }

    const headerTexts = rows[0] || []
    const tableName = headerTexts.map((t: any) => t.characters.trim()).join(' ') || 'Entity'
    const columnRows = rows.slice(1)

    // Track every single text node to guarantee 100% zero-drop
    const adoptedTextIds = new Set<string>()

    // Parse each row into: typeText, nameText, badges[], commentTexts[]
    let maxTypeWidth = 0
    let maxNameWidth = 0
    let maxBadgeWidth = 0
    let maxCommentWidth = 0
    let hasType = false
    let hasBadges = false
    let hasComments = false

    interface ParsedRow {
      typeText: any | null
      nameText: any | null
      badges: any[]
      commentTexts: any[]
      typeName: string
      fieldName: string
      badgeNames: string[]
      commentStr: string
    }

    const parsedRows: ParsedRow[] = []

    for (const rowTexts of columnRows) {
      const badges: any[] = []
      const contentTexts: any[] = []

      for (const t of rowTexts) {
        const char = (t.characters || '').trim()
        if (/^(PK|FK|UK|PK,\s*FK|FK,\s*UK|PK\s*FK|NULL|NOT NULL)$/i.test(char)) {
          badges.push(t)
        } else {
          contentTexts.push(t)
        }
      }

      let typeText: any | null = null
      let nameText: any | null = null
      let commentTexts: any[] = []

      if (contentTexts.length === 1) {
        nameText = contentTexts[0]
      } else if (contentTexts.length === 2) {
        typeText = contentTexts[0]
        nameText = contentTexts[1]
      } else if (contentTexts.length >= 3) {
        typeText = contentTexts[0]
        nameText = contentTexts[1]
        commentTexts = contentTexts.slice(2)
      }

      if (typeText) {
        hasType = true
        maxTypeWidth = Math.max(maxTypeWidth, Math.ceil(typeText.width))
      }
      if (nameText) {
        maxNameWidth = Math.max(maxNameWidth, Math.ceil(nameText.width))
      }
      if (badges.length > 0) {
        hasBadges = true
        const rowBadgeWidth = badges.reduce((sum, b) => sum + Math.ceil(b.width) + 16, 0)
        maxBadgeWidth = Math.max(maxBadgeWidth, rowBadgeWidth)
      }
      if (commentTexts.length > 0) {
        hasComments = true
        const rowCommentWidth = commentTexts.reduce((sum, c) => sum + Math.ceil(c.width) + 12, 0)
        maxCommentWidth = Math.max(maxCommentWidth, rowCommentWidth)
      }

      parsedRows.push({
        typeText,
        nameText,
        badges,
        commentTexts,
        typeName: typeText ? typeText.characters.trim() : '',
        fieldName: nameText ? nameText.characters.trim() : '',
        badgeNames: badges.map((b: any) => b.characters.trim()),
        commentStr: commentTexts.map((c: any) => c.characters.trim()).join(' ')
      })
    }

    // 100% Geometric Precision:
    // Mermaid connector lines terminate at the entity's outer bounding box:
    // x = entity.x, y = entity.y, width = entity.width, height = entity.height.
    const origEntityWidth = entity.width || 200
    const origEntityHeight = entity.height || 120
    const origEntityX = entity.x
    const origEntityY = entity.y

    const tableWidth = origEntityWidth
    const tableX = origEntityX
    const tableY = origEntityY

    // Content-aware column widths constrained within tableWidth
    const maxTypeAllowed = Math.floor(tableWidth * 0.35)
    const maxBadgeAllowed = Math.floor(tableWidth * 0.25)
    const maxCommentAllowed = Math.floor(tableWidth * 0.35)

    const typeColWidth = hasType ? Math.max(36, Math.min(maxTypeWidth + 14, maxTypeAllowed)) : 0
    const badgeColWidth = hasBadges ? Math.max(28, Math.min(maxBadgeWidth + 12, maxBadgeAllowed)) : 0
    const commentColWidth = hasComments ? Math.max(48, Math.min(maxCommentWidth + 14, maxCommentAllowed)) : 0
    const nameColInitialWidth = Math.max(30, tableWidth - (typeColWidth + badgeColWidth + commentColWidth))

    // In Mermaid ERD, all rows (header + attribute rows) divide entity.height evenly:
    const totalRowCount = parsedRows.length > 0 ? parsedRows.length + 1 : 1
    const cellHeight = parsedRows.length > 0 ? origEntityHeight / totalRowCount : 0
    const headerHeight = origEntityHeight - cellHeight * parsedRows.length

    // 1. Create Table Card Frame (Vertical Auto Layout: FIXED width and FIXED height matching Mermaid 1:1)
    const tableCard = figma.createFrame()
    tableCard.name = tableName
    tableCard.x = tableX
    tableCard.y = tableY
    tableCard.layoutMode = 'VERTICAL'
    tableCard.primaryAxisSizingMode = 'FIXED' // FIXED height = origEntityHeight
    tableCard.counterAxisSizingMode = 'FIXED' // FIXED width = origEntityWidth
    tableCard.resize(tableWidth, origEntityHeight)
    tableCard.itemSpacing = 0
    tableCard.paddingTop = 0
    tableCard.paddingBottom = 0
    tableCard.paddingLeft = 0
    tableCard.paddingRight = 0
    tableCard.cornerRadius = 0 // Mermaid ERD tables use crisp rectangular borders
    tableCard.fills = cardBgFill
    tableCard.strokes = tableBorder
    tableCard.strokeWeight = 1
    tableCard.strokeAlign = 'INSIDE'
    tableCard.clipsContent = true

    // 2. Create Header Frame (Table Title) - centered 1:1 with Mermaid
    const headerFrame = figma.createFrame()
    headerFrame.name = `Header: ${tableName}`
    headerFrame.layoutMode = 'HORIZONTAL'
    headerFrame.layoutAlign = 'STRETCH' // FILL parent width
    headerFrame.primaryAxisSizingMode = 'FIXED'
    headerFrame.counterAxisSizingMode = 'FIXED'
    headerFrame.resize(tableWidth, headerHeight)
    headerFrame.paddingTop = 0
    headerFrame.paddingBottom = 0
    headerFrame.paddingLeft = 8
    headerFrame.paddingRight = 8
    headerFrame.primaryAxisAlignItems = 'CENTER' // Mermaid centers entity name
    headerFrame.counterAxisAlignItems = 'CENTER'
    headerFrame.itemSpacing = 8
    headerFrame.fills = headerBgFill
    if (tableBorder.length > 0) {
      headerFrame.strokes = tableBorder
      headerFrame.strokeBottomWeight = 1
      headerFrame.strokeTopWeight = 0
      headerFrame.strokeLeftWeight = 0
      headerFrame.strokeRightWeight = 0
      headerFrame.strokeAlign = 'INSIDE'
    } else {
      headerFrame.strokes = []
    }

    for (const ht of headerTexts) {
      ht.name = `Title: ${ht.characters.trim()}`
      try {
        ht.fontName = { family: 'Inter', style: 'Bold' }
        ht.fontSize = 13
      } catch {}
      try {
        ht.visible = true
      } catch {}
      // Keep ht.fills untouched so exact color from Mermaid SVG is preserved!
      headerFrame.appendChild(ht)
      adoptedTextIds.add(ht.id)
    }
    tableCard.appendChild(headerFrame)

    // 3. Create Content Frame (Horizontal Columns Container)
    const contentFrame = figma.createFrame()
    contentFrame.name = 'Content'
    contentFrame.layoutMode = 'HORIZONTAL'
    contentFrame.layoutAlign = 'STRETCH'
    contentFrame.primaryAxisSizingMode = 'FIXED'
    contentFrame.counterAxisSizingMode = 'FIXED'
    contentFrame.resize(tableWidth, cellHeight * parsedRows.length)
    contentFrame.itemSpacing = 0
    contentFrame.paddingTop = 0
    contentFrame.paddingBottom = 0
    contentFrame.paddingLeft = 0
    contentFrame.paddingRight = 0
    contentFrame.fills = []
    contentFrame.strokes = []

    // Helper: Create Column Frame
    function createColumn(name: string, isFillWidth: boolean, initialWidth: number, hasRightDivider: boolean): any {
      const col = figma.createFrame()
      col.name = `Column: ${name}`
      col.layoutMode = 'VERTICAL'
      col.layoutAlign = 'STRETCH'
      col.primaryAxisSizingMode = 'FIXED'
      col.counterAxisSizingMode = isFillWidth ? 'AUTO' : 'FIXED'
      col.resize(initialWidth, cellHeight * parsedRows.length)
      if (isFillWidth) {
        col.layoutGrow = 1 // FILL width
      } else {
        col.layoutGrow = 0
      }
      col.itemSpacing = 0
      col.paddingTop = 0
      col.paddingBottom = 0
      col.paddingLeft = 0
      col.paddingRight = 0
      col.fills = []
      if (hasRightDivider && tableBorder.length > 0) {
        col.strokes = tableBorder
        col.strokeRightWeight = 1
        col.strokeTopWeight = 0
        col.strokeBottomWeight = 0
        col.strokeLeftWeight = 0
        col.strokeAlign = 'INSIDE'
      } else {
        col.strokes = []
      }
      return col
    }

    // Helper: Create Base Table Cell
    function createCell(name: string, width: number, isLastRow: boolean, align: 'MIN' | 'CENTER'): any {
      const cell = figma.createFrame()
      cell.name = name ? `Cell: ${name}` : 'Cell'
      cell.layoutMode = 'HORIZONTAL'
      cell.layoutAlign = 'STRETCH'
      cell.primaryAxisSizingMode = 'FIXED'
      cell.counterAxisSizingMode = 'FIXED'
      cell.resize(width, cellHeight)
      cell.paddingLeft = 8
      cell.paddingRight = 8
      cell.paddingTop = 0
      cell.paddingBottom = 0
      cell.primaryAxisAlignItems = align
      cell.counterAxisAlignItems = 'CENTER'
      cell.itemSpacing = 4
      cell.fills = []
      if (!isLastRow && tableBorder.length > 0) {
        cell.strokes = tableBorder
        cell.strokeBottomWeight = 1
        cell.strokeTopWeight = 0
        cell.strokeLeftWeight = 0
        cell.strokeRightWeight = 0
        cell.strokeAlign = 'INSIDE'
      } else {
        cell.strokes = []
      }
      return cell
    }

    // Define columns in 1:1 Mermaid ERD order: Type | Field Name | Key | Comment
    const columnsToRender: Array<{
      type: 'TYPE' | 'NAME' | 'KEY' | 'COMMENT'
      name: string
      width: number
      isFill: boolean
      align: 'MIN' | 'CENTER'
    }> = []

    if (hasType) {
      columnsToRender.push({ type: 'TYPE', name: 'Type', width: typeColWidth, isFill: false, align: 'MIN' })
    }
    columnsToRender.push({ type: 'NAME', name: 'Field Name', width: nameColInitialWidth, isFill: true, align: 'MIN' })
    if (hasBadges) {
      columnsToRender.push({ type: 'KEY', name: 'Key', width: badgeColWidth, isFill: false, align: 'CENTER' })
    }
    if (hasComments) {
      columnsToRender.push({ type: 'COMMENT', name: 'Comment', width: commentColWidth, isFill: false, align: 'MIN' })
    }

    for (let cIdx = 0; cIdx < columnsToRender.length; cIdx++) {
      const colDef = columnsToRender[cIdx]
      const hasRightDivider = cIdx < columnsToRender.length - 1
      const col = createColumn(colDef.name, colDef.isFill, colDef.width, hasRightDivider)

      for (let i = 0; i < parsedRows.length; i++) {
        const row = parsedRows[i]
        const isLast = i === parsedRows.length - 1

        if (colDef.type === 'TYPE') {
          const cell = createCell(row.typeName, colDef.width, isLast, 'MIN')
          if (row.typeText) {
            row.typeText.name = row.typeName
            try {
              row.typeText.fontName = { family: 'Inter', style: 'Regular' }
              row.typeText.fontSize = 12
            } catch {}
            try {
              row.typeText.visible = true
            } catch {}
            // Keep row.typeText.fills untouched!
            cell.appendChild(row.typeText)
            adoptedTextIds.add(row.typeText.id)
          }
          col.appendChild(cell)
        } else if (colDef.type === 'NAME') {
          const cell = createCell(row.fieldName, colDef.width, isLast, 'MIN')
          if (row.nameText) {
            row.nameText.name = row.fieldName
            try {
              row.nameText.fontName = { family: 'Inter', style: 'Regular' }
              row.nameText.fontSize = 12
            } catch {}
            try {
              row.nameText.visible = true
            } catch {}
            // Keep row.nameText.fills untouched!
            cell.appendChild(row.nameText)
            adoptedTextIds.add(row.nameText.id)
          }
          col.appendChild(cell)
        } else if (colDef.type === 'KEY') {
          const cell = createCell('Key', colDef.width, isLast, 'CENTER')
          if (row.badges.length > 0) {
            for (const badgeText of row.badges) {
              badgeText.name = badgeText.characters.trim()
              try {
                badgeText.fontName = { family: 'Inter', style: 'Bold' }
                badgeText.fontSize = 12
              } catch {}
              try {
                badgeText.visible = true
              } catch {}
              // No pill badge frame! Keep badgeText.fills untouched!
              cell.appendChild(badgeText)
              adoptedTextIds.add(badgeText.id)
            }
          }
          col.appendChild(cell)
        } else if (colDef.type === 'COMMENT') {
          const cell = createCell('Comment', colDef.width, isLast, 'MIN')
          if (row.commentTexts.length > 0) {
            for (const ct of row.commentTexts) {
              ct.name = ct.characters.trim()
              try {
                ct.fontName = { family: 'Inter', style: 'Regular' }
                ct.fontSize = 12
              } catch {}
              try {
                ct.visible = true
              } catch {}
              // Keep ct.fills untouched!
              cell.appendChild(ct)
              adoptedTextIds.add(ct.id)
            }
          }
          col.appendChild(cell)
        }
      }

      contentFrame.appendChild(col)
    }

    tableCard.appendChild(contentFrame)

    // Zero-drop guarantee: preserve any unadopted text in a fallback row
    const unadoptedTexts = texts.filter((t: any) => !adoptedTextIds.has(t.id) && !t.removed)
    if (unadoptedTexts.length > 0) {
      const fallbackRow = figma.createFrame()
      fallbackRow.name = 'Row: Additional Details'
      fallbackRow.layoutMode = 'HORIZONTAL'
      fallbackRow.layoutAlign = 'STRETCH'
      fallbackRow.primaryAxisSizingMode = 'FIXED'
      fallbackRow.counterAxisSizingMode = 'AUTO'
      fallbackRow.resize(tableWidth, 34)
      fallbackRow.paddingLeft = 14
      fallbackRow.paddingRight = 14
      fallbackRow.paddingTop = 8
      fallbackRow.paddingBottom = 8
      fallbackRow.itemSpacing = 8
      fallbackRow.fills = cardBgFill

      for (const ut of unadoptedTexts) {
        ut.name = `Extra: ${ut.characters.trim()}`
        fallbackRow.appendChild(ut)
        adoptedTextIds.add(ut.id)
      }
      tableCard.appendChild(fallbackRow)
    }

    const parent = entity.parent
    if (parent && !entity.removed) {
      parent.appendChild(tableCard)
      try {
        entity.remove()
      } catch {}
    }
  }

  // Pass 4: Dissolve redundant single-child wrapper groups (preserving named nodes & inlined markers)
  function dissolveRedundantWrappers(parent: any): void {
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
          name.includes('marker')

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

  // Run dissolution passes to flatten deeply nested wrapper hierarchies while preserving layer order
  for (let pass = 0; pass < 5; pass++) {
    dissolveRedundantWrappers(rootNode)
    purgeJunkNodes(rootNode)
  }

  // Pass 4b: Ensure sequence number text layers are never occluded by badge vector circles
  function elevateSequenceNumbers(parent: any): void {
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
  elevateSequenceNumbers(rootNode)

  // If root frame has only 1 group child, unwrap it into the root frame directly
  if (rootNode.type === 'FRAME' && rootNode.children && rootNode.children.length === 1 && rootNode.children[0].type === 'GROUP') {
    const singleGroup = rootNode.children[0]
    for (const c of [...singleGroup.children]) {
      rootNode.appendChild(c)
    }
    try { singleGroup.remove() } catch {}
  }

  // Pass 5: Final sweep to clean remaining layer names and label connectors & markers
  function finalClean(n: any): void {
    if (!n || n.removed) return
    const name = (n.name || '').toLowerCase()

    if (name.includes('inlined-marker')) {
      if (name.includes('sequence-number') || name.includes('sequencenumber')) {
        n.name = 'Sequence Number Badge'
      } else if (name.includes('extension')) {
        n.name = 'Inheritance Arrow'
      } else if (name.includes('composition')) {
        n.name = 'Composition Diamond'
      } else if (name.includes('aggregation')) {
        n.name = 'Aggregation Diamond'
      } else if (name.includes('dependency')) {
        n.name = 'Dependency Arrow'
      } else if (name.includes('arrowhead') || name.includes('head')) {
        n.name = 'Arrowhead'
      } else if (name.includes('start')) {
        n.name = "Crow's Foot (Start)"
      } else if (name.includes('end')) {
        n.name = "Crow's Foot (End)"
      } else {
        n.name = 'Marker'
      }
    } else if (n.type === 'TEXT') {
      const preview = (n.characters || '').trim().replace(/\s+/g, ' ')
      if (!n.name || n.name === 'Text' || n.name === 'Group') {
        n.name = preview.length > 28 ? preview.slice(0, 28) + '...' : preview
      }
    } else if (n.type === 'VECTOR') {
      if (!n.name || n.name === 'Vector') {
        const parentName = (n.parent && n.parent.name ? n.parent.name : '').toLowerCase()
        if (parentName.includes('flowchart-') || parentName.includes('node')) {
          n.name = 'Shape'
        } else if (parentName.includes('edge') || parentName.includes('arrow') || parentName.includes('path')) {
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
  finalClean(rootNode)
}

figma.ui.onmessage = async (msg: {
  type: string
  svg?: string
  name?: string
  width?: number
  height?: number
  theme?: string
  themeVariables?: Record<string, any>
}) => {
  if (msg.type === 'create-svg' && msg.svg) {
    try {
      // Preload standard fonts asynchronously so text metrics and property operations never fail
      try {
        await Promise.all([
          figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
          figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
          figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
          figma.loadFontAsync({ family: 'Arial', style: 'Regular' }),
          figma.loadFontAsync({ family: 'Arial', style: 'Bold' }),
        ])
      } catch (fontErr) {
        // Non-blocking fallback if custom style unavailable
      }

      // Inline SVG markers (crow's feet, arrowheads) before Figma imports the SVG
      const processedSvg = inlineSvgMarkers(msg.svg)
      const node = figma.createNodeFromSvg(processedSvg)
      node.name = msg.name || 'Mermapix Diagram'

      function ensureAllLayersVisible(n: any): void {
        if (!n || n.removed) return
        try {
          n.visible = true
        } catch {}
        if ('children' in n && Array.isArray(n.children)) {
          for (const child of n.children) {
            ensureAllLayersVisible(child)
          }
        }
      }
      ensureAllLayersVisible(node)

      figma.currentPage.appendChild(node)

      // Optimize layers: convert ERD tables to column-based Auto Layout & dissolve redundant groups
      optimizeDiagramNodes(node, msg.themeVariables)
      ensureAllLayersVisible(node)

      // Center in current user viewport
      const center = figma.viewport.center
      node.x = Math.round(center.x - node.width / 2)
      node.y = Math.round(center.y - node.height / 2)

      figma.currentPage.selection = [node]
      figma.viewport.scrollAndZoomIntoView([node])
      figma.notify('✓ Mermapix diagram added to canvas with clean Auto Layout layers!')
    } catch (err) {
      figma.notify(
        'Failed to create diagram: ' + (err instanceof Error ? err.message : String(err)),
        { error: true },
      )
    }
  } else if (msg.type === 'resize' && msg.width && msg.height) {
    figma.ui.resize(Math.round(msg.width), Math.round(msg.height))
  } else if (msg.type === 'close') {
    figma.closePlugin()
  }
}
