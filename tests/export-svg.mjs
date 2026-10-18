#!/usr/bin/env node
// Regression helper for the Mermapix SVG export pipeline (plan Fase 0.2 / 0.4).
//
// Drives the running app in headless Chrome via the DevTools protocol (no extra
// dependencies: Node 22 ships fetch + WebSocket). For each fixture it loads the
// code into the editor through localStorage, clicks the real "SVG" export button,
// and captures the exported file. Nothing in the app is mocked or bypassed, so the
// output is exactly what a user would download.
//
// Usage:
//   node tests/export-svg.mjs --out tests/baseline          # write baseline
//   node tests/export-svg.mjs --out tests/output --compare tests/baseline
// Options:
//   --url <http://localhost:8443>   app URL (dev server must be running)
//   --chrome <path>                 Chrome binary (default: macOS Google Chrome)

import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1] ?? "true"])
    return pairs
  }, []),
)
const appUrl = args.url ?? "http://localhost:8443"
const outDir = path.resolve(args.out ?? path.join(here, "output"))
const compareDir = args.compare ? path.resolve(args.compare) : null
const chromePath = args.chrome ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const fixturesDir = path.join(here, "fixtures")
const PORT = 9333
// Both the current and the pre-rebrand key, so the script works across Fase 1.5.
const STORAGE_KEYS = ["mermapix:code", "mermaid-code"]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchChrome() {
  const profile = await mkdtemp(path.join(tmpdir(), "mermapix-chrome-"))
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
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const pages = await res.json()
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
    if (await evaluate(cdp, expression).catch(() => false)) return
    await sleep(150)
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

async function exportFixture(cdp, code) {
  await cdp.send("Page.navigate", { url: appUrl })
  await waitFor(cdp, "document.readyState === 'complete'")
  await evaluate(cdp, `(() => { ${STORAGE_KEYS.map((k) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(code)});`).join("")} })()`)
  await cdp.send("Page.reload", { ignoreCache: true })
  await waitFor(cdp, "document.readyState === 'complete'")
  await waitFor(cdp, "!!document.querySelector('.diagram-stage svg')")
  await evaluate(cdp, "document.fonts.ready.then(() => true)")
  await sleep(600) // let debounce + fit settle
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

// Structural fingerprint used for comparison. Coordinates are excluded on
// purpose (font hinting differs across machines); what matters for Figma is
// that the same shapes, texts and colours survive the export.
function summarize(svg) {
  const count = (tag) => (svg.match(new RegExp(`<${tag}[\\s>/]`, "g")) ?? []).length
  const texts = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]).filter(Boolean)
  const fills = [...new Set([...svg.matchAll(/\sfill="([^"]+)"/g)].map((m) => m[1]))].sort()
  const strokes = [...new Set([...svg.matchAll(/\sstroke="([^"]+)"/g)].map((m) => m[1]))].sort()
  return {
    elements: Object.fromEntries(["g", "rect", "path", "polygon", "circle", "line", "text", "tspan", "foreignObject", "style"].map((t) => [t, count(t)])),
    hasClassAttr: /\sclass="/.test(svg),
    hasStyleAttr: /\sstyle="/.test(svg),
    texts,
    fills,
    strokes,
  }
}

function diffSummaries(base, next) {
  const problems = []
  for (const [tag, n] of Object.entries(base.elements)) {
    if (next.elements[tag] !== n) problems.push(`<${tag}> count ${n} → ${next.elements[tag]}`)
  }
  if (next.elements.foreignObject > 0) problems.push("foreignObject present (Figma drops it)")
  if (next.hasClassAttr) problems.push("class attributes leaked into export")
  if (JSON.stringify(base.texts) !== JSON.stringify(next.texts)) problems.push(`texts differ:\n    base: ${JSON.stringify(base.texts)}\n    next: ${JSON.stringify(next.texts)}`)
  const missingFills = base.fills.filter((f) => !next.fills.includes(f))
  if (missingFills.length) problems.push(`fills missing: ${missingFills.join(", ")}`)
  return problems
}

const fixtures = (await readdir(fixturesDir)).filter((f) => f.endsWith(".mmd")).sort()
await mkdir(outDir, { recursive: true })
const chrome = await launchChrome()
let failed = false
try {
  const cdp = await connect(chrome.wsUrl)
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  for (const file of fixtures) {
    const name = file.replace(/\.mmd$/, "")
    const code = await readFile(path.join(fixturesDir, file), "utf8")
    const svg = await exportFixture(cdp, code)
    const summary = summarize(svg)
    await writeFile(path.join(outDir, `${name}.svg`), svg)
    await writeFile(path.join(outDir, `${name}.summary.json`), JSON.stringify(summary, null, 2) + "\n")
    let status = `${summary.elements.text} text, ${summary.elements.rect + summary.elements.path + summary.elements.polygon} shapes, ${summary.elements.foreignObject} foreignObject`
    if (compareDir) {
      try {
        const base = JSON.parse(await readFile(path.join(compareDir, `${name}.summary.json`), "utf8"))
        const problems = diffSummaries(base, summary)
        if (problems.length) {
          failed = true
          status += `\n  ✗ ${problems.join("\n  ✗ ")}`
        } else status += "  ✓ matches baseline"
      } catch (err) {
        status += `  (no baseline: ${err.message})`
      }
    }
    console.log(`${name}: ${status}`)
  }
  cdp.close()
} finally {
  chrome.proc.kill()
  await rm(chrome.profile, { recursive: true, force: true }).catch(() => {})
}
process.exit(failed ? 1 : 0)
