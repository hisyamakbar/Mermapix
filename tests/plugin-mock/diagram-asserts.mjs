// Shared assertions of the Phase 14 use case / agentflow suites (plugin-usecase.test.mjs, plugin-agentflow.test.mjs):
// the structural checks every dedicated converter must pass on its payloads.
import assert from 'node:assert/strict'
import { walk } from './figma-mock.mjs'
import { importSvg } from './svg-import.mjs'
import { isGenericName, relBounds } from './survey-metrics.mjs'

export const all = (tree, pred) => { const out = []; walk(tree, (n, p) => pred(n, p) && out.push(n)); return out }
export const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol
export const rel = relBounds
export const kindOf = (n) => n.pluginData && n.pluginData['mermapix:kind']
export const roleOf = (n) => n.pluginData && n.pluginData['mermapix:role']
export const textsOf = (tree) => all(tree, (n) => n.type === 'TEXT' && n.characters.trim()).map((t) => t.characters.trim()).sort()
export const byName = (tree, name) => all(tree, (n) => n.name === name)[0]
export const isUnpainted = (v) => !(v.fills || []).some((p) => p.visible !== false && p.opacity !== 0) && !((v.strokes || []).length > 0 && Number(v.strokeWeight) > 0)
export const solidKey = (paints) => JSON.stringify((paints || []).map((p) => [p.type, p.color, p.opacity ?? 1]))

/** The raw (importer only) tree of a run, for before / after comparisons. */
export const rawOf = (run) => importSvg({ ids: 0 }, run.svgSeen)

export function assertBounds(actual, want, label, tol = 0.6) {
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(near(actual[k], want[k], tol), `${label} ${k}: ${actual[k]} vs ${want[k]}`)
}

export const insideBox = (outer, inner, tol = 1) =>
  inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.width <= outer.x + outer.width + tol && inner.y + inner.height <= outer.y + outer.height + tol

/**
 * What every converted payload must satisfy: no crash, the generic fallback stayed away, no text lost or
 * invented, TEXT nodes = `<text>` elements, nothing the importer named left (except `Line` inside an edge group),
 * and every painted raw vector is still there at the same bounds (as a vector or as the frame that absorbed it).
 */
export function assertStructured(run, label, { importerDrops = 0 } = {}) {
  assert.ok(!run.log.some((l) => l[0] === 'notify' && l[1][1] && l[1][1].error), `${label}: no error notification`)
  assert.ok(!(run.root.pluginData && run.root.pluginData['mermapix:fallback']), `${label}: generic fallback must not run on structured output`)
  const before = rawOf(run)
  assert.deepEqual(textsOf(run.root), textsOf(before), `${label}: zero-drop texts`)
  // <text> elements with content (a multi-line label is one <text> with several <tspan> rows = one TEXT node)
  const svgTexts = [...run.svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].filter((m) => m[1].replace(/<[^>]*>/g, '').trim()).length
  // `importerDrops`: <text> elements the MOCK importer does not turn into a TEXT node (a bare <text> with no <tspan>, e.g. the
  // "?" of Mermaid's unknown-icon placeholder); Figma imports it.
  assert.equal(all(run.root, (n) => n.type === 'TEXT' && n.characters.trim()).length, svgTexts - importerDrops, `${label}: TEXT nodes = <text> elements`)
  assert.equal(all(run.root, (n) => n.type === 'TEXT' && !n.characters.trim()).length, 0, `${label}: no empty text`)
  const bad = all(run.root, (n, p) => n !== run.root && isGenericName(n.name) && !(n.name === 'Line' && p && p.name.startsWith('Edge: ')))
  assert.deepEqual(bad.map((n) => `${n.type}:${n.name}`), [], `${label}: generic layer names`)

  const have = []
  walk(run.root, (n) => { if (n !== run.root && (n.type === 'VECTOR' || n.type === 'FRAME')) have.push(rel(n, run.root)) })
  for (const v of all(before, (n) => n.type === 'VECTOR' && !isUnpainted(n) && (Math.round(n.width) !== 0 || Math.round(n.height) !== 0))) {
    const b = rel(v, before)
    assert.ok(have.some((h) => near(h.x, b.x) && near(h.y, b.y) && near(h.width, b.width) && near(h.height, b.height)), `${label}: ${v.name} ${JSON.stringify(b)} lost or moved`)
  }
  return before
}
