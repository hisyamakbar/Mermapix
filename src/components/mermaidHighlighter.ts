/**
 * Lightweight, zero-dependency Mermaid syntax highlighter.
 * Converts raw Mermaid text into safe syntax-highlighted HTML spans.
 *
 * Single-pass tokenizer: each line is scanned once on the RAW text and every
 * token is escaped + wrapped exactly once. Regexes never run over generated
 * HTML, so class names like `tok-string` can never be re-matched (which used to
 * corrupt output into `string">"..."` and desync the overlay from the textarea).
 *
 * Invariant: stripping tags and unescaping the output yields the input exactly.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const KEYWORDS = new Set([
  'erDiagram', 'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'gitGraph', 'mindmap', 'subgraph', 'end', 'direction', 'TB', 'TD', 'BT', 'RL', 'LR',
  'participant', 'actor', 'autonumber', 'activate', 'deactivate', 'class', 'note',
  'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'critical', 'break',
])

const KEYS = new Set(['PK', 'FK', 'UK'])

const TYPES = new Set([
  'int', 'integer', 'string', 'varchar', 'boolean', 'bool', 'date', 'datetime',
  'timestamp', 'decimal', 'float', 'text', 'blob', 'json', 'uuid', 'bigint',
  'serial', 'numeric', 'char', 'void',
])

// Ordered alternatives; first match at the current position wins.
// Groups: 1 string, 2 arrow, 3 word
const TOKEN_RE = new RegExp(
  [
    '("[^"]*"?|\'[^\']*\'?)',
    // ERD cardinalities, class relations, flowchart & sequence arrows
    '([|}o][|o]--[|o][|{o]|[|}o][|o]\\.\\.[|o][|{o]|<\\|--|--\\|>|\\*--|--\\*|o--|--o|<\\.\\.|\\.\\.>|-->>|--x|--\\)|->>|-\\)|-x|-\\.->|==>|-->|---|--|->)',
    '([A-Za-z_][A-Za-z0-9_]*)',
  ].join('|'),
  'y',
)

function wrap(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`
}

export function highlightLine(line: string): string {
  const commentIndex = line.indexOf('%%')
  const code = commentIndex === -1 ? line : line.slice(0, commentIndex)
  const comment = commentIndex === -1 ? '' : line.slice(commentIndex)

  let out = ''
  let plain = ''
  let i = 0
  while (i < code.length) {
    TOKEN_RE.lastIndex = i
    const m = TOKEN_RE.exec(code)
    if (!m) {
      plain += code[i]
      i += 1
      continue
    }
    const [text, str, arrow, word] = m
    let cls: string | null = null
    if (str !== undefined) cls = 'tok-string'
    else if (arrow !== undefined) cls = 'tok-arrow'
    else if (word !== undefined) {
      if (KEYWORDS.has(word)) cls = 'tok-keyword'
      else if (KEYS.has(word)) cls = 'tok-key'
      else if (TYPES.has(word)) cls = 'tok-type'
    }
    if (cls) {
      if (plain) {
        out += escapeHtml(plain)
        plain = ''
      }
      out += wrap(cls, text)
    } else {
      plain += text
    }
    i += text.length
  }
  if (plain) out += escapeHtml(plain)
  if (comment) out += wrap('tok-comment', comment)
  return out
}

export function highlightMermaid(source: string): string {
  if (!source) return ''
  return source.split('\n').map(highlightLine).join('\n')
}
