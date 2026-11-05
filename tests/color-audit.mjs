#!/usr/bin/env node
// Colour contrast audit for every rendered diagram type (plan Phase 9.1).
//
// Drives the running app in headless Chrome via the DevTools protocol (no extra
// dependencies: Node 22 ships fetch + WebSocket), exactly like tests/export-svg.mjs:
// code goes in through localStorage (`mermapix:code`), the theme through
// `mermapix:theme`, and the real app renders the diagram. Inside the page we read the
// *computed* paint of the live SVG:
//
//   text    fill (with fill-opacity/opacity) against the colour composited from every
//           shape painted beneath the text centre, ending at the diagram background.
//           Needs 4.5:1, or 3:1 for large text (>= 18px, or bold >= 14px).
//   line    stroke of an unfilled path/line against what is beneath it. Needs 3:1.
//   outline stroke of a filled shape (card border) against what is beneath it. These
//           are intentionally subtle next to a filled card, so they only warn.
//
// Lines and outlines inside gridlines / panels / dashed elements also only warn.
//
// Usage:
//   node tests/color-audit.mjs --label after --out <dir>
//   node tests/color-audit.mjs --only 37,38 --themes dark
//   node tests/color-audit.mjs --shots <dir> --only 37-treemap-budget,21-survey-mindmap
// Options:
//   --url <http://localhost:8443>   app URL (dev server must be running)
//   --chrome <path>                 Chrome binary (default: macOS Google Chrome)
//   --port <9444>                   remote debugging port
//   --only <a,b>                    fixture name prefixes/substrings to include
//   --themes <light,dark>
//   --label <name>                  report file prefix (writes <label>.json and <label>.txt)
//   --out <dir>                     report directory (default tests/output)
//   --shots <dir>                   also save a PNG of the canvas per fixture and theme
//   --verbose                       list every warning, not just failures
// Exit code is 1 when any failure remains.

import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]])
    return pairs
  }, []),
)
const appUrl = args.url ?? "http://localhost:8443"
const outDir = path.resolve(args.out ?? path.join(here, "output"))
const shotsDir = args.shots && args.shots !== "true" ? path.resolve(args.shots) : null
const label = args.label ?? "color-audit"
const chromePath = args.chrome ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = Number(args.port ?? 9444)
const themes = (args.themes ?? "light,dark").split(",")
const only = args.only ? args.only.split(",") : null
const fixturesDir = path.join(here, "figma-fixtures")
// Diagram backgrounds, identical to THEME_PRESETS[theme].background.
const BACKGROUNDS = { light: "#ffffff", dark: "#090d16" }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchChrome() {
  const profile = await mkdtemp(path.join(tmpdir(), "mermapix-audit-"))
  const proc = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" })
  for (let i = 0; i < 50; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = pages.find((p) => p.type === "page")
      if (page) return { proc, profile, wsUrl: page.webSocketDebuggerUrl }
    } catch { /* not up yet */ }
    await sleep(200)
  }
  proc.kill()
  throw new Error("Chrome did not start")
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve({ send, close: () => ws.close() }))
    ws.addEventListener("error", reject)
  })
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

async function waitFor(cdp, expression, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await evaluate(cdp, expression).catch(() => false)) return true
    await sleep(150)
  }
  return false
}

// Runs inside the page. Everything is computed in the root <svg> user space so the
// canvas zoom/pan never matters.
const HIDE_TEXT_ID = "color-audit-hide-text"
const PAGE_HIDE_TEXT = `(() => {
  const style = document.createElement('style')
  style.id = ${JSON.stringify(HIDE_TEXT_ID)}
  style.textContent = '.diagram-stage svg text, .diagram-stage svg tspan { fill: transparent !important; stroke: none !important; text-shadow: none !important }'
  document.head.appendChild(style)
  return true
})()`

const PAGE_AUDIT = `(async (bgHex, shotB64) => {
  document.getElementById(${JSON.stringify(HIDE_TEXT_ID)})?.remove()
  const svg = document.querySelector('.diagram-stage svg')
  if (!svg) return { error: 'no svg' }
  const parse = (value) => {
    const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+%?))?/.exec(value || '')
    if (!m) return null
    let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return { r: +m[1], g: +m[2], b: +m[3], a }
  }
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const over = (top, under, alpha) => ({
    r: top.r * alpha + under.r * (1 - alpha),
    g: top.g * alpha + under.g * (1 - alpha),
    b: top.b * alpha + under.b * (1 - alpha),
  })
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const bg = parse('rgb(' + [1, 3, 5].map((i) => parseInt(bgHex.slice(i, i + 2), 16)).join(',') + ')')
  const skip = 'defs, clipPath, marker, mask, symbol, pattern, linearGradient, radialGradient'
  const inDefs = (el) => !!el.closest(skip)
  const opacityOf = (el) => {
    let o = 1
    for (let n = el; n && n !== svg.parentNode; n = n.parentNode) {
      if (n.nodeType === 1) o *= parseFloat(getComputedStyle(n).opacity || '1')
    }
    return o
  }
  const hidden = (el) => {
    const s = getComputedStyle(el)
    return s.display === 'none' || s.visibility === 'hidden'
  }
  const geomSel = 'rect, path, polygon, polyline, circle, ellipse, line'
  const shapes = [...svg.querySelectorAll(geomSel)].filter((el) => !inDefs(el) && !hidden(el))
  const painted = shapes.map((el) => {
    const s = getComputedStyle(el)
    const op = opacityOf(el)
    const fill = s.fill && s.fill !== 'none' ? parse(s.fill) : null
    const stroke = s.stroke && s.stroke !== 'none' ? parse(s.stroke) : null
    const sw = parseFloat(s.strokeWidth || '0')
    return {
      el,
      fill: fill && fill.a * parseFloat(s.fillOpacity) * op > 0 ? { c: fill, alpha: fill.a * parseFloat(s.fillOpacity) * op } : null,
      fillUnknown: s.fill && s.fill.startsWith('url('),
      stroke: stroke && sw > 0 && stroke.a * parseFloat(s.strokeOpacity) * op > 0 ? { c: stroke, alpha: stroke.a * parseFloat(s.strokeOpacity) * op, width: sw } : null,
      dashed: s.strokeDasharray && s.strokeDasharray !== 'none',
    }
  })
  const rootInv = svg.getScreenCTM()
  const toRoot = (el, x, y) => {
    const m = el.getScreenCTM()
    if (!m || !rootInv) return null
    const p = new DOMPoint(x, y).matrixTransform(m)
    return p.matrixTransform(rootInv.inverse())
  }
  const containsPoint = (el, p) => {
    const m = el.getScreenCTM()
    if (!m || !rootInv) return false
    const local = p.matrixTransform(rootInv).matrixTransform(m.inverse())
    try { return el.isPointInFill(local) } catch { return false }
  }
  // Colour visible at root-space point p from everything painted before "before".
  const backdropAt = (p, before, exclude) => {
    let color = { r: bg.r, g: bg.g, b: bg.b }
    for (const s of painted) {
      if (s.el === before || (before.compareDocumentPosition(s.el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
      if (exclude && (s.el === exclude || exclude.contains(s.el))) continue
      if (!s.fill || !containsPoint(s.el, p)) continue
      color = over(s.fill.c, color, s.fill.alpha)
    }
    return color
  }
  const report = { texts: [], lines: [], unknownFills: 0 }
  const clsOf = (el) => { let t = ''; for (let n = el; n && n !== svg; n = n.parentNode) t += ' ' + (n.getAttribute && (n.getAttribute('class') || '')) + ' ' + (n.id || ''); return t }

  // --- text ---
  // Backdrop = pixels of a screenshot taken with all text hidden, so markers, opacity,
  // filters and overlaps are measured exactly as a user sees them.
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + shotB64)).blob())
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width; canvas.height = bmp.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  const k = bmp.width / window.innerWidth
  const pixel = (x, y) => {
    const px = Math.round(x * k), py = Math.round(y * k)
    if (px < 0 || py < 0 || px >= bmp.width || py >= bmp.height) return null
    const d = ctx.getImageData(px, py, 1, 1).data
    return { r: d[0], g: d[1], b: d[2] }
  }
  const leaves = []
  for (const t of svg.querySelectorAll('text')) {
    const spans = [...t.children].filter((c) => c.tagName === 'tspan' && [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    if (spans.length) leaves.push(...spans); else leaves.push(t)
  }
  report.unsampled = 0
  for (const t of leaves) {
    if (inDefs(t) || hidden(t)) continue
    const content = t.textContent.replace(/\\s+/g, ' ').trim()
    if (!content) continue
    const s = getComputedStyle(t)
    const fill = parse(s.fill)
    if (!fill) continue
    const alpha = fill.a * parseFloat(s.fillOpacity) * opacityOf(t)
    if (alpha <= 0) continue
    const r = t.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    // 3x3 grid across the text box; the median luminance ignores thin strokes or edges
    // that the glyphs merely overlap.
    const samples = []
    for (const dy of [-0.25, 0, 0.25]) for (const dx of [-0.25, 0, 0.25]) {
      const px = pixel(cx + dx * r.width, cy + dy * r.height)
      if (px) samples.push(px)
    }
    const hit = document.elementFromPoint(cx, cy)
    if (samples.length < 9 || !hit || !svg.contains(hit)) { report.unsampled++; continue }
    samples.sort((a, b) => lum(a) - lum(b))
    const under = samples[4]
    const fg = over(fill, under, alpha)
    const size = parseFloat(s.fontSize)
    const bold = parseInt(s.fontWeight, 10) >= 700 || s.fontWeight === 'bold'
    const large = size >= 18 || (bold && size >= 14)
    report.texts.push({
      text: content.slice(0, 40), fg: hex(fg), bg: hex(under), ratio: +ratio(fg, under).toFixed(2),
      need: large ? 3 : 4.5, size, bold, cls: clsOf(t).trim().replace(/\\s+/g, ' ').slice(0, 60),
    })
  }

  // --- strokes ---
  for (const s of painted) {
    if (!s.stroke) continue
    const el = s.el
    let len = 0
    try { len = el.getTotalLength() } catch { /* some shapes have none */ }
    let local
    try { local = len ? el.getPointAtLength(len / 2) : null } catch { local = null }
    if (!local) { const b = el.getBBox(); local = { x: b.x, y: b.y } }
    const p = toRoot(el, local.x, local.y)
    if (!p) continue
    const under = backdropAt(p, el, el)
    const fg = over(s.stroke.c, under, s.stroke.alpha)
    const cls = clsOf(el)
    const kind = s.fill ? 'outline' : 'line'
    const subtle = /grid|border|cluster|background|panel|tick|divider|lane|axis-line/i.test(cls) || s.dashed
    report.lines.push({
      kind, subtle: !!subtle, fg: hex(fg), bg: hex(under), ratio: +ratio(fg, under).toFixed(2), need: 3,
      width: s.stroke.width, tag: el.tagName, cls: cls.trim().replace(/\\s+/g, ' ').slice(0, 60),
    })
  }
  report.errorText = /syntax error|parse error/i.test(svg.textContent) ? svg.textContent.slice(0, 80) : null
  report.type = svg.getAttribute('aria-roledescription') || null
  return report
})`

async function renderFixture(cdp, code, theme) {
  await cdp.send("Page.navigate", { url: appUrl })
  await waitFor(cdp, "document.readyState === 'complete'")
  await evaluate(cdp, `(() => { localStorage.setItem('mermapix:code', ${JSON.stringify(code)}); localStorage.setItem('mermapix:theme', ${JSON.stringify(theme)}) })()`)
  await cdp.send("Page.reload", { ignoreCache: true })
  await waitFor(cdp, "document.readyState === 'complete'")
  const ok = await waitFor(cdp, "!!document.querySelector('.diagram-stage svg')")
  if (!ok) return false
  await evaluate(cdp, "document.fonts.ready.then(() => true)")
  await sleep(700) // debounce + fit-to-view settle
  return true
}

const fixtureFiles = (await readdir(fixturesDir)).filter((f) => f.endsWith(".mmd")).sort()
  .filter((f) => !only || only.some((o) => f.includes(o)))
await mkdir(outDir, { recursive: true })
if (shotsDir) await mkdir(shotsDir, { recursive: true })

const chrome = await launchChrome()
const results = []
try {
  const cdp = await connect(chrome.wsUrl)
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  for (const file of fixtureFiles) {
    const name = file.replace(/\.mmd$/, "")
    const code = await readFile(path.join(fixturesDir, file), "utf8")
    for (const theme of themes) {
      const row = { fixture: name, theme, texts: 0, lines: 0, failures: [], warnings: [], renderError: null }
      if (!(await renderFixture(cdp, code, theme))) {
        row.renderError = "no svg rendered"
        results.push(row)
        continue
      }
      await evaluate(cdp, PAGE_HIDE_TEXT)
      await sleep(80)
      const { data: shot } = await cdp.send("Page.captureScreenshot", { format: "png" })
      const rep = await evaluate(cdp, `${PAGE_AUDIT}(${JSON.stringify(BACKGROUNDS[theme])}, ${JSON.stringify(shot)})`)
      if (rep.error) { row.renderError = rep.error; results.push(row); continue }
      if (rep.errorText) row.renderError = rep.errorText
      row.type = rep.type
      row.texts = rep.texts.length
      row.unsampled = rep.unsampled
      row.lines = rep.lines.length
      for (const t of rep.texts) {
        if (t.ratio < t.need) row.failures.push({ kind: "text", ...t })
      }
      for (const l of rep.lines) {
        if (l.ratio >= l.need) continue
        const entry = { kind: l.kind, ...l }
        if (l.kind === "outline" || l.subtle) row.warnings.push(entry)
        else row.failures.push(entry)
      }
      if (shotsDir) {
        const box = await evaluate(cdp, `(() => { const r = document.querySelector('.diagram-stage').parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 } })
        await writeFile(path.join(shotsDir, `${label}-${name}-${theme}.png`), Buffer.from(data, "base64"))
      }
      results.push(row)
      process.stderr.write(`${name} ${theme}: ${row.failures.length} fail, ${row.warnings.length} warn\n`)
    }
  }
  cdp.close()
} finally {
  chrome.proc.kill()
  await rm(chrome.profile, { recursive: true, force: true }).catch(() => {})
}

// --- report ---
const lines = []
const pad = (s, n) => String(s).padEnd(n)
lines.push(`Mermapix colour audit (${label}), themes: ${themes.join(", ")}`)
lines.push("fail = text < 4.5:1 (3:1 large) or unfilled line < 3:1; warn = card outline / grid / dashed < 3:1")
lines.push("")
lines.push(pad("fixture", 36) + themes.map((t) => pad(`${t} fail/warn (texts,lines)`, 30)).join(""))
const totals = Object.fromEntries(themes.map((t) => [t, { fail: 0, warn: 0 }]))
const byName = new Map()
for (const r of results) {
  if (!byName.has(r.fixture)) byName.set(r.fixture, {})
  byName.get(r.fixture)[r.theme] = r
}
for (const [name, perTheme] of byName) {
  let line = pad(name, 36)
  for (const theme of themes) {
    const r = perTheme[theme]
    if (!r) { line += pad("-", 30); continue }
    if (r.renderError && !r.texts) { line += pad(`ERROR ${r.renderError.slice(0, 20)}`, 30); continue }
    totals[theme].fail += r.failures.length
    totals[theme].warn += r.warnings.length
    line += pad(`${r.failures.length} / ${r.warnings.length}  (${r.texts},${r.lines}${r.unsampled ? `,${r.unsampled} unsampled` : ""})`, 30)
  }
  lines.push(line)
}
lines.push("")
lines.push(pad("TOTAL", 36) + themes.map((t) => pad(`${totals[t].fail} / ${totals[t].warn}`, 30)).join(""))
lines.push("")
lines.push("Failures (grouped by fixture, theme, foreground on background):")
for (const r of results) {
  const groups = new Map()
  for (const f of r.failures) {
    const key = `${f.kind} ${f.fg} on ${f.bg} ${f.ratio}:1 (need ${f.need})`
    const g = groups.get(key) ?? { n: 0, sample: f }
    g.n++
    groups.set(key, g)
  }
  for (const [key, g] of groups) {
    const s = g.sample
    const what = s.kind === "text" ? `"${s.text}" ${s.size}px` : `${s.tag} .${s.cls}`
    lines.push(`  ${r.fixture} [${r.theme}] x${g.n} ${key}  e.g. ${what}`)
  }
}
if (args.verbose) {
  lines.push("")
  lines.push("Warnings:")
  for (const r of results) {
    const groups = new Map()
    for (const f of r.warnings) {
      const key = `${f.kind} ${f.fg} on ${f.bg} ${f.ratio}:1`
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    for (const [key, n] of groups) lines.push(`  ${r.fixture} [${r.theme}] x${n} ${key}`)
  }
}
const text = lines.join("\n") + "\n"
await writeFile(path.join(outDir, `${label}.json`), JSON.stringify(results, null, 2) + "\n")
await writeFile(path.join(outDir, `${label}.txt`), text)
console.log(text)
process.exit(results.some((r) => r.failures.length) ? 1 : 0)
