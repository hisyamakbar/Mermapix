import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { highlightMermaid } from '../../src/components/mermaidHighlighter.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const examplesDir = path.resolve(here, '../../src/examples')

// What the browser renders as text from the overlay <pre>.
const toText = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const examples = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.mmd'))
  .map((f) => [f, readFileSync(path.join(examplesDir, f), 'utf-8')])

for (const [name, source] of examples) {
  test(`highlighter text round-trips exactly for ${name}`, () => {
    const html = highlightMermaid(source)
    assert.equal(toText(html), source)
    assert.equal(html.split('\n').length, source.split('\n').length)
  })
}

test('highlighter never re-matches generated class names (string"> corruption)', () => {
  const src = '    string status "pending / paid / shipped"\n    uuid parent_id FK "null for root"'
  const html = highlightMermaid(src)
  assert.equal(toText(html), src)
  assert.doesNotMatch(html, /tok-<span/)
  assert.doesNotMatch(toText(html), /string">/)
  // spans are never nested
  assert.doesNotMatch(html, /<span[^>]*>[^<]*<span/)
})

test('highlighter tokenizes keys, types, arrows, comments', () => {
  const html = highlightMermaid('  USER ||--o{ ORDER : places %% note <x>')
  assert.match(html, /<span class="tok-arrow">\|\|--o\{<\/span>/)
  assert.match(html, /<span class="tok-comment">%% note &lt;x&gt;<\/span>/)
  const keys = highlightMermaid('    uuid order_id PK, FK')
  assert.match(keys, /<span class="tok-type">uuid<\/span>/)
  assert.match(keys, /<span class="tok-key">PK<\/span>, <span class="tok-key">FK<\/span>/)
})

test('highlighter escapes HTML in plain text and strings', () => {
  const src = 'A["<b>&x</b>"] --> B<script>'
  const html = highlightMermaid(src)
  assert.doesNotMatch(html, /<b>|<script>/)
  assert.equal(toText(html), src)
})
