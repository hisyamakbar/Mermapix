// Phase 12: writing text edits made in Figma back into Mermaid source (src/plugin/sourcePatch.ts) and the
// wording around them (src/plugin/changeSummary.ts). Both are pure, so the .ts files are imported directly.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { applyTextChanges } from '../../src/plugin/sourcePatch.ts'
import {
  CONFIRM_APPLIED_TEXT,
  CONFIRM_TEXT,
  describeApplyResult,
  describeConfirm,
  isNothingLeft,
  remainingChanges,
} from '../../src/plugin/changeSummary.ts'

const example = (name) => fs.readFileSync(new URL(`../../src/examples/${name}.mmd`, import.meta.url), 'utf8')

const attr = (entity, row, col, from, to, part) => ({
  from,
  to,
  context: { kind: 'erd-attr', entity, row, col, ...(part === undefined ? {} : { part }) },
})
const entity = (name, to) => ({ from: name, to, context: { kind: 'erd-entity', entity: name } })
const node = (id, from, to) => ({ from, to, context: { kind: 'node', id } })
const cluster = (id, from, to) => ({ from, to, context: { kind: 'cluster', id } })
const plain = (from, to) => ({ from, to })

/** Apply one change and expect it to land. */
function patched(source, change) {
  const r = applyTextChanges(source, [change])
  assert.deepEqual(r.unresolved, [], `expected ${JSON.stringify(change)} to apply`)
  assert.deepEqual(r.applied, [change])
  return r.source
}

/** Apply one change and expect the source to stay untouched. */
function untouched(source, change) {
  const r = applyTextChanges(source, [change])
  assert.equal(r.source, source)
  assert.deepEqual(r.applied, [])
  assert.deepEqual(r.unresolved, [change])
}

// ---------------------------------------------------------------- ERD: columns

test('erd column rename changes only the table it belongs to, even when the name repeats', () => {
  const src = example('erd')
  // `id` is the first column of CUSTOMER, ORDER, PRODUCT, CATEGORY and PAYMENT.
  const out = patched(src, attr('ORDER', 0, 'name', 'id', 'order_pk'))
  assert.equal(out, src.replace('  ORDER {\n    uuid id PK', '  ORDER {\n    uuid order_pk PK'))
  const out2 = patched(src, attr('PRODUCT', 0, 'name', 'id', 'product_id'))
  assert.equal(out2, src.replace('  PRODUCT {\n    uuid id PK', '  PRODUCT {\n    uuid product_id PK'))
})

test('erd type, key and comment edits', () => {
  const src = example('erd')
  assert.equal(
    patched(src, attr('CUSTOMER', 2, 'type', 'string', 'varchar(255)')),
    src.replace('string full_name', 'varchar(255) full_name'),
  )
  assert.equal(
    patched(src, attr('PRODUCT', 2, 'key', 'UK', 'PK')),
    src.replace('string sku UK', 'string sku PK'),
  )
  assert.equal(
    patched(src, attr('CUSTOMER', 3, 'comment', 'optional', 'optional, nullable')),
    src.replace('"optional"', '"optional, nullable"'),
  )
  // Quotes inside a comment become an entity code, never a bare quote.
  assert.equal(
    patched(src, attr('CUSTOMER', 1, 'comment', 'login, unique', 'login "unique"')),
    src.replace('"login, unique"', '"login #quot;unique#quot;"'),
  )
})

test('erd multi-key cell: part selects one key', () => {
  const src = example('erd')
  assert.equal(
    patched(src, attr('ORDER_ITEM', 0, 'key', 'FK', 'UK', 1)),
    src.replace('uuid order_id PK, FK', 'uuid order_id PK, UK'),
  )
  assert.equal(
    patched(src, attr('PAYMENT', 1, 'key', 'UK', 'PK', 1)),
    src.replace('uuid order_id FK, UK', 'uuid order_id FK, PK'),
  )
  // Wrong part: the key at that position is not the stored `from`.
  untouched(src, attr('ORDER_ITEM', 0, 'key', 'FK', 'UK', 0))
  // Would duplicate a key; not a known key; no part on a multi-key cell.
  untouched(src, attr('ORDER_ITEM', 0, 'key', 'FK', 'PK', 1))
  untouched(src, attr('ORDER_ITEM', 0, 'key', 'FK', 'XX', 1))
  untouched(src, attr('ORDER_ITEM', 0, 'key', 'FK', 'UK'))
})

test('erd multi-key cell without part: the edit describes the whole cell (the plugin renders it as one text)', () => {
  const src = example('erd')
  // As generated the cell reads `PK,FK`; spacing and case in either text do not matter.
  assert.equal(
    patched(src, attr('ORDER_ITEM', 0, 'key', 'PK,FK', 'PK')),
    src.replace('uuid order_id PK, FK', 'uuid order_id PK'),
  )
  assert.equal(
    patched(src, attr('PAYMENT', 1, 'key', 'FK, UK', 'pk,fk')),
    src.replace('uuid order_id FK, UK', 'uuid order_id PK, FK'),
  )
  // The stored text is not the whole key list at that position; not a key list; a repeated key.
  untouched(src, attr('ORDER_ITEM', 0, 'key', 'PK,UK', 'PK'))
  untouched(src, attr('ORDER_ITEM', 0, 'key', 'PK,FK', 'primary'))
  untouched(src, attr('ORDER_ITEM', 0, 'key', 'PK,FK', 'PK, PK'))
})

test('erd: a stale position or an unsafe value is never applied', () => {
  const src = example('erd')
  untouched(src, attr('ORDER', 0, 'name', 'email', 'x'))
  untouched(src, attr('ORDER', 99, 'name', 'id', 'x'))
  untouched(src, attr('NOPE', 0, 'name', 'id', 'x'))
  untouched(src, attr('ORDER', 0, 'name', 'id', 'order id'))
  untouched(src, attr('ORDER', 0, 'type', 'uuid', 'big int'))
  untouched(src, attr('ORDER', 0, 'name', 'id', '9lives'))
  untouched(src, attr('ORDER', 0, 'comment', 'x', 'y'))
  untouched(src, attr('CUSTOMER', 4, 'comment', 'whatever', 'y'))
})

test('erd attribute blocks with comments and blank lines count only real rows', () => {
  const src = [
    'erDiagram',
    '  USER {',
    '    %% identity',
    '    uuid id PK',
    '',
    '    %% contact',
    '    string email UK "login"',
    '',
    '    string name',
    '  }',
    '  ACCOUNT {',
    '    string name',
    '  }',
    '',
  ].join('\n')
  assert.equal(
    patched(src, attr('USER', 2, 'name', 'name', 'full_name')),
    src.replace('    string name\n  }\n  ACCOUNT', '    string full_name\n  }\n  ACCOUNT'),
  )
  assert.equal(
    patched(src, attr('ACCOUNT', 0, 'name', 'name', 'title')),
    src.replace('ACCOUNT {\n    string name', 'ACCOUNT {\n    string title'),
  )
  assert.equal(
    patched(src, attr('USER', 1, 'comment', 'login', 'sign-in')),
    src.replace('"login"', '"sign-in"'),
  )
  // Row 1 of USER is `email`, not `name`.
  untouched(src, attr('USER', 1, 'name', 'name', 'x'))
})

// ---------------------------------------------------------------- ERD: entities

test('erd entity rename covers the block header and every relationship, as a whole token', () => {
  const src = example('erd')
  const out = patched(src, entity('ORDER', 'PURCHASE'))
  assert.equal(
    out,
    src
      .replace('CUSTOMER ||--o{ ORDER : places', 'CUSTOMER ||--o{ PURCHASE : places')
      .replace('ORDER ||--|{ ORDER_ITEM : contains', 'PURCHASE ||--|{ ORDER_ITEM : contains')
      .replace('ORDER ||--o| PAYMENT', 'PURCHASE ||--o| PAYMENT')
      .replace('  ORDER {', '  PURCHASE {'),
  )
  // ORDER_ITEM, order_id and the column named like the entity text are untouched.
  assert.match(out, /ORDER_ITEM \{/)
  assert.match(out, /uuid order_id PK, FK/)
})

test('erd entity rename: both sides of a self reference, never inside labels or other names', () => {
  const src = example('erd')
  const out = patched(src, entity('CATEGORY', 'GROUP'))
  assert.match(out, /^ {2}GROUP \|o--o\{ GROUP : "parent of"$/m)
  assert.match(out, /^ {2}GROUP \{$/m)
  assert.match(out, /^ {2}GROUP \|\|--o\{ PRODUCT : groups$/m)
  assert.match(out, /uuid category_id FK/)
  const labelCase = 'erDiagram\n  A ||--o{ B : A\n  A {\n    string A\n  }\n'
  assert.equal(
    patched(labelCase, entity('A', 'Z')),
    'erDiagram\n  Z ||--o{ B : A\n  Z {\n    string A\n  }\n',
  )
})

test('erd entity rename: names that need quotes, collisions and unknown references', () => {
  const src = example('erd')
  assert.equal(
    patched(src, entity('PAYMENT', 'Card payment')),
    src.replace('ORDER ||--o| PAYMENT', 'ORDER ||--o| "Card payment"').replace('  PAYMENT {', '  "Card payment" {'),
  )
  untouched(src, entity('ORDER', 'PAYMENT')) // would merge two tables
  untouched(src, entity('ORDER', 'line1\nline2'))
  untouched(src, entity('MISSING', 'X'))
  // A reference the structural pass does not understand blocks the rename instead of leaving it half done.
  const words = 'erDiagram\n  A one or more to zero or one B : r\n  A {\n    string x\n  }\n'
  untouched(words, entity('A', 'Z'))
})

test('erd alias entities: the title is the alias, relationships keep using the id', () => {
  const src = [
    'erDiagram',
    '  p["Person"] {',
    '    string name',
    '    int age',
    '  }',
    '  a[Address] {',
    '    string street',
    '  }',
    '  p ||--o{ a : lives',
    '',
  ].join('\n')
  assert.equal(patched(src, entity('Person', 'Human being')), src.replace('"Person"', '"Human being"'))
  assert.equal(patched(src, entity('Address', 'Place')), src.replace('a[Address]', 'a[Place]'))
  assert.equal(patched(src, entity('Address', 'Home (main)')), src.replace('a[Address]', 'a["Home (main)"]'))
  assert.equal(
    patched(src, attr('Person', 1, 'name', 'age', 'years')),
    src.replace('int age', 'int years'),
  )
  // `p` is the id, not the rendered title.
  untouched(src, entity('p', 'x'))
})

test('erd generic rule: a relationship label only', () => {
  const src = example('erd')
  assert.equal(patched(src, plain('places', 'orders')), src.replace(': places', ': orders'))
  assert.equal(patched(src, plain('ordered as', 'bought as')), src.replace('"ordered as"', '"bought as"'))
  assert.equal(patched(src, plain('contains', 'has several')), src.replace(': contains', ': "has several"'))
  untouched(src, plain('status', 'state')) // a column name: needs the erd-attr context
  untouched(src, plain('PRODUCT', 'ITEM')) // an entity: needs the erd-entity context
})

// ---------------------------------------------------------------- flowchart: nodes

const SHAPES = [
  ['a[Plain]', 'a', 'Plain'],
  ['b(Round)', 'b', 'Round'],
  ['c{Choice}', 'c', 'Choice'],
  ['d>Flag]', 'd', 'Flag'],
  ['e[[Sub]]', 'e', 'Sub'],
  ['f((Circle))', 'f', 'Circle'],
  ['g[(Store)]', 'g', 'Store'],
  ['h{{Hex}}', 'h', 'Hex'],
  ['i([Stadium])', 'i', 'Stadium'],
  ['j[/Para/]', 'j', 'Para'],
  ['k["Quoted one"]', 'k', 'Quoted one'],
  ['l(["Stadium quoted"])', 'l', 'Stadium quoted'],
  ['m[/"Slanted quoted"/]', 'm', 'Slanted quoted'],
  ['n@{ shape: rect, label: "Brace label" }', 'n', 'Brace label'],
  ['o@{ shape: rect, label: Brace bare }', 'o', 'Brace bare'],
]
const SHAPE_SOURCE = `flowchart TD\n${SHAPES.map(([def]) => `  ${def}`).join('\n')}\n  a --> b\n  b --> c\n`

test('flowchart label rename in every shape syntax keeps the shape and the quoting style', () => {
  for (const [def, id, label] of SHAPES) {
    const out = patched(SHAPE_SOURCE, node(id, label, 'Renamed'))
    assert.equal(out, SHAPE_SOURCE.replace(def, def.replace(label, 'Renamed')), def)
  }
})

test('flowchart node context picks the node by id when two nodes share a label', () => {
  const src = 'flowchart LR\n  a[Done] --> b["Done"]\n  b --> c[Done]\n'
  assert.equal(patched(src, node('b', 'Done', 'Finished')), 'flowchart LR\n  a[Done] --> b["Finished"]\n  b --> c[Done]\n')
  assert.equal(patched(src, node('c', 'Done', 'Finished')), 'flowchart LR\n  a[Done] --> b["Done"]\n  b --> c[Finished]\n')
  // Without the id the same text is ambiguous.
  untouched(src, plain('Done', 'Finished'))
  // An id that does not carry that label: nothing to patch, and the label is ambiguous anyway.
  untouched(src, node('zzz', 'Done', 'Finished'))
})

test('flowchart node context falls through to the generic rule when the id has no matching definition', () => {
  const src = 'flowchart LR\n  a[Start] --> b[Stop]\n  b --> Alone\n'
  assert.equal(patched(src, node('x', 'Stop', 'End here')), src.replace('b[Stop]', 'b[End here]'))
  // Node defined later than its first mention: the definition is still found by id.
  assert.equal(patched(src, node('Alone', 'Alone', 'Solo')), src.replace('b --> Alone', 'b --> Solo'))
})

test('flowchart: unsafe new text is made safe, or left unresolved', () => {
  const src = 'flowchart TD\n  a[Plain] --> b["Quoted"]\n  c{Choice} --> d\n'
  assert.equal(patched(src, node('a', 'Plain', 'Say (hi)')), src.replace('a[Plain]', 'a["Say (hi)"]'))
  assert.equal(patched(src, node('a', 'Plain', 'x | y')), src.replace('a[Plain]', 'a["x | y"]'))
  assert.equal(patched(src, node('a', 'Plain', 'end')), src.replace('a[Plain]', 'a["end"]'))
  assert.equal(patched(src, node('a', 'Plain', 'a < b')), src.replace('a[Plain]', 'a["a #lt; b"]'))
  assert.equal(
    patched(src, node('b', 'Quoted', 'He said "hi"')),
    src.replace('b["Quoted"]', 'b["He said #quot;hi#quot;"]'),
  )
  assert.equal(
    patched(src, node('b', 'Quoted', 'two\nlines')),
    src.replace('b["Quoted"]', 'b["two<br/>lines"]'),
  )
  assert.equal(
    patched(src, node('c', 'Choice', 'Is it\nready?')),
    src.replace('c{Choice}', 'c{"Is it<br/>ready?"}'),
  )
  untouched(src, node('b', 'Quoted', '`markdown`'))
})

test('flowchart: empty new text and unchanged text', () => {
  const src = 'flowchart TD\n  a[Plain] --> b[Other]\n'
  untouched(src, node('a', 'Plain', ''))
  untouched(src, node('a', 'Plain', '   \n  '))
  untouched(src, plain('Plain', ''))
  for (const same of [plain('Plain', 'Plain'), plain('Plain', ' Plain '), plain('Plain Text', 'Plain\nText')]) {
    const r = applyTextChanges(src, [same])
    assert.equal(r.source, src)
    assert.deepEqual(r.applied, [])
    assert.deepEqual(r.unresolved, [])
  }
})

test('flowchart subgraph titles, by id and as a bare title', () => {
  const src = 'flowchart TD\n  subgraph S1["Home"]\n    n1["Home"]\n  end\n  subgraph S2[Admin]\n    n2[Panel]\n  end\n  subgraph Lonely title\n    n3[x]\n  end\n'
  assert.equal(patched(src, cluster('S1', 'Home', 'Start')), src.replace('S1["Home"]', 'S1["Start"]'))
  assert.equal(patched(src, node('n1', 'Home', 'Start')), src.replace('n1["Home"]', 'n1["Start"]'))
  assert.equal(patched(src, cluster('S2', 'Admin', 'Back office')), src.replace('S2[Admin]', 'S2[Back office]'))
  assert.equal(patched(src, cluster('x', 'Lonely title', 'Alone now')), src.replace('subgraph Lonely title', 'subgraph Alone now'))
  untouched(src, plain('Home', 'Start')) // two places
  untouched(src, cluster('x', 'Lonely title', 'Has (brackets)'))
})

test('flowchart edge labels: repeated is unresolved, unique is applied', () => {
  const src = 'flowchart TD\n  a -->|Yes| b\n  a -->|Yes| c\n  a -->|no| d\n  b -- maybe --> e\n  c -. later .-> e\n'
  untouched(src, plain('Yes', 'Sure'))
  assert.equal(patched(src, plain('no', 'never')), src.replace('|no|', '|never|'))
  assert.equal(patched(src, plain('no', 'not "now"')), src.replace('|no|', '|"not #quot;now#quot;"|'))
  assert.equal(patched(src, plain('maybe', 'perhaps')), src.replace('-- maybe -->', '-- perhaps -->'))
  assert.equal(patched(src, plain('later', 'much later')), src.replace('-. later .->', '-. much later .->'))
  // The text is also a substring of a longer label: not a complete label, so never matched.
  const partial = 'flowchart TD\n  a[Show error with line number] --> b[Other]\n'
  untouched(partial, plain('Show error', 'Hide error'))
})

test('flowchart generic rule respects token boundaries and ignores comments', () => {
  const src = 'flowchart TD\n  A[order_id] --> B[id]\n'
  assert.equal(patched(src, plain('id', 'ident')), src.replace('B[id]', 'B[ident]'))
  const withComment = 'flowchart TD\n  %% Old is the first label\n  A[Old] --> B[Keep]\n  %% Old again\n'
  assert.equal(patched(withComment, plain('Old', 'New')), withComment.replace('A[Old]', 'A[New]'))
  untouched('flowchart TD\n  %% Old\n', plain('Old', 'New'))
})

test('<br> and wrapped labels match, and newlines are written as <br/>', () => {
  const src = 'flowchart TD\n  a["First<br/>Second line"] --> b["a long label that Mermaid wrapped"]\n'
  assert.equal(
    patched(src, plain('First\nSecond line', 'First\nThird line')),
    src.replace('First<br/>Second line', 'First<br/>Third line'),
  )
  assert.equal(
    patched(src, plain('a long label\nthat Mermaid wrapped', 'short')),
    src.replace('a long label that Mermaid wrapped', 'short'),
  )
  const upper = 'flowchart TD\n  a["One<BR>Two"]\n'
  assert.equal(patched(upper, plain('One\nTwo', 'Three')), upper.replace('One<BR>Two', 'Three'))
})

test('line endings are preserved (CRLF)', () => {
  const erd = example('erd').replace(/\n/g, '\r\n')
  assert.equal(
    patched(erd, attr('ORDER', 0, 'name', 'id', 'order_pk')),
    erd.replace('  ORDER {\r\n    uuid id PK', '  ORDER {\r\n    uuid order_pk PK'),
  )
  const out = patched(erd, entity('PAYMENT', 'CARD'))
  assert.ok(!/[^\r]\n/.test(out), 'every line break is still CRLF')
  const flow = 'flowchart TD\r\n  a[Start] --> b[End]\r\n  %% note\r\n'
  assert.equal(patched(flow, node('a', 'Start', 'Begin\nhere')), 'flowchart TD\r\n  a["Begin<br/>here"] --> b[End]\r\n  %% note\r\n')
})

// ---------------------------------------------------------------- sequence

test('sequence messages: unique is applied, repeated is unresolved, phrases are not labels', () => {
  const src = example('sequence')
  assert.equal(patched(src, plain('Checkout cart', 'Review cart')), src.replace('Checkout cart', 'Review cart'))
  assert.equal(
    patched(src, plain('POST /orders', 'POST /v2/orders')),
    src.replace('S->>A: POST /orders', 'S->>A: POST /v2/orders'),
  )
  assert.equal(
    patched(src, plain('payment succeeded', 'paid')),
    src.replace('alt payment succeeded', 'alt paid'),
  )
  assert.equal(
    patched(src, plain('Webhook keeps order and payment in sync', 'Webhook syncs')),
    src.replace('Webhook keeps order and payment in sync', 'Webhook syncs'),
  )
  assert.equal(patched(src, plain('Payment provider', 'PSP')), src.replace('as Payment provider', 'as PSP'))
  // "Create payment" is part of "Create payment intent", not a label of its own.
  untouched(src, plain('Create payment', 'Pay'))
  const repeated = 'sequenceDiagram\n  A->>B: ping\n  B-->>A: ping\n  A->>B: other\n'
  untouched(repeated, plain('ping', 'pong'))
  assert.equal(patched(repeated, plain('other', 'a; b #1\nsecond')), repeated.replace('other', 'a#59; b #35;1<br/>second'))
})

// ---------------------------------------------------------------- real examples

test('real example flowchart.mmd: nodes in different shapes and a subgraph', () => {
  const src = example('flowchart')
  assert.equal(
    patched(src, node('start', 'Paste Mermaid code', 'Paste your code')),
    src.replace('start(["Paste Mermaid code"])', 'start(["Paste your code"])'),
  )
  assert.equal(patched(src, node('parse', 'Valid syntax?', 'Looks fine?')), src.replace('parse{"Valid syntax?"}', 'parse{"Looks fine?"}'))
  assert.equal(patched(src, node('preview', 'Live preview', 'Preview')), src.replace('preview[["Live preview"]]', 'preview[["Preview"]]'))
  assert.equal(
    patched(src, node('figma', 'Editable Figma layers', 'Editable layers')),
    src.replace('figma[("Editable Figma layers")]', 'figma[("Editable layers")]'),
  )
  assert.equal(patched(src, cluster('EXPORT', 'Export', 'Output')), src.replace('subgraph EXPORT["Export"]', 'subgraph EXPORT["Output"]'))
  // Edge labels: "no" and "yes" are unique.
  assert.equal(patched(src, plain('no', 'invalid')), src.replace('|no|', '|invalid|'))
})

test('real example flowchart-sitemap.mmd: a subgraph and its node share a title, ids tell them apart', () => {
  const src = example('flowchart-sitemap')
  assert.equal(
    patched(src, cluster('S2', '2.0 Company', '2.0 About the company')),
    src.replace('subgraph S2["2.0 Company"]', 'subgraph S2["2.0 About the company"]'),
  )
  assert.equal(
    patched(src, node('n20', '2.0 Company', 'Company hub')),
    src.replace('n20[["2.0 Company"]]', 'n20[["Company hub"]]'),
  )
  assert.equal(patched(src, node('n21', '2.1 About Us', 'About us')), src.replace('n21["2.1 About Us"]', 'n21["About us"]'))
  assert.equal(
    patched(src, node('n221', '2.2.1 Profile Template', 'Profile')),
    src.replace('n221[/"2.2.1 Profile Template"/]', 'n221[/"Profile"/]'),
  )
  assert.equal(patched(src, node('n52', '5.2 Status Page', 'Status')), src.replace('n52>"5.2 Status Page"]', 'n52>"Status"]'))
  assert.equal(patched(src, node('n92', '9.2 Thank You', 'Thanks')), src.replace('n92(("9.2 Thank You"))', 'n92(("Thanks"))'))
  assert.equal(patched(src, node('n42', '4.2 Categories', 'Topics')), src.replace('n42{{"4.2 Categories"}}', 'n42{{"Topics"}}'))
  assert.equal(patched(src, node('n40', '4.0 Blog', 'Blog home')), src.replace('n40[("4.0 Blog")]', 'n40[("Blog home")]'))
  // Same title for the subgraph and the node, no context: ambiguous.
  untouched(src, plain('1.0 Home', 'Start'))
  assert.equal(patched(src, plain('featured on homepage', 'on the home page')), src.replace('"featured on homepage"', '"on the home page"'))
})

test('real example sequence.mmd and erd.mmd round trip several changes in one call', () => {
  const erd = example('erd')
  const r = applyTextChanges(erd, [
    attr('CUSTOMER', 4, 'name', 'created_at', 'signed_up_at'),
    entity('CUSTOMER', 'CLIENT'),
    attr('CUSTOMER', 1, 'key', 'UK', 'PK'), // refers to the old title: entity renames run last
    attr('ORDER', 2, 'name', 'nope', 'x'),
    plain('places', 'submits'),
    plain('same', 'same'),
  ])
  assert.equal(r.applied.length, 4)
  assert.equal(r.unresolved.length, 1)
  assert.equal(r.unresolved[0].to, 'x')
  assert.equal(
    r.source,
    erd
      .replace('timestamp created_at', 'timestamp signed_up_at')
      .replace('string email UK', 'string email PK')
      .replace('CUSTOMER ||--o{ ORDER : places', 'CLIENT ||--o{ ORDER : submits')
      .replace('  CUSTOMER {', '  CLIENT {'),
  )
})

// ---------------------------------------------------------------- confirm wording

const none = { texts: [], moved: 0, restyled: 0, added: 0, removed: 0, other: false }
const t1 = { from: 'a', to: 'b', context: { kind: 'node', id: 'n1' } }
const t2 = { from: 'c', to: 'd' }

test('describeConfirm names only what is left, with correct plurals', () => {
  assert.equal(
    describeConfirm({ ...none, texts: [t1], moved: 2, restyled: 1 }),
    'Updating replaces edits made in Figma: 2 moved or resized layers, 1 restyled layer, 1 text edit that is not in the code.',
  )
  assert.equal(describeConfirm({ ...none, moved: 1 }), 'Updating replaces edits made in Figma: 1 moved or resized layer.')
  assert.equal(
    describeConfirm({ ...none, added: 3, removed: 1, texts: [t1, t2] }),
    'Updating replaces edits made in Figma: 3 added layers, 1 deleted layer, 2 text edits that are not in the code.',
  )
  assert.equal(
    describeConfirm({ ...none, restyled: 4, other: true }),
    'Updating replaces edits made in Figma: 4 restyled layers, other changes.',
  )
  assert.equal(describeConfirm({ ...none, other: true }), CONFIRM_TEXT)
  assert.equal(describeConfirm(none), CONFIRM_APPLIED_TEXT)
})

test('remainingChanges drops applied text edits by from, to and context; isNothingLeft', () => {
  const all = { ...none, texts: [t1, t2] }
  assert.deepEqual(remainingChanges(all, [t1]).texts, [t2])
  assert.deepEqual(remainingChanges(all, [{ ...t1 }, { ...t2 }]).texts, [])
  // Same text with another context, or another new value, is a different edit.
  assert.deepEqual(remainingChanges(all, [{ ...t1, context: { kind: 'node', id: 'n2' } }]).texts, [t1, t2])
  assert.deepEqual(remainingChanges(all, [{ ...t2, to: 'e' }]).texts, [t1, t2])
  assert.equal(remainingChanges(all, []), all)
  assert.equal(isNothingLeft(remainingChanges(all, [t1, t2])), true)
  assert.equal(isNothingLeft({ ...none, other: true }), false)
  for (const key of ['moved', 'restyled', 'added', 'removed']) assert.equal(isNothingLeft({ ...none, [key]: 1 }), false)
  // Moves stay after the text edits are removed.
  assert.equal(isNothingLeft(remainingChanges({ ...all, moved: 1 }, [t1, t2])), false)
})

test('describeApplyResult: all applied, some unresolved, long lists truncate', () => {
  assert.equal(describeApplyResult({ total: 3, unresolved: [] }).short, 'Added 3 text edits from Figma to the code.')
  assert.equal(describeApplyResult({ total: 1, unresolved: [] }).short, 'Added 1 text edit from Figma to the code.')
  const one = describeApplyResult({ total: 3, unresolved: [{ from: 'Old', to: 'New' }] })
  assert.equal(one.short, 'Added 2 from Figma. Could not match 1: "Old" → "New"')
  assert.equal(one.truncated, false)
  assert.equal(
    describeApplyResult({ total: 1, unresolved: [{ from: 'Old', to: 'New' }] }).short,
    'Could not match 1: "Old" → "New"',
  )
  const long = describeApplyResult({
    total: 5,
    unresolved: [
      { from: 'A very long original label indeed', to: 'Short' },
      { from: 'b', to: 'c' },
      { from: 'd', to: 'e' },
    ],
  })
  assert.match(long.short, /^Added 2 from Figma\. Could not match 3: "A very long original labe…" → "Short", "b" → "c" and 1 more$/)
  assert.equal(long.truncated, true)
  assert.match(long.full, /"A very long original label indeed" → "Short", "b" → "c", "d" → "e"$/)
})
