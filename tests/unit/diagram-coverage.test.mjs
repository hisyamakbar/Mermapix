// Coverage of Mermaid's diagram types (plan Phase 14.1).
//
// Mermaid is the source of truth: `mermaid.getRegisteredDiagramsMetadata()` lists every diagram id the
// installed version knows (after `initialize`, no DOM needed; `mermaid.detectType(code)` maps code to an
// id the same way). Every id must be either
//   - supported: listed in DIAGRAM_KEYWORDS (src/utils/diagramSupport.ts) and covered by at least one
//     fixture in tests/figma-fixtures/ or tests/official-samples/ whose code Mermaid detects as that id, or
//   - refused on purpose: listed in UNSUPPORTED_DIAGRAMS (same file, with the reason and the alternative), or
//   - internal: listed in INTERNAL_IDS below.
// The next Mermaid upgrade that adds a type turns this test red and says what to do.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mermaid from 'mermaid'
import {
  DIAGRAM_KEYWORDS,
  UNSUPPORTED_DIAGRAMS,
  NO_DIAGRAM_TYPE_PATTERN,
  diagramKeyword,
} from '../../src/utils/diagramSupport.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIRS = ['figma-fixtures', 'official-samples'].map((d) => path.resolve(here, '..', d))
const MERMAID_VERSION = JSON.parse(
  readFileSync(path.resolve(here, '../../node_modules/mermaid/package.json'), 'utf8'),
).version

// Ids Mermaid registers for its own use. Nobody writes a diagram of these types, so they need neither a
// fixture nor a refusal. Add to this list only for a type that is not a diagram.
const INTERNAL_IDS = {
  error: 'the diagram Mermaid draws for a syntax error',
  '---': 'the YAML frontmatter block, detected before the real type',
  info: 'prints the Mermaid version (`info`); not a diagram',
}

mermaid.initialize({ startOnLoad: false })
const registered = mermaid.getRegisteredDiagramsMetadata().map((d) => d.id)

const fixtures = FIXTURE_DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.mmd'))
    .map((f) => ({ name: `${path.basename(dir)}/${f}`, code: readFileSync(path.join(dir, f), 'utf8') })),
)

function detect(code) {
  try {
    return mermaid.detectType(code)
  } catch {
    return null
  }
}

const idsWithFixture = new Map() // id -> fixture names
for (const f of fixtures) {
  const id = detect(f.code)
  if (!id) continue
  idsWithFixture.set(id, [...(idsWithFixture.get(id) ?? []), f.name])
}

const unsupportedIds = new Set(UNSUPPORTED_DIAGRAMS.map((d) => d.id))

function newTypeMessage(id) {
  return [
    `Mermaid ${MERMAID_VERSION} registers the diagram type "${id}" and Mermapix has no fixture for it and does not list it as unsupported.`,
    'Decide, then do one of these:',
    `  1. Mermapix converts it: add "${id}": [<its header keywords>] to DIAGRAM_KEYWORDS in src/utils/diagramSupport.ts, put a fixture whose first line is one of those keywords into tests/figma-fixtures/ (or an official sample into tests/official-samples/), run it with node tests/export-fixtures.mjs, and add the converter work to the plan.`,
    `  2. Mermapix refuses it: add an entry with id "${id}", its keywords, the reason and a user message naming the alternative to UNSUPPORTED_DIAGRAMS in src/utils/diagramSupport.ts.`,
    `  3. It is not a diagram (Mermaid internal): add "${id}" with a comment to INTERNAL_IDS in tests/unit/diagram-coverage.test.mjs.`,
  ].join('\n')
}

test('the installed Mermaid registers diagram types in Node', () => {
  // If this fails, the enumeration itself broke (Mermaid changed how it registers diagrams): fix the test setup first.
  assert.ok(registered.length >= 30, `only ${registered.length} diagram ids registered: ${registered.join(', ')}`)
  assert.ok(registered.includes('flowchart-v2') && registered.includes('sequence') && registered.includes('er'))
})

test('every diagram type Mermaid registers is supported, refused on purpose or internal', () => {
  const unknown = registered.filter(
    (id) => !(id in INTERNAL_IDS) && !(id in DIAGRAM_KEYWORDS) && !unsupportedIds.has(id),
  )
  assert.deepEqual(unknown, [], unknown.map(newTypeMessage).join('\n\n'))
})

test('every supported diagram type has a fixture', () => {
  const missing = Object.keys(DIAGRAM_KEYWORDS).filter((id) => !idsWithFixture.has(id))
  assert.deepEqual(
    missing,
    [],
    `No fixture in tests/figma-fixtures/ or tests/official-samples/ is detected by Mermaid as: ${missing.join(', ')}.\n` +
      'Add one whose first line is one of its keywords in DIAGRAM_KEYWORDS (src/utils/diagramSupport.ts), or move the type to UNSUPPORTED_DIAGRAMS.',
  )
})

test('every supported keyword is detected by Mermaid as its type', () => {
  for (const [id, keywords] of Object.entries(DIAGRAM_KEYWORDS)) {
    assert.ok(registered.includes(id), `"${id}" is in DIAGRAM_KEYWORDS but Mermaid ${MERMAID_VERSION} no longer registers it: remove it (or rename it) in src/utils/diagramSupport.ts.`)
    for (const keyword of keywords) {
      assert.equal(detect(`${keyword}\n  x`), id, `Mermaid ${MERMAID_VERSION} detects "${keyword}" as "${detect(`${keyword}\n  x`)}", not "${id}": fix DIAGRAM_KEYWORDS.`)
    }
  }
})

test('the first keyword of every fixture is a listed keyword of the type Mermaid detects', () => {
  for (const f of fixtures) {
    const id = detect(f.code)
    assert.ok(id, `${f.name}: Mermaid ${MERMAID_VERSION} does not detect a diagram type (is it a type Mermapix must refuse?)`)
    assert.ok(
      DIAGRAM_KEYWORDS[id]?.includes(diagramKeyword(f.code)),
      `${f.name}: first keyword "${diagramKeyword(f.code)}" is not among the keywords of "${id}" in DIAGRAM_KEYWORDS (src/utils/diagramSupport.ts)`,
    )
  }
})

test('the lists do not overlap and every type carries its reasons', () => {
  for (const id of Object.keys(DIAGRAM_KEYWORDS)) {
    assert.ok(!unsupportedIds.has(id), `"${id}" is both supported and unsupported`)
    assert.ok(!(id in INTERNAL_IDS), `"${id}" is both supported and internal`)
  }
  for (const id of Object.keys(INTERNAL_IDS)) assert.ok(registered.includes(id), `INTERNAL_IDS lists "${id}" but Mermaid no longer registers it: remove it.`)
  for (const d of UNSUPPORTED_DIAGRAMS) {
    assert.ok(d.keywords.length > 0 && d.reason.trim() && d.message.trim(), `${d.id}: keywords, reason and message are required`)
    assert.doesNotMatch(d.message, /\bline\s+\d+/i, `${d.id}: the message must not look like a syntax error with a line number`)
  }
})

test('an unsupported type really is one Mermaid cannot render here', async () => {
  for (const d of UNSUPPORTED_DIAGRAMS) {
    for (const keyword of d.keywords) {
      const id = detect(`${keyword}\n  x`)
      assert.equal(
        id,
        null,
        `Mermaid ${MERMAID_VERSION} now detects "${keyword}" (as "${id}"): the type may be supported now. Re-check "${d.id}" in UNSUPPORTED_DIAGRAMS: add a fixture and move it to DIAGRAM_KEYWORDS, or keep refusing it and say why in its reason.`,
      )
      await assert.rejects(() => mermaid.parse(`${keyword}\n  x`), NO_DIAGRAM_TYPE_PATTERN, `Mermaid's error for "${keyword}" no longer matches NO_DIAGRAM_TYPE_PATTERN`)
    }
  }
})

test('both fixture folders exist and are not empty', () => {
  for (const dir of FIXTURE_DIRS) {
    assert.ok(existsSync(dir), `${dir} is missing`)
    assert.ok(readdirSync(dir).some((f) => f.endsWith('.mmd')), `${dir} has no .mmd files`)
  }
})
