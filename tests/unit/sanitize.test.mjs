import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeMermaidCode } from '../../src/utils/sanitize.ts'

test('strips standard ```mermaid ... ``` code block', () => {
  const input = `\`\`\`mermaid
erDiagram
    PORTRAIT ||--|{ REGION : "divided into"
    REGION ||--|{ FACET : "tessellated into"
\`\`\``
  const expected = `erDiagram
    PORTRAIT ||--|{ REGION : "divided into"
    REGION ||--|{ FACET : "tessellated into"`
  assert.equal(sanitizeMermaidCode(input), expected)
})

test('strips fenced code block embedded inside conversational AI text', () => {
  const input = `Here is your requested database schema:

\`\`\`mermaid
erDiagram
    USER ||--o{ ORDER : places
\`\`\`

Feel free to customize the fields as needed!`

  assert.equal(sanitizeMermaidCode(input), `erDiagram\n    USER ||--o{ ORDER : places`)
})

test('strips bare ``` ... ``` code block without language tag', () => {
  const input = `\`\`\`
flowchart TD
    A[Start] --> B[Finish]
\`\`\``
  assert.equal(sanitizeMermaidCode(input), `flowchart TD\n    A[Start] --> B[Finish]`)
})

test('strips unclosed leading ```mermaid fence gracefully', () => {
  const input = `\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello
`
  assert.equal(sanitizeMermaidCode(input), `sequenceDiagram\n    Alice->>Bob: Hello`)
})

test('leaves pure Mermaid code untouched without modifying formatting', () => {
  const input = `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains`
  assert.equal(sanitizeMermaidCode(input), input)
})

test('handles empty or whitespace strings', () => {
  assert.equal(sanitizeMermaidCode(''), '')
  assert.equal(sanitizeMermaidCode('   '), '')
})

test('sanitizes pipe characters inside quoted comments to prevent ERD parser breakage', () => {
  const input = `erDiagram
    PAYMENT {
        string provider "stripe | paypal"
    }`
  const expected = `erDiagram
    PAYMENT {
        string provider "stripe / paypal"
    }`
  assert.equal(sanitizeMermaidCode(input), expected)
})

