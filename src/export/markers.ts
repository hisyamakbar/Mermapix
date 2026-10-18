/**
 * SVG Marker Inliner for Mermapix
 *
 * Figma's native SVG importer (`createNodeFromSvg` and clipboard paste) completely
 * ignores SVG `<marker>` tags inside `<defs>`. This results in relationship connector
 * lines losing their arrowheads, generalization triangles, and crow's foot indicators.
 *
 * This preprocessor inlines marker elements directly as positioned & rotated
 * SVG `<g>` vector groups at path endpoints so Figma renders them natively 1:1.
 */

export interface MarkerDef {
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

export interface PathEndpoint {
  point: { x: number; y: number }
  angle: number
}

export interface PathGeometry {
  start: PathEndpoint | null
  end: PathEndpoint | null
}

export function parsePathGeometry(d: string): PathGeometry | null {
  if (!d || typeof d !== 'string') return null

  // Match commands and their numeric parameters
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

export function inlineSvgMarkers(svg: string): string {
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
