// The decision behind the editor's error message for code that cannot render (src/utils/diagramSupport.ts).
// Pure, so the .ts file is imported directly. The list itself is checked against Mermaid in diagram-coverage.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIAGRAM_KEYWORDS,
  UNSUPPORTED_DIAGRAMS,
  diagramKeyword,
  explainRenderError,
  suggestKeyword,
  unsupportedDiagram,
} from '../../src/utils/diagramSupport.ts'

// What Mermaid 12 throws for an unknown first keyword.
const NO_TYPE = (code) => `No diagram type detected matching given configuration for text: ${code}`

test('diagramKeyword: the first word after frontmatter, directives and comments', () => {
  assert.equal(diagramKeyword('flowchart LR\n a-->b'), 'flowchart')
  assert.equal(diagramKeyword('  \n\n  sequenceDiagram\n A->>B: hi'), 'sequenceDiagram')
  assert.equal(diagramKeyword('stateDiagram-v2\n [*] --> A'), 'stateDiagram-v2')
  assert.equal(diagramKeyword('usecase-beta\nactor A'), 'usecase-beta')
  assert.equal(diagramKeyword('C4Context\n title x'), 'C4Context')
  assert.equal(diagramKeyword('pie showData title Pets\n "a": 1'), 'pie')
  assert.equal(diagramKeyword('---\ntitle: x\nconfig:\n  theme: dark\n---\nerDiagram\n A ||--o{ B : has'), 'erDiagram')
  assert.equal(diagramKeyword('%% a comment\n%%{init: {"theme":"dark"}}%%\n\nzenuml\n A.m()'), 'zenuml')
  assert.equal(diagramKeyword('%%{\n  init: {"theme":"dark"}\n}%%\ngantt\n title x'), 'gantt')
  assert.equal(diagramKeyword('﻿mindmap\n root'), 'mindmap')
  assert.equal(diagramKeyword('zenuml\r\n A.m()'), 'zenuml')
})

test('diagramKeyword: nothing to find gives an empty string', () => {
  assert.equal(diagramKeyword(''), '')
  assert.equal(diagramKeyword('   \n\n'), '')
  assert.equal(diagramKeyword('%% only a comment'), '')
  assert.equal(diagramKeyword('---\ntitle: x\n---\n'), '')
  assert.equal(diagramKeyword('--> a'), '')
  assert.equal(diagramKeyword('123 abc'), '')
})

test('a ZenUML diagram is refused by name, with the alternative', () => {
  const code = 'zenuml\n  title Order\n  Client->Server.pay() { return }'
  const message = explainRenderError(code, NO_TYPE(code))
  assert.match(message, /does not support ZenUML/)
  assert.match(message, /sequenceDiagram/)
  assert.doesNotMatch(message, /No diagram type detected/)
  // frontmatter, directives and comments before the keyword do not hide it
  assert.equal(explainRenderError('---\ntitle: x\n---\n%% c\nzenuml\n A.m()', NO_TYPE('x')), message)
  // whatever Mermaid threw: this type never renders
  assert.equal(explainRenderError(code, 'something else'), message)
})

test('unsupportedDiagram matches the first keyword only', () => {
  assert.equal(unsupportedDiagram('zenuml\n A.m()')?.id, 'zenuml')
  assert.equal(unsupportedDiagram('flowchart LR\n a[zenuml] --> b'), null)
  assert.equal(unsupportedDiagram('sequenceDiagram\n participant zenuml'), null)
  assert.equal(unsupportedDiagram('zenumlx\n A.m()'), null)
  assert.equal(unsupportedDiagram(''), null)
})

test('a misspelled keyword is not called unsupported and gets a suggestion', () => {
  const cases = [
    ['erdiagram\n A ||--o{ B : has', 'erDiagram'],
    ['sequencediagram\n A->>B: hi', 'sequenceDiagram'],
    ['sequence\n A->>B: hi', 'sequenceDiagram'],
    ['flowchat TD\n a-->b', 'flowchart'],
    ['classdiagram\n class A', 'classDiagram'],
    ['stateDiagram-v3\n [*] --> A', 'stateDiagram-v2'],
    ['usecase\n actor A', 'usecase-beta'],
    ['agentflow TB\n flow a\n end', 'agentflow-beta'],
    ['radar\n axis a', 'radar-beta'],
    ['gannt\n title x', 'gantt'],
    ['zenmul\n A.m()', null],
  ]
  for (const [code, suggestion] of cases) {
    const message = explainRenderError(code, NO_TYPE(code))
    const keyword = diagramKeyword(code)
    assert.match(message, new RegExp(`^"${keyword}" is not a Mermaid diagram type\\.`), code)
    assert.doesNotMatch(message, /does not support/, code)
    if (suggestion) assert.match(message, new RegExp(`Did you mean ${suggestion}\\?`), code)
    else assert.doesNotMatch(message, /Did you mean/, code)
  }
})

test('an unknown word with nothing close gives a generic message with examples', () => {
  const message = explainRenderError('foo\n a-->b', NO_TYPE('foo'))
  assert.equal(
    message,
    '"foo" is not a Mermaid diagram type. The first word of the code sets the type, for example flowchart, sequenceDiagram or erDiagram.',
  )
  // short words are not typos of "er", "pie", ...
  assert.equal(suggestKeyword('ab'), null)
  assert.equal(suggestKeyword('xyz'), null)
})

test('code that starts with no word says so', () => {
  for (const code of ['--> a', '123', '"quoted"']) {
    const message = explainRenderError(code, NO_TYPE(code))
    assert.match(message, /could not find a diagram type at the start of the code/)
  }
})

test('every other error passes through unchanged', () => {
  const parse = 'Parse error on line 3:\n...A-->\n-----^\nExpecting \'SEMI\', got \'EOF\''
  assert.equal(explainRenderError('flowchart LR\n A-->', parse), parse)
  assert.equal(explainRenderError('erDiagram\n A ||--o{', parse), parse)
  assert.equal(explainRenderError('foo\n a', 'Maximum text size in diagram exceeded'), 'Maximum text size in diagram exceeded')
})

test('suggestions exist for every supported keyword written in lower case', () => {
  for (const keywords of Object.values(DIAGRAM_KEYWORDS)) {
    for (const keyword of keywords) {
      const suggestion = suggestKeyword(keyword.toLowerCase())
      assert.ok(suggestion, `no suggestion for "${keyword.toLowerCase()}"`)
      const bare = (k) => k.toLowerCase().replace(/-(beta|v\d+)$/, '')
      assert.equal(bare(suggestion), bare(keyword), keyword)
    }
  }
})

test('messages follow the interface copy rules', () => {
  const messages = [
    ...UNSUPPORTED_DIAGRAMS.map((d) => d.message),
    explainRenderError('foo', NO_TYPE('foo')),
    explainRenderError('erdiagram', NO_TYPE('x')),
    explainRenderError('--> a', NO_TYPE('x')),
  ]
  for (const m of messages) {
    assert.doesNotMatch(m, /\bline\s+\d+/i, m) // the editor turns "line N" into an error badge
    assert.doesNotMatch(m, /!|\bplease\b|\boops\b|\bsorry\b|\byou (must|should|need)\b/i, m)
    assert.ok(m.length < 220, m)
  }
})
