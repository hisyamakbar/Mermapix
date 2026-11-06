import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { ensureMarkersInlined, nameInlinedMarkers, prepareSvgForFigma, stripLabelClipPaths } from '../../plugin/src/svgPrep.ts'
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

// ---------------------------------------------------------------- Phase 9.2: label clipPaths

const CLIPPED = '<svg><g><rect width="10" height="5" fill="none"/><clipPath id="clip-a" fill="red"><rect width="8" height="5" fill="red"/></clipPath><rect width="10" height="40" fill="blue"/><text clip-path="url(#clip-a)" font-size="12"><tspan x="1" y="2">A</tspan></text><text clip-path="url(#clip-a)"><tspan x="1" y="2">B</tspan></text></g></svg>'

test('stripLabelClipPaths drops clipPaths that only clip text, with every clip-path reference', () => {
  const out = stripLabelClipPaths(CLIPPED)
  assert.ok(!out.includes('clipPath') && !out.includes('clip-path'))
  assert.equal(count(out, /<rect /g), 2, 'the real rects stay')
  assert.equal(count(out, /<text[ >]/g), 2)
  assert.ok(out.includes('<text font-size="12">') && out.includes('<text>'), 'other attributes stay')
  assert.equal(stripLabelClipPaths(out), out, 'idempotent')
})

test('stripLabelClipPaths is conservative: shape clips, complex clips, style refs and no-ops are left alone', () => {
  const shapeClip = '<svg><clipPath id="c"><rect width="8" height="5"/></clipPath><g clip-path="url(#c)"><rect width="9" height="9"/></g></svg>'
  assert.equal(stripLabelClipPaths(shapeClip), shapeClip, 'clip on a group of shapes')
  const mixed = '<svg><clipPath id="c"><rect width="8" height="5"/></clipPath><text clip-path="url(#c)">a</text><rect clip-path="url(#c)" width="1" height="1"/></svg>'
  assert.equal(stripLabelClipPaths(mixed), mixed, 'one shape reference keeps the clipPath for everyone')
  const multi = '<svg><clipPath id="c"><rect width="8" height="5"/><circle r="2"/></clipPath><text clip-path="url(#c)">a</text></svg>'
  assert.equal(stripLabelClipPaths(multi), multi, 'multi-shape clipPath')
  const styled = '<svg><clipPath id="c"><rect width="8" height="5"/></clipPath><text clip-path="url(#c)" style="clip-path:url(#c)">a</text></svg>'
  assert.equal(stripLabelClipPaths(styled), styled, 'unknown mention of the id')
  assert.equal(stripLabelClipPaths('<svg><rect/></svg>'), '<svg><rect/></svg>')
  assert.equal(stripLabelClipPaths(''), '')
})

test('stripLabelClipPaths handles several clipPaths, an unreferenced one, and id characters', () => {
  const svg = '<svg><clipPath id="clip.1+x"><path d="M0 0 L1 1"/></clipPath><clipPath id="unused"><rect width="1" height="1"></rect></clipPath><clipPath id="keep"><rect/></clipPath><text clip-path="url(#clip.1+x)">a</text><g clip-path="url(#keep)"/></svg>'
  const out = stripLabelClipPaths(svg)
  assert.ok(!out.includes('clip.1+x') && !out.includes('unused'))
  assert.ok(out.includes('<clipPath id="keep">') && out.includes('<g clip-path="url(#keep)"/>'))
})

test('the treemap payload loses all 15 clipPaths and 22 references; prepareSvgForFigma applies it', () => {
  const raw = read('../fixtures/plugin/37-case-treemap-light.svg')
  assert.equal(count(raw, /<clipPath /g), 15)
  assert.equal(count(raw, /clip-path=/g), 22)
  const out = stripLabelClipPaths(raw)
  assert.equal(count(out, /<clipPath|clip-path=/g), 0)
  assert.equal(count(out, /<rect /g), count(raw, /<rect /g) - 15)
  assert.equal(count(out, /<tspan /g), count(raw, /<tspan /g))
  assert.equal(prepareSvgForFigma(raw), stripLabelClipPaths(raw), 'treemap has no markers: only the clip step changes it')
})

test('every other payload (examples, cases, 26 survey types, dark + light) has no clipPath and is returned untouched', () => {
  const dir = path.resolve(here, '../fixtures/plugin')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg') && !f.startsWith('37-')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  const survey = fs.readdirSync(path.join(dir, 'survey')).filter((f) => !f.startsWith('treemap')).map((f) => zlib.gunzipSync(fs.readFileSync(path.join(dir, 'survey', f))).toString('utf8'))
  assert.ok(files.length >= 20 && survey.length >= 40)
  for (const svg of [...files, ...survey]) assert.equal(stripLabelClipPaths(svg), svg)
})
