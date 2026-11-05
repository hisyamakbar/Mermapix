import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureMarkersInlined, nameInlinedMarkers, prepareSvgForFigma } from '../../plugin/src/svgPrep.ts'
import { inlineSvgMarkers } from '../../src/export/markers.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => fs.readFileSync(path.resolve(here, rel), 'utf8')
const count = (s, re) => (s.match(re) || []).length

test('ensureMarkersInlined inlines once and is idempotent (no double inlining)', () => {
  const raw = read('../baseline/erd-basic.svg')
  assert.equal(count(raw, /inlined-marker /g), 0)
  const once = ensureMarkersInlined(raw)
  const n = count(once, /<g class="inlined-marker /g)
  assert.ok(n > 0)
  assert.equal(once, inlineSvgMarkers(raw))
  // SVG already inlined by the web app: left untouched
  assert.equal(ensureMarkersInlined(once), once)
  assert.equal(count(ensureMarkersInlined(once), /<g class="inlined-marker /g), n)
})

test('ensureMarkersInlined leaves SVGs without markers alone', () => {
  assert.equal(ensureMarkersInlined('<svg><rect/></svg>'), '<svg><rect/></svg>')
  assert.equal(ensureMarkersInlined(''), '')
})

const SAMPLE = `<svg><defs><marker id="m_er-oneOrMoreEnd" refX="0" refY="0"><path d="M0 0"/></marker></defs>
<path d="M 0 0 L 10 0" marker-start="url(#m_er-onlyOneStart)" marker-end="url(#m_er-oneOrMoreEnd)" stroke="#000"/><g class="inlined-marker inlined-marker-start inlined-marker" transform="x"><path d="M 1 1"/></g><g class="inlined-marker inlined-marker-end inlined-marker" transform="y"><g><path d="M 2 2"/></g></g>
<path d="M 5 5 L 9 9" marker-end="url(#m_flowchart-v2-pointEnd)"/><g class="inlined-marker inlined-marker-end inlined-arrowhead" transform="z"><path d="M 3 3"/></g>
<line x1="0" y1="0" x2="5" y2="5" marker-start="url(#m-sequencenumber)" marker-end="url(#m-arrowhead)"/><g class="inlined-marker inlined-marker-start inlined-sequence-number-badge"><circle r="12"/></g><g class="inlined-marker inlined-marker-end inlined-arrowhead"><path d="M 4 4"/></g></svg>`

test('nameInlinedMarkers injects a unique, kind-encoding id on each marker group', () => {
  const out = nameInlinedMarkers(SAMPLE)
  const ids = [...out.matchAll(/<g id="(inlined-marker-[^"]+)" class="inlined-marker /g)].map((m) => m[1])
  assert.deepEqual(ids, [
    'inlined-marker-1-crowsfoot-only-one-start',
    'inlined-marker-2-crowsfoot-one-or-more-end',
    'inlined-marker-3-arrowhead-end',
    'inlined-marker-4-sequence-number-start',
    'inlined-marker-5-arrowhead-end',
  ])
  assert.equal(new Set(ids).size, ids.length)
  // nested group content untouched, nothing else changed
  assert.equal(out.replace(/ id="inlined-marker-\d+-[a-z-]+"/g, ''), SAMPLE)
})

test('nameInlinedMarkers is a no-op without inlined markers', () => {
  assert.equal(nameInlinedMarkers('<svg><path d="M0 0"/></svg>'), '<svg><path d="M0 0"/></svg>')
})

for (const [file, forbidden, expected] of [
  ['../baseline/erd-basic.svg', ['arrowhead', 'cross', 'marker'], 'crowsfoot-'],
  ['../baseline/flowchart-basic.svg', ['marker', 'crowsfoot-'], 'arrowhead'],
  ['../baseline/sequence-basic.svg', ['marker', 'crowsfoot-'], 'arrowhead'],
  ['../fixtures/plugin/2-ex-flowchart.svg', ['marker', 'crowsfoot-'], 'arrowhead'],
  ['../fixtures/plugin/3-ex-sequence.svg', ['marker', 'crowsfoot-'], 'sequence-number'],
]) {
  test(`prepareSvgForFigma names every marker with a real kind: ${path.basename(file)}`, () => {
    const out = prepareSvgForFigma(read(file))
    const total = count(out, /<g id="inlined-marker-\d+-[a-z-]+-(?:start|end)" class="inlined-marker /g)
    assert.equal(total, count(out, /class="inlined-marker /g), 'every marker group has an id')
    assert.ok(total > 0)
    const kinds = [...out.matchAll(/<g id="inlined-marker-\d+-([a-z-]+)-(?:start|end)"/g)].map((m) => m[1])
    assert.ok(kinds.some((k) => k.startsWith(expected)), `expected ${expected} in ${[...new Set(kinds)]}`)
    for (const bad of forbidden) {
      if (bad === 'marker') assert.ok(!kinds.includes('marker'), 'unclassified marker kind')
      else assert.ok(!kinds.some((k) => k.startsWith(bad)), `unexpected kind ${bad}`)
    }
    // single inlining: result of preparing an already-prepared SVG keeps the same count
    assert.equal(count(prepareSvgForFigma(out), /class="inlined-marker /g), total)
  })
}
