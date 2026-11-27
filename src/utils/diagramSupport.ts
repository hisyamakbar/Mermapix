// Which Mermaid diagram types Mermapix knows, and what to tell the user when a diagram cannot render.
// Pure: no DOM, no React, no mermaid import (the unit tests compare these lists with the installed Mermaid).
//
// Two lists, both checked by tests/unit/diagram-coverage.test.mjs against `mermaid.getRegisteredDiagramsMetadata()`:
//   DIAGRAM_KEYWORDS      Mermaid ids Mermapix converts (each has a fixture)
//   UNSUPPORTED_DIAGRAMS  types Mermapix refuses on purpose, with the alternative to offer
// A Mermaid upgrade that registers a type found in neither list turns that test red.

/**
 * Mermaid's registered diagram id -> the header keywords that start a diagram of that type.
 * The first keyword is the one the docs use. Used to suggest the right keyword for a typo.
 */
export const DIAGRAM_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  'flowchart-v2': ['flowchart', 'graph'],
  'flowchart-elk': ['flowchart-elk'],
  er: ['erDiagram'],
  sequence: ['sequenceDiagram'],
  classDiagram: ['classDiagram', 'classDiagram-v2'],
  stateDiagram: ['stateDiagram-v2', 'stateDiagram'],
  gantt: ['gantt'],
  pie: ['pie'],
  journey: ['journey'],
  gitGraph: ['gitGraph'],
  mindmap: ['mindmap'],
  timeline: ['timeline'],
  quadrantChart: ['quadrantChart'],
  xychart: ['xychart-beta', 'xychart'],
  sankey: ['sankey-beta', 'sankey'],
  requirement: ['requirementDiagram'],
  c4: ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'],
  block: ['block-beta', 'block'],
  packet: ['packet-beta', 'packet'],
  kanban: ['kanban'],
  architecture: ['architecture-beta', 'architecture'],
  radar: ['radar-beta'],
  treemap: ['treemap-beta', 'treemap'],
  treeView: ['treeView-beta'],
  swimlane: ['swimlane-beta'],
  eventmodeling: ['eventmodeling'],
  ishikawa: ['ishikawa-beta', 'ishikawa'],
  venn: ['venn-beta'],
  wardley: ['wardley-beta'],
  cynefin: ['cynefin-beta'],
  railroad: ['railroad-beta'],
  railroadEbnf: ['railroad-ebnf-beta'],
  railroadAbnf: ['railroad-abnf-beta'],
  railroadPeg: ['railroad-peg-beta'],
  usecase: ['usecase-beta'],
  agentflow: ['agentflow-beta'],
}

export interface UnsupportedDiagram {
  /** Mermaid's id when Mermaid registers the type itself; otherwise the name it goes by. */
  id: string
  /** Header keywords of the type, as typed in the first line of the code. */
  keywords: readonly string[]
  /** Why Mermapix refuses it (for maintainers: shown by the coverage test, not to users). */
  reason: string
  /** What the editor shows instead of Mermaid's raw error: names the type and the alternative. */
  message: string
}

export const UNSUPPORTED_DIAGRAMS: readonly UnsupportedDiagram[] = [
  {
    id: 'zenuml',
    keywords: ['zenuml'],
    reason:
      'ZenUML is the separate package @mermaid-js/mermaid-zenuml, never bundled in mermaid, and it draws HTML instead of SVG shapes, so there is nothing to convert. Mermapix is offline and ships no second renderer.',
    message:
      'Mermapix does not support ZenUML diagrams. Write the same diagram as a sequenceDiagram: participants, messages, loops and alt blocks all have an equivalent there.',
  },
]

/** What Mermaid says when the first keyword matches no diagram type (UnknownDiagramError). */
export const NO_DIAGRAM_TYPE_PATTERN = /No diagram type detected/i

/**
 * The word that names the diagram type: the first word of the code after frontmatter, `%%{...}%%`
 * directives and `%%` comments. '' when there is none. `stateDiagram-v2`, `usecase-beta` and `C4Context`
 * come back whole.
 */
export function diagramKeyword(code: string): string {
  const lines = code.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i < lines.length && /^---\s*$/.test(lines[i])) {
    let end = i + 1
    while (end < lines.length && !/^---\s*$/.test(lines[end])) end++
    if (end < lines.length) i = end + 1
  }
  for (; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '') continue
    if (t.startsWith('%%{')) {
      while (i < lines.length && !lines[i].includes('}%%')) i++
      continue
    }
    if (t.startsWith('%%')) continue
    const m = /^[A-Za-z][A-Za-z0-9_-]*/.exec(t)
    return m ? m[0] : ''
  }
  return ''
}

/** The refused type whose keyword starts the code, or null. */
export function unsupportedDiagram(code: string): UnsupportedDiagram | null {
  const keyword = diagramKeyword(code)
  if (!keyword) return null
  return UNSUPPORTED_DIAGRAMS.find((d) => d.keywords.includes(keyword)) ?? null
}

const ALL_KEYWORDS: readonly string[] = Object.values(DIAGRAM_KEYWORDS).flat()

// Lower case without the `-beta` / `-v2` / `Diagram` ending: "erdiagram", "radar", "state" match their keyword.
function stem(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/-(beta|v\d+)$/, '')
    .replace(/diagram$/, '')
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

/** The known keyword a mistyped one most likely meant, or null when nothing is close. */
export function suggestKeyword(typed: string): string | null {
  const wanted = stem(typed)
  if (!wanted) return null
  const sameStem = ALL_KEYWORDS.find((k) => stem(k) === wanted)
  if (sameStem) return sameStem
  // One slip for short words (a two-letter word is not a typo of "er"), two for longer ones.
  let best: string | null = null
  let bestDistance = wanted.length < 6 ? 2 : 3
  for (const k of ALL_KEYWORDS) {
    const d = editDistance(wanted, stem(k))
    if (d < bestDistance) {
      best = k
      bestDistance = d
    }
  }
  return best
}

/**
 * The message shown in the editor for code that failed to render. `error` is what Mermaid threw.
 * - A type Mermapix refuses on purpose: names it and the alternative.
 * - A first word Mermaid does not know: says so, suggesting the closest keyword. It never calls a
 *   misspelled word an unsupported type.
 * - Anything else (a real syntax error with a line number, ...): Mermaid's own message, unchanged.
 */
export function explainRenderError(code: string, error: string): string {
  const refused = unsupportedDiagram(code)
  if (refused) return refused.message
  if (!NO_DIAGRAM_TYPE_PATTERN.test(error)) return error
  const keyword = diagramKeyword(code)
  if (!keyword) {
    return 'Mermapix could not find a diagram type at the start of the code. Begin with a type keyword such as flowchart, sequenceDiagram or erDiagram.'
  }
  const suggestion = suggestKeyword(keyword)
  if (suggestion) {
    return `"${keyword}" is not a Mermaid diagram type. Did you mean ${suggestion}? The first word of the code sets the type.`
  }
  return `"${keyword}" is not a Mermaid diagram type. The first word of the code sets the type, for example flowchart, sequenceDiagram or erDiagram.`
}
