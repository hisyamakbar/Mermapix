// Pure-JS SVG -> mock Figma node tree importer that imitates figma.createNodeFromSvg for the SVGs
// Mermapix posts (Mermaid output after buildExportSvg + marker inlining).
//
// Ground truth (observed in real Figma, see plans/mermapix-plan.md Phase 8 evidence):
//  - every <g>            -> GROUP named by its `id` (or "Group")
//  - every shape element  -> VECTOR (rect/path/polygon/circle/line), never RECTANGLE/ELLIPSE
//  - every <text>         -> ONE TEXT node (Arial, textAutoResize WIDTH_AND_HEIGHT, LEFT aligned)
//  - root                 -> FRAME whose fills hold a white paint (canvas still showed through)
//  - <defs>/<marker>/<title>/<style>... are ignored
// Coordinates: x/y of every node are relative to the root frame (GROUP children are relative to
// their nearest FRAME ancestor, which is the root frame for the whole imported tree).
// VECTOR bounds are the geometry bounds (stroke not included) and vectorPaths hold path data
// translated so the bounds start at 0,0 (like Figma).
import { MockNode } from './figma-mock.mjs'
import { arialWidth, lineHeight } from './text-metrics.mjs'

// ---------------------------------------------------------------- XML

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[e] ?? m
  })

export function parseXml(src) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1]
    if (m[2]) {
      stack.pop()
    } else if (m[3]) {
      const attrs = {}
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3])
      const el = { tag: m[3], attrs, children: [], text: '' }
      top.children.push(el)
      if (!m[5]) stack.push(el)
    } else if (m[6] !== undefined) {
      top.text += decode(m[6])
      top.children.push({ tag: '#text', text: decode(m[6]), attrs: {}, children: [] })
    } else if (m[1] !== undefined) {
      top.text += m[1]
    }
  }
  return root.children.find((c) => c.tag === 'svg')
}

// ---------------------------------------------------------------- transforms

const IDENT = [1, 0, 0, 1, 0, 0]
const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
]
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export function parseTransform(str) {
  let m = IDENT
  if (!str) return m
  for (const t of str.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = t[2].split(/[\s,]+/).filter(Boolean).map(Number)
    let o = IDENT
    if (t[1] === 'translate') o = [1, 0, 0, 1, n[0] || 0, n[1] || 0]
    else if (t[1] === 'scale') o = [n[0], 0, 0, n[1] ?? n[0], 0, 0]
    else if (t[1] === 'rotate') {
      const a = ((n[0] || 0) * Math.PI) / 180
      const r = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]
      o = n.length >= 3 ? mul(mul([1, 0, 0, 1, n[1], n[2]], r), [1, 0, 0, 1, -n[1], -n[2]]) : r
    } else if (t[1] === 'matrix') o = n
    m = mul(m, o)
  }
  return m
}

// ---------------------------------------------------------------- colors

const NAMED = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0] }
export function parseColor(str) {
  if (!str) return null
  const s = str.trim().toLowerCase()
  if (s === 'none' || s === 'transparent' || s === 'currentcolor') return null
  let rgb = null
  let alpha = 1
  let m
  if ((m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/))) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
    rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  } else if ((m = s.match(/^rgba?\(([^)]+)\)/))) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat)
    rgb = p.slice(0, 3)
    if (p.length > 3) alpha = p[3]
  } else if (NAMED[s]) rgb = NAMED[s]
  if (!rgb) return null
  return { color: { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 }, alpha }
}

// ---------------------------------------------------------------- path geometry

function arcToBeziers(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [['L', x2, y2]]
  const phi = (phiDeg * Math.PI) / 180
  const cos = Math.cos(phi), sin = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy
  rx = Math.abs(rx); ry = Math.abs(ry)
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let k = Math.sqrt(Math.max(0, num / den))
  if (fa === fs) k = -k
  const cxp = (k * rx * y1p) / ry, cyp = (-k * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!fs && dth > 0) dth -= 2 * Math.PI
  if (fs && dth < 0) dth += 2 * Math.PI
  const n = Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9)
  const step = dth / n
  const out = []
  const t = (4 / 3) * Math.tan(step / 4)
  let a = th1
  for (let i = 0; i < n; i++) {
    const c1 = Math.cos(a), s1 = Math.sin(a), c2 = Math.cos(a + step), s2 = Math.sin(a + step)
    const pt = (px, py) => [cos * rx * px - sin * ry * py + cx, sin * rx * px + cos * ry * py + cy]
    const p1 = pt(c1 - t * s1, s1 + t * c1)
    const p2 = pt(c2 + t * s2, s2 - t * c2)
    const p3 = pt(c2, s2)
    out.push(['C', ...p1, ...p2, ...p3])
    a += step
  }
  return out
}

/** SVG path `d` -> absolute commands: ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Q',..] ['Z'] */
export function parsePathD(d) {
  const toks = [...d.matchAll(/([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi)].map((m) => (m[1] ? m[1] : parseFloat(m[2])))
  const out = []
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = null, lastC = null, lastQ = null
  const num = () => toks[i++]
  while (i < toks.length) {
    if (typeof toks[i] === 'string') cmd = toks[i++]
    else if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const ox = rel ? cx : 0, oy = rel ? cy : 0
    let nextC = null, nextQ = null
    if (C === 'Z') { out.push(['Z']); cx = sx; cy = sy }
    else if (C === 'M') { cx = ox + num(); cy = oy + num(); sx = cx; sy = cy; out.push(['M', cx, cy]) }
    else if (C === 'L') { cx = ox + num(); cy = oy + num(); out.push(['L', cx, cy]) }
    else if (C === 'H') { cx = ox + num(); out.push(['L', cx, cy]) }
    else if (C === 'V') { cy = oy + num(); out.push(['L', cx, cy]) }
    else if (C === 'C') {
      const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]
      out.push(['C', ...a]); nextC = [a[2], a[3]]; cx = a[4]; cy = a[5]
    } else if (C === 'S') {
      const r = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy]
      const a = [ox + num(), oy + num(), ox + num(), oy + num()]
      out.push(['C', r[0], r[1], ...a]); nextC = [a[0], a[1]]; cx = a[2]; cy = a[3]
    } else if (C === 'Q') {
      const a = [ox + num(), oy + num(), ox + num(), oy + num()]
      out.push(['Q', ...a]); nextQ = [a[0], a[1]]; cx = a[2]; cy = a[3]
    } else if (C === 'T') {
      const r = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy]
      const a = [ox + num(), oy + num()]
      out.push(['Q', r[0], r[1], ...a]); nextQ = r; cx = a[0]; cy = a[1]
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), fa = num(), fs = num()
      const x = ox + num(), y = oy + num()
      out.push(...arcToBeziers(cx, cy, rx, ry, rot, fa, fs, x, y)); cx = x; cy = y
    } else break
    lastC = nextC; lastQ = nextQ
  }
  return out
}

const fmt = (n) => String(Math.round(n * 1e4) / 1e4 + 0)

function transformCommands(cmds, m) {
  return cmds.map((c) => {
    const o = [c[0]]
    for (let i = 1; i < c.length; i += 2) o.push(...apply(m, c[i], c[i + 1]))
    return o
  })
}

function boundsOf(cmds) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  let px = 0, py = 0
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') { add(c[1], c[2]); px = c[1]; py = c[2] }
    else if (c[0] === 'C') {
      for (let s = 0; s <= 24; s++) {
        const t = s / 24, u = 1 - t
        add(u ** 3 * px + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t ** 3 * c[5], u ** 3 * py + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t ** 3 * c[6])
      }
      px = c[5]; py = c[6]
    } else if (c[0] === 'Q') {
      for (let s = 0; s <= 24; s++) {
        const t = s / 24, u = 1 - t
        add(u * u * px + 2 * u * t * c[1] + t * t * c[3], u * u * py + 2 * u * t * c[2] + t * t * c[4])
      }
      px = c[3]; py = c[4]
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function commandsToData(cmds, ox, oy) {
  return cmds
    .map((c) => {
      if (c[0] === 'Z') return 'Z'
      const p = [c[0]]
      for (let i = 1; i < c.length; i += 2) p.push(fmt(c[i] - ox), fmt(c[i + 1] - oy))
      return p.join(' ')
    })
    .join(' ')
}

// ---------------------------------------------------------------- importer

const SKIP_TAGS = new Set(['defs', 'marker', 'title', 'desc', 'style', 'filter', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'pattern', 'symbol', 'metadata', 'foreignobject'])
const INHERITED = ['fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor']

function styleAttrs(el) {
  const a = { ...el.attrs }
  if (a.style) for (const decl of a.style.split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) a[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
  }
  return a
}

const num = (s, d = 0) => { const v = parseFloat(s); return Number.isFinite(v) ? v : d }

function paints(style) {
  const fill = parseColor(style.fill)
  const stroke = parseColor(style.stroke)
  const op = num(style.opacity, 1)
  const sw = num(style['stroke-width'], 1)
  return {
    fills: fill ? [{ type: 'SOLID', color: fill.color, opacity: fill.alpha * num(style['fill-opacity'], 1) * op, visible: true }] : [],
    strokes: stroke && sw > 0 ? [{ type: 'SOLID', color: stroke.color, opacity: stroke.alpha * num(style['stroke-opacity'], 1) * op, visible: true }] : [],
    strokeWeight: stroke && sw > 0 ? sw : 0,
  }
}

function dashOf(style) {
  const raw = (style['stroke-dasharray'] || '').trim()
  if (!raw || raw === 'none') return []
  const p = raw.split(/[\s,]+/).map(parseFloat).filter(Number.isFinite)
  return p.some((v) => v > 0) ? p : []
}

export function importSvg(env, svgText) {
  const svg = parseXml(svgText)
  if (!svg) throw new Error('mock importer: no <svg>')
  const vb = (svg.attrs.viewBox || '0 0 100 100').split(/[\s,]+/).map(Number)
  const W = num(svg.attrs.width, vb[2]), H = num(svg.attrs.height, vb[3])
  const root = new MockNode(env, 'FRAME', { name: 'frame', x: 0, y: 0, width: W, height: H })
  root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: false }]
  const base = [1, 0, 0, 1, -vb[0], -vb[1]]

  function vector(parentNode, el, style, m, cmds, extra = {}) {
    const abs = transformCommands(cmds, m)
    const b = boundsOf(abs)
    const p = paints(style)
    const v = new MockNode(env, 'VECTOR', { name: el.attrs.id || 'Vector', x: b.x, y: b.y, width: b.width, height: b.height })
    v.fills = extra.noFill ? [] : p.fills
    v.strokes = p.strokes
    v.strokeWeight = p.strokeWeight
    v.strokeAlign = 'CENTER'
    v.dashPattern = dashOf(style)
    v.vectorPaths = [{ windingRule: 'NONZERO', data: commandsToData(abs, b.x, b.y) }]
    parentNode.appendChild(v)
    return v
  }

  function text(parentNode, el, style, m) {
    const tspans = el.children.filter((c) => c.tag === 'tspan')
    const size = num(style['font-size'], 16)
    const weight = num(style['font-weight'] === 'bold' ? 700 : style['font-weight'], 400)
    const anchor = style['text-anchor'] || 'start'
    const lines = []
    const collect = (node, st) => {
      for (const c of node.children) {
        if (c.tag === 'tspan') {
          const cs = { ...st, ...styleAttrs(c) }
          if (c.attrs.x !== undefined || c.attrs.y !== undefined) {
            const t = c.children.filter((k) => k.tag === '#text').map((k) => k.text).join('')
            lines.push({ x: num(c.attrs.x, num(el.attrs.x)), y: num(c.attrs.y, num(el.attrs.y)), text: t, fill: cs.fill })
          } else collect(c, cs)
        }
      }
    }
    collect(el, style)
    if (tspans.length === 0) {
      lines.push({ x: num(el.attrs.x), y: num(el.attrs.y), text: el.children.filter((k) => k.tag === '#text').map((k) => k.text).join('').trim(), fill: style.fill })
    }
    const chars = lines.map((l) => l.text).join('\n')
    let left = Infinity, top = Infinity, width = 0
    const lh = lineHeight(size)
    lines.forEach((l, i) => {
      const w = arialWidth(l.text, size)
      const [ax, ay] = apply(m, l.x, l.y)
      const x0 = anchor === 'middle' ? ax - w / 2 : anchor === 'end' ? ax - w : ax
      left = Math.min(left, x0)
      if (i === 0) top = ay - 0.92 * size
      width = Math.max(width, w)
    })
    if (!isFinite(left)) { left = 0; top = 0 }
    const fillPaint = parseColor(lines[0]?.fill || style.fill)
    const t = new MockNode(env, 'TEXT', {
      name: 'Text', characters: chars, x: left, y: top,
      width: Math.ceil(width), height: lh * Math.max(1, lines.length),
      fills: fillPaint ? [{ type: 'SOLID', color: fillPaint.color, opacity: fillPaint.alpha, visible: true }] : [],
    })
    t.fontName = { family: 'Arial', style: weight >= 600 ? 'Bold' : 'Regular' }
    t.fontSize = size
    t.fontWeight = weight
    t.textAlignHorizontal = 'LEFT'
    t.textAutoResize = 'WIDTH_AND_HEIGHT'
    t.width = Math.ceil(width)
    t.height = lh * Math.max(1, lines.length)
    parentNode.appendChild(t)
  }

  function walk(el, parentNode, inherited, parentM) {
    const tag = el.tag.toLowerCase()
    if (SKIP_TAGS.has(tag) || tag === '#text') return
    const own = styleAttrs(el)
    if (own.display === 'none') return
    const style = { ...inherited }
    for (const k of INHERITED) if (own[k] !== undefined) style[k] = own[k]
    if (own.opacity !== undefined && inherited.opacity !== undefined) style.opacity = String(num(own.opacity, 1) * num(inherited.opacity, 1))
    const m = mul(parentM, parseTransform(own.transform))
    if (tag === 'g' || tag === 'a') {
      const g = new MockNode(env, 'GROUP', { name: el.attrs.id || 'Group' })
      parentNode.appendChild(g)
      for (const c of el.children) walk(c, g, style, m)
      if (g.children.length) {
        const bs = g.children
        const x0 = Math.min(...bs.map((c) => c.x)), y0 = Math.min(...bs.map((c) => c.y))
        g.setBoundsRaw(x0, y0, Math.max(...bs.map((c) => c.x + c.width)) - x0, Math.max(...bs.map((c) => c.y + c.height)) - y0)
      }
    } else if (tag === 'rect') {
      const x = num(own.x), y = num(own.y), w = num(own.width), h = num(own.height)
      if (w <= 0 || h <= 0) return
      let rx = num(own.rx, NaN), ry = num(own.ry, NaN)
      if (!Number.isFinite(rx) && Number.isFinite(ry)) rx = ry
      if (!Number.isFinite(ry) && Number.isFinite(rx)) ry = rx
      rx = Math.min(Math.max(rx || 0, 0), w / 2); ry = Math.min(Math.max(ry || 0, 0), h / 2)
      if (rx > 0 && ry > 0) {
        // Rounded rect like Figma's importer: straight edges + one cubic per corner (kappa 0.5523).
        const kx = 0.5523 * rx, ky = 0.5523 * ry
        vector(parentNode, el, style, m, [
          ['M', x + rx, y], ['L', x + w - rx, y],
          ['C', x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry],
          ['L', x + w, y + h - ry],
          ['C', x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h],
          ['L', x + rx, y + h],
          ['C', x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry],
          ['L', x, y + ry],
          ['C', x, y + ry - ky, x + rx - kx, y, x + rx, y], ['Z'],
        ])
      } else {
        vector(parentNode, el, style, m, [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['L', x, y], ['Z']])
      }
    } else if (tag === 'path') {
      if (!own.d) return
      vector(parentNode, el, style, m, parsePathD(own.d))
    } else if (tag === 'polygon' || tag === 'polyline') {
      const pts = (own.points || '').trim().split(/[\s,]+/).map(Number)
      const cmds = []
      for (let i = 0; i + 1 < pts.length; i += 2) cmds.push([i ? 'L' : 'M', pts[i], pts[i + 1]])
      // Figma's importer closes a polygon with an explicit line back to the start point, then Z.
      if (tag === 'polygon') { cmds.push(['L', pts[0], pts[1]]); cmds.push(['Z']) }
      vector(parentNode, el, style, m, cmds)
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = num(own.cx), cy = num(own.cy)
      const rx = tag === 'circle' ? num(own.r) : num(own.rx), ry = tag === 'circle' ? num(own.r) : num(own.ry)
      const k = 0.5522847498
      vector(parentNode, el, style, m, [
        ['M', cx + rx, cy],
        ['C', cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry],
        ['C', cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
        ['C', cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry],
        ['C', cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy], ['Z'],
      ])
    } else if (tag === 'line') {
      vector(parentNode, el, style, m, [['M', num(own.x1), num(own.y1)], ['L', num(own.x2), num(own.y2)]], { noFill: true })
    } else if (tag === 'text') {
      text(parentNode, el, style, m)
    }
  }

  const svgStyle = styleAttrs(svg)
  const inherited = {}
  for (const k of INHERITED) if (svgStyle[k] !== undefined) inherited[k] = svgStyle[k]
  for (const c of svg.children) walk(c, root, inherited, base)
  return root
}
