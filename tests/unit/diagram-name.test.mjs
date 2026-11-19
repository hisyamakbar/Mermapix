// Naming of a newly inserted Figma diagram layer from its Mermaid code (src/plugin/diagramName.ts).
// Pure, so the .ts file is imported directly.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_DIAGRAM_NAME, diagramName } from '../../src/plugin/diagramName.ts'

test('default name', () => {
  assert.equal(DEFAULT_DIAGRAM_NAME, 'Mermapix Diagram')
})

test('frontmatter title: plain, quoted, nested config title ignored', () => {
  assert.equal(diagramName('---\ntitle: Shop schema\n---\nerDiagram\n  A ||--o{ B : has'), 'Shop schema')
  assert.equal(diagramName('---\ntitle: "Quoted: name"\n---\nflowchart LR\n  a-->b'), 'Quoted: name')
  assert.equal(diagramName("---\ntitle: 'Single'\n---\nflowchart LR\n  a-->b"), 'Single')
  assert.equal(diagramName('---\nconfig:\n  title: Nested\n---\nflowchart LR\n  a-->b'), 'Flowchart')
  assert.equal(diagramName('---\nconfig:\n  theme: dark\ntitle: Top\n---\nflowchart LR\n  a-->b'), 'Top')
  assert.equal(diagramName('---\ntitle: Plain # comment\n---\nflowchart LR'), 'Plain')
  assert.equal(diagramName('---\ntitle:\n---\nerDiagram\n  A ||--o{ B : has'), 'ER diagram')
})

test('frontmatter title wins over a title directive and accTitle', () => {
  assert.equal(diagramName('---\ntitle: Front\n---\ngantt\n  title Directive\n  accTitle: Acc'), 'Front')
})

test('title directive per supported type', () => {
  const cases = [
    ['sequenceDiagram\n  title Checkout flow\n  A->>B: hi', 'Checkout flow'],
    ['gantt\n  title Release plan\n  dateFormat YYYY-MM-DD', 'Release plan'],
    ['journey\n  title My working day\n  section Go', 'My working day'],
    ['quadrantChart\n  title Reach and engagement\n  x-axis Low --> High', 'Reach and engagement'],
    ['timeline\n  title History\n  2002 : LinkedIn', 'History'],
    ['C4Context\n  title System Context diagram', 'System Context diagram'],
    ['C4Container\n  title Containers', 'Containers'],
    ['C4Component\n  title Components', 'Components'],
    ['C4Dynamic\n  title Dynamic', 'Dynamic'],
    ['C4Deployment\n  title Deployment', 'Deployment'],
    ['cynefin-beta\n  title Situations\n  complex', 'Situations'],
    ['wardley-beta\n  title Tea shop\n  anchor Business [0.95, 0.63]', 'Tea shop'],
    ['railroad-peg-beta\n    title Calculator Grammar\n    A <- B ;', 'Calculator Grammar'],
    ['railroad-ebnf-beta\n    title Greeting Grammar\n    G = "hello" ;', 'Greeting Grammar'],
    ['sequenceDiagram\n  title: With colon\n  A->>B: hi', 'With colon'],
  ]
  for (const [code, expected] of cases) assert.equal(diagramName(code), expected, code)
})

test('pie inline forms and a title on its own line', () => {
  assert.equal(diagramName('pie title Pets\n  "Dogs" : 386'), 'Pets')
  assert.equal(diagramName('pie showData title Pets\n  "Dogs" : 386'), 'Pets')
  assert.equal(diagramName('pie showData\n  title Pets at home\n  "Dogs" : 386'), 'Pets at home')
  assert.equal(diagramName('pie\n  "Dogs" : 386'), 'Pie chart')
})

test('xychart quoted title', () => {
  assert.equal(diagramName('xychart-beta\n  title "Sales"\n  x-axis [jan, feb]'), 'Sales')
  assert.equal(diagramName('xychart\n  title "Sales 2026"\n  x-axis [jan, feb]'), 'Sales 2026')
  assert.equal(diagramName('xychart-beta\n  x-axis [jan, feb]'), 'XY chart')
})

test('title is never read for types without the directive', () => {
  const erd = 'erDiagram\n  POST {\n    title varchar\n    string title\n    string body\n  }'
  assert.equal(diagramName(erd), 'ER diagram')
  assert.equal(diagramName('erDiagram\n  POST {\n    string title\n  }'), 'ER diagram')
  assert.equal(diagramName('flowchart LR\n  title["title"] --> b'), 'Flowchart')
  assert.equal(diagramName('flowchart LR\n  title Foo'), 'Flowchart')
  assert.equal(diagramName('classDiagram\n  class A {\n    title\n  }\n  title Foo'), 'Class diagram')
  assert.equal(diagramName('stateDiagram-v2\n  title Foo\n  [*] --> A'), 'State diagram')
  assert.equal(diagramName('mindmap\n  root\n    title Foo'), 'Mindmap')
})

test('only a line whose first token is exactly title counts', () => {
  assert.equal(diagramName('gantt\n  titled Foo\n  subtitle Bar\n  dateFormat YYYY'), 'Gantt chart')
  assert.equal(diagramName('gantt\n  Write title : a1, 2026-01-01, 3d'), 'Gantt chart')
})

test('accTitle on any type', () => {
  assert.equal(diagramName('flowchart LR\n  accTitle: Login steps\n  a --> b'), 'Login steps')
  assert.equal(diagramName('erDiagram\n  accTitle: Shop tables\n  A ||--o{ B : has'), 'Shop tables')
  assert.equal(diagramName('gantt\n  accTitle: Acc\n  title Real\n'), 'Real')
})

test('comments and init directives before the header', () => {
  assert.equal(diagramName('%% a comment\n\n%%{init: {"theme": "dark"}}%%\nflowchart TD\n  a-->b'), 'Flowchart')
  assert.equal(diagramName('%%{init:\n{"theme": "dark"}\n}%%\nerDiagram\n  A ||--o{ B : has'), 'ER diagram')
  assert.equal(diagramName('  %% note\n  sequenceDiagram\n  title After comment'), 'After comment')
  assert.equal(diagramName('---\nconfig:\n  theme: dark\n---\n%% c\nstateDiagram-v2\n  [*] --> A'), 'State diagram')
})

test('CRLF', () => {
  assert.equal(diagramName('---\r\ntitle: Win\r\n---\r\nflowchart LR\r\n  a-->b\r\n'), 'Win')
  assert.equal(diagramName('gantt\r\n  title Win plan\r\n'), 'Win plan')
  assert.equal(diagramName('erDiagram\r\n  A ||--o{ B : has\r\n'), 'ER diagram')
})

test('cleanup: quotes, trailing %% comment, whitespace', () => {
  assert.equal(diagramName('gantt\n  title   "  Spaced   out  "  %% trailing'), 'Spaced out')
  assert.equal(diagramName('timeline\n  title Plan %% note'), 'Plan')
  assert.equal(diagramName('gantt\n  title ""\n  accTitle: Fallback'), 'Fallback')
  assert.equal(diagramName('gantt\n  title\n'), 'Gantt chart')
})

test('long names are cut to 60 characters with an ellipsis', () => {
  const long = 'x'.repeat(100)
  const name = diagramName(`---\ntitle: ${long}\n---\nflowchart LR`)
  assert.equal(Array.from(name).length, 60)
  assert.equal(name, 'x'.repeat(59) + '…')
  const exact = 'y'.repeat(60)
  assert.equal(diagramName(`gantt\n  title ${exact}`), exact)
  // not cut in the middle of a surrogate pair
  const emoji = diagramName(`gantt\n  title ${'\u{1F600}'.repeat(80)}`)
  assert.equal(Array.from(emoji).length, 60)
  assert.equal(emoji, '\u{1F600}'.repeat(59) + '…')
  assert.doesNotMatch(emoji, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
})

test('type fallback names', () => {
  const cases = {
    'flowchart LR\n a-->b': 'Flowchart',
    'graph TD\n a-->b': 'Flowchart',
    'graph TD;\n a-->b;': 'Flowchart',
    'erDiagram\n A ||--o{ B : has': 'ER diagram',
    'sequenceDiagram\n A->>B: hi': 'Sequence diagram',
    'zenuml\n A.m()': 'Sequence diagram',
    'classDiagram\n class A': 'Class diagram',
    'classDiagram-v2\n class A': 'Class diagram',
    'stateDiagram\n [*] --> A': 'State diagram',
    'stateDiagram-v2\n [*] --> A': 'State diagram',
    'gantt\n section A': 'Gantt chart',
    'pie\n "a": 1': 'Pie chart',
    'journey\n section A': 'User journey',
    'gitGraph\n commit': 'Git graph',
    'mindmap\n root': 'Mindmap',
    'timeline\n 2002 : a': 'Timeline',
    'quadrantChart\n x-axis a --> b': 'Quadrant chart',
    'xychart-beta\n x-axis [a]': 'XY chart',
    'sankey-beta\na,b,1': 'Sankey diagram',
    'sankey\na,b,1': 'Sankey diagram',
    'requirementDiagram\n requirement r {}': 'Requirement diagram',
    'C4Context\n Person(a, "A")': 'C4 diagram',
    'C4Container\n Person(a, "A")': 'C4 diagram',
    'block-beta\n a b': 'Block diagram',
    'packet-beta\n 0-15: "A"': 'Packet diagram',
    'kanban\n Todo': 'Kanban board',
    'architecture-beta\n group a(cloud)[A]': 'Architecture diagram',
    'radar-beta\n axis a': 'Radar chart',
    'treemap-beta\n "A"': 'Treemap',
    'treemap\n "A"': 'Treemap',
    'venn-beta\n set A': 'Venn diagram',
    'swimlane-beta\n A --> B': 'Swimlane diagram',
    'ishikawa-beta\n Effect': 'Ishikawa diagram',
    'treeView-beta\n "docs"': 'Tree view',
    'eventmodeling\n tf 01 cmd A': 'Event model',
    'railroad-peg-beta\n A <- B ;': 'Railroad diagram',
  }
  for (const [code, expected] of Object.entries(cases)) assert.equal(diagramName(code), expected, code)
})

test('unknown types are humanized', () => {
  assert.equal(diagramName('venn-beta\n set A'), 'Venn diagram')
  assert.equal(diagramName('fooBarDiagram-v2\n x'), 'Foo bar diagram')
  assert.equal(diagramName('someNewChart-beta\n x'), 'Some new chart diagram')
  assert.equal(diagramName('whatever\n x'), 'Whatever diagram')
})

test('empty, whitespace and comment-only code give the default name', () => {
  assert.equal(diagramName(''), DEFAULT_DIAGRAM_NAME)
  assert.equal(diagramName('   \n\t\n'), DEFAULT_DIAGRAM_NAME)
  assert.equal(diagramName('%% only a comment'), DEFAULT_DIAGRAM_NAME)
  assert.equal(diagramName('%% one\n%%{init: {"theme":"dark"}}%%\n\n%% two\n'), DEFAULT_DIAGRAM_NAME)
  assert.equal(diagramName('---\nconfig:\n  theme: dark\n---\n'), DEFAULT_DIAGRAM_NAME)
  assert.equal(diagramName('123 not a header'), DEFAULT_DIAGRAM_NAME)
})

test('generated ERD from DBML or SQL is named ER diagram', () => {
  const generated = [
    'erDiagram',
    '    users {',
    '        int id PK',
    '        varchar title',
    '    }',
    '    posts {',
    '        int id PK',
    '        string title',
    '        int user_id FK',
    '    }',
    '    users ||--o{ posts : "user_id"',
    '',
  ].join('\n')
  assert.equal(diagramName(generated), 'ER diagram')
})

test('never throws on odd input', () => {
  const odd = [
    '---',
    '---\n',
    '---\ntitle:',
    '---\ntitle',
    '---\n---\n',
    '%%{',
    '%%{init:',
    '%%',
    'title',
    'title: x',
    '\u0000\u0001',
    '\uD800',
    '\u{1F600}\u{1F4A5}你好مرحبا',
    '\r',
    '\r\r\n\n',
    '-'.repeat(10000),
    'gantt\n' + 'title '.repeat(5000),
    '"',
    "'''",
    'pie title',
    'pie title "',
  ]
  for (const s of odd) assert.equal(typeof diagramName(s), 'string', JSON.stringify(s))
  for (let i = 0; i < 200; i++) {
    let s = ''
    const n = Math.floor(Math.random() * 60)
    for (let j = 0; j < n; j++) s += String.fromCodePoint(Math.floor(Math.random() * 0x2fff))
    const name = diagramName(s)
    assert.equal(typeof name, 'string')
    assert.ok(name.length > 0)
  }
  assert.equal(diagramName(undefined), DEFAULT_DIAGRAM_NAME)
  assert.equal(diagramName(null), DEFAULT_DIAGRAM_NAME)
})

test('every fixture and example yields a usable name', () => {
  const dirs = ['tests/figma-fixtures', 'src/examples']
  let count = 0
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.mmd'))) {
      const name = diagramName(readFileSync(join(dir, file), 'utf8'))
      assert.ok(name.length > 0, file)
      assert.ok(Array.from(name).length <= 60, file)
      assert.equal(name, name.trim(), file)
      assert.equal(name === DEFAULT_DIAGRAM_NAME, false, `${file} fell back to the default name`)
      count++
    }
  }
  assert.ok(count >= 40)
})
