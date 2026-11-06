#!/usr/bin/env node
// Exports every tests/figma-fixtures/*.mmd through the real "SVG" export button in
// both themes (what the plugin UI posts and what tests/fixtures/plugin/* hold), and
// checks that the exported content lies inside the exported viewBox (plan Phase 10.1).
//
// Drives the running app in headless Chrome via the DevTools protocol (no extra
// dependencies), like tests/export-svg.mjs. The check re-loads each exported SVG
// into a page at 1:1 scale and unions the client rects of every painted shape and
// text, mapped back into SVG user space, then compares that box to the viewBox.
//
// Usage:
//   node tests/export-fixtures.mjs --out <dir>                 # <name>-<theme>.svg + report
//   node tests/export-fixtures.mjs --out <dir> --shots <dir>   # also a PNG per export
//   node tests/export-fixtures.mjs --only 37,40 --themes dark
// Options:
//   --url <http://localhost:8443>   app URL (dev server must be running)
//   --chrome <path>                 Chrome binary (default: macOS Google Chrome)
//   --port <9445>                   remote debugging port
//   --tolerance <1>                 allowed overflow in px
// Exit code is 1 when any export has content outside its viewBox or a foreignObject.

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
const outDir = path.resolve(args.out ?? path.join(here, "output", "fixtures"))
const shotsDir = args.shots && args.shots !== "true" ? path.resolve(args.shots) : null
const chromePath = args.chrome ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = Number(args.port ?? 9445)
const tolerance = Number(args.tolerance ?? 1)
const themes = (args.themes ?? "light,dark").split(",")
const only = args.only ? args.only.split(",") : null
const fixturesDir = path.join(here, "figma-fixtures")
const BACKGROUNDS = { light: "#ffffff", dark: "#090d16" }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchChrome() {
  const profile = await mkdtemp(path.join(tmpdir(), "mermapix-fixtures-"))
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

async function exportFixture(cdp, code, theme) {
  await cdp.send("Page.navigate", { url: appUrl })
  await waitFor(cdp, "document.readyState === 'complete'")
  await evaluate(cdp, `(() => { localStorage.setItem('mermapix:code', ${JSON.stringify(code)}); localStorage.setItem('mermapix:theme', ${JSON.stringify(theme)}) })()`)
  await cdp.send("Page.reload", { ignoreCache: true })
  await waitFor(cdp, "document.readyState === 'complete'")
  if (!(await waitFor(cdp, "!!document.querySelector('.diagram-stage svg')"))) return null
  await evaluate(cdp, "document.fonts.ready.then(() => true)")
  await sleep(700) // debounce + fit settle
  return evaluate(cdp, `(async () => {
    const original = URL.createObjectURL
    let captured = null
    URL.createObjectURL = (blob) => { captured = blob; return original.call(URL, blob) }
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().endsWith('SVG'))
    if (!button) throw new Error('SVG export button not found')
    button.click()
    URL.createObjectURL = original
    if (!captured) throw new Error('Export produced no file')
    return await captured.text()
  })()`)
}

// Runs in the page: mounts the exported SVG 1:1 at (0,0) and measures its content.
const PAGE_MEASURE = `((svgText, bg) => {
  document.body.innerHTML = ''
  document.documentElement.style.background = bg
  document.body.style.cssText = 'margin:0;background:' + bg
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const parsed = doc.documentElement
  if (parsed.nodeName === 'parsererror' || doc.querySelector('parsererror')) return { error: 'xml parse error' }
  const host = document.createElement('div')
  host.id = 'export-host'
  host.style.cssText = 'position:absolute;left:0;top:0;line-height:0'
  const svg = document.importNode(parsed, true)
  host.appendChild(svg)
  document.body.appendChild(host)
  const vb = svg.getAttribute('viewBox').trim().split(/[ ,]+/).map(Number)
  const r0 = svg.getBoundingClientRect()
  const sx = vb[2] / r0.width, sy = vb[3] / r0.height
  const skip = 'defs, clipPath, marker, mask, symbol, pattern, title, desc'
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const parts = []
  let outside = 0
  for (const el of svg.querySelectorAll('rect, path, polygon, polyline, circle, ellipse, line, text, image')) {
    if (el.closest(skip)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none') continue
    const isText = el.tagName === 'text'
    const paintsFill = cs.fill !== 'none' && parseFloat(cs.fillOpacity) > 0
    const paintsStroke = cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0
    if (!isText && !paintsFill && !paintsStroke) continue
    if (isText && !el.textContent.trim()) continue
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) continue
    // The client rect covers fill geometry only: add half the stroke. Open paths with
    // butt caps (sankey links, thick lines) only grow perpendicular to the path, so
    // their stroke is capped to avoid false overflow along the path direction.
    const closed = /^(rect|circle|ellipse|polygon)$/.test(el.tagName)
    const sw = paintsStroke ? parseFloat(cs.strokeWidth) : 0
    const half = isText ? 0 : closed || cs.strokeLinecap !== 'butt' ? sw / 2 : Math.min(sw / 2, 2)
    const x0 = vb[0] + (r.left - r0.left) * sx - half, x1 = vb[0] + (r.right - r0.left) * sx + half
    const y0 = vb[1] + (r.top - r0.top) * sy - half, y1 = vb[1] + (r.bottom - r0.top) * sy + half
    // Content wholly outside the viewBox is clipped on purpose by Mermaid (gantt's
    // today marker lies far outside the chart range), not cropped by the export.
    if (x1 <= vb[0] || x0 >= vb[0] + vb[2] || y1 <= vb[1] || y0 >= vb[1] + vb[3]) { outside++; continue }
    if (x0 < minX) minX = x0
    if (y0 < minY) minY = y0
    if (x1 > maxX) maxX = x1
    if (y1 > maxY) maxY = y1
    parts.push({ x0, y0, x1, y1, tag: el.tagName, text: isText ? el.textContent.slice(0, 30) : '' })
  }
  const overflow = {
    left: +(vb[0] - minX).toFixed(1), top: +(vb[1] - minY).toFixed(1),
    right: +(maxX - (vb[0] + vb[2])).toFixed(1), bottom: +(maxY - (vb[1] + vb[3])).toFixed(1),
  }
  const worst = (key) => {
    const pick = { left: (p) => -p.x0, top: (p) => -p.y0, right: (p) => p.x1, bottom: (p) => p.y1 }[key]
    return parts.slice().sort((a, b) => pick(b) - pick(a))[0]
  }
  return {
    viewBox: vb, content: [minX, minY, maxX, maxY].map((v) => +v.toFixed(1)), overflow,
    worst: { left: worst('left'), top: worst('top'), right: worst('right'), bottom: worst('bottom') },
    outside, foreignObjects: svg.querySelectorAll('foreignObject').length,
    texts: svg.querySelectorAll('text').length,
    box: { x: 0, y: 0, width: r0.width, height: r0.height },
  }
})`

const fixtureFiles = (await readdir(fixturesDir)).filter((f) => f.endsWith(".mmd")).sort()
  .filter((f) => !only || only.some((o) => f.includes(o)))
await mkdir(outDir, { recursive: true })
if (shotsDir) await mkdir(shotsDir, { recursive: true })

const chrome = await launchChrome()
const rows = []
try {
  const cdp = await connect(chrome.wsUrl)
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  for (const file of fixtureFiles) {
    const name = file.replace(/\.mmd$/, "")
    const code = await readFile(path.join(fixturesDir, file), "utf8")
    for (const theme of themes) {
      const svg = await exportFixture(cdp, code, theme)
      if (!svg) { rows.push({ name, theme, error: "no svg rendered" }); continue }
      await writeFile(path.join(outDir, `${name}-${theme}.svg`), svg)
      const m = await evaluate(cdp, `${PAGE_MEASURE}(${JSON.stringify(svg)}, ${JSON.stringify(BACKGROUNDS[theme])})`)
      if (m.error) { rows.push({ name, theme, error: m.error }); continue }
      const over = Math.max(m.overflow.left, m.overflow.top, m.overflow.right, m.overflow.bottom)
      rows.push({ name, theme, ...m, ok: over <= tolerance && m.foreignObjects === 0 })
      if (shotsDir) {
        // The viewport must be at least as large as the SVG or the PNG is cut at 1440x900.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: Math.max(100, Math.ceil(m.box.width)), height: Math.max(100, Math.ceil(m.box.height)), deviceScaleFactor: 1, mobile: false })
        await sleep(100)
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...m.box, scale: 1 } })
        await cdp.send("Emulation.clearDeviceMetricsOverride")
        await writeFile(path.join(shotsDir, `${name}-${theme}.png`), Buffer.from(data, "base64"))
      }
      process.stderr.write(`${name} ${theme}\n`)
    }
  }
  cdp.close()
} finally {
  chrome.proc.kill()
  await rm(chrome.profile, { recursive: true, force: true }).catch(() => {})
}

const pad = (s, n) => String(s).padEnd(n)
const out = []
out.push(`Exported content vs viewBox (tolerance ${tolerance}px). overflow > 0 means content outside the viewBox.`)
out.push(pad("fixture", 34) + pad("theme", 7) + pad("viewBox", 28) + pad("overflow L/T/R/B", 24) + "result")
for (const r of rows) {
  if (r.error) { out.push(pad(r.name, 34) + pad(r.theme, 7) + `ERROR ${r.error}`); continue }
  out.push(
    pad(r.name, 34) + pad(r.theme, 7) + pad(r.viewBox.map((v) => +v.toFixed(0)).join(" "), 28) +
    pad(`${r.overflow.left}/${r.overflow.top}/${r.overflow.right}/${r.overflow.bottom}`, 24) +
    (r.ok ? "ok" : `FAIL${r.foreignObjects ? ` (${r.foreignObjects} foreignObject)` : ""}`) + (r.outside ? `  (${r.outside} element(s) wholly outside the viewBox, ignored)` : ""),
  )
}
const bad = rows.filter((r) => r.error || !r.ok)
out.push("")
out.push(`${rows.length - bad.length}/${rows.length} ok`)
for (const r of bad.filter((x) => !x.error)) {
  const sides = ["left", "top", "right", "bottom"].filter((s) => r.overflow[s] > tolerance)
  for (const s of sides) out.push(`  ${r.name} [${r.theme}] ${s} +${r.overflow[s]}px  e.g. <${r.worst[s].tag}> ${r.worst[s].text}`)
}
const text = out.join("\n") + "\n"
await writeFile(path.join(outDir, "viewbox-check.txt"), text)
console.log(text)
process.exit(bad.length ? 1 : 0)
