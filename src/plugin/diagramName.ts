// Names a newly inserted Figma diagram layer from its Mermaid code. Pure: no DOM, no React, no mermaid.
// Order (first hit wins): frontmatter `title:`, a `title` directive of a diagram type that has one,
// `accTitle:`, the diagram type ("ER diagram"), then DEFAULT_DIAGRAM_NAME.
// Only new inserts use this; an update keeps the existing layer name.

export const DEFAULT_DIAGRAM_NAME = 'Mermapix Diagram'

const MAX_LENGTH = 60

// Fallback names by lower-cased header keyword. Anything not listed is humanized (see humanize).
const TYPE_NAMES: Record<string, string> = {
  flowchart: 'Flowchart',
  'flowchart-elk': 'Flowchart',
  graph: 'Flowchart',
  erdiagram: 'ER diagram',
  sequencediagram: 'Sequence diagram',
  classdiagram: 'Class diagram',
  'classdiagram-v2': 'Class diagram',
  statediagram: 'State diagram',
  'statediagram-v2': 'State diagram',
  gantt: 'Gantt chart',
  pie: 'Pie chart',
  journey: 'User journey',
  gitgraph: 'Git graph',
  mindmap: 'Mindmap',
  timeline: 'Timeline',
  quadrantchart: 'Quadrant chart',
  xychart: 'XY chart',
  'xychart-beta': 'XY chart',
  sankey: 'Sankey diagram',
  'sankey-beta': 'Sankey diagram',
  requirementdiagram: 'Requirement diagram',
  c4context: 'C4 diagram',
  c4container: 'C4 diagram',
  c4component: 'C4 diagram',
  c4dynamic: 'C4 diagram',
  c4deployment: 'C4 diagram',
  block: 'Block diagram',
  'block-beta': 'Block diagram',
  packet: 'Packet diagram',
  'packet-beta': 'Packet diagram',
  kanban: 'Kanban board',
  architecture: 'Architecture diagram',
  'architecture-beta': 'Architecture diagram',
  radar: 'Radar chart',
  'radar-beta': 'Radar chart',
  treemap: 'Treemap',
  'treemap-beta': 'Treemap',
  // Names where humanizing the keyword would read badly.
  'usecase-beta': 'Use case diagram',
  usecase: 'Use case diagram',
  'agentflow-beta': 'Agent flow diagram',
  agentflow: 'Agent flow diagram',
  eventmodeling: 'Event model',
  wardley: 'Wardley map',
  'wardley-beta': 'Wardley map',
  treeview: 'Tree view',
  'treeview-beta': 'Tree view',
  ishikawa: 'Ishikawa diagram',
  'ishikawa-beta': 'Ishikawa diagram',
  cynefin: 'Cynefin diagram',
  'cynefin-beta': 'Cynefin diagram',
}

// Header keywords that really have a `title` line. Never read `title` for erDiagram, classDiagram, flowchart,
// stateDiagram, mindmap, ...: there it can be a column, a class member or a node label.
const TITLE_TYPES = new Set([
  'sequencediagram',
  'gantt',
  'journey',
  'pie',
  'quadrantchart',
  'timeline',
  'xychart',
  'xychart-beta',
  'c4context',
  'c4container',
  'c4component',
  'c4dynamic',
  'c4deployment',
  'cynefin',
  'cynefin-beta',
  'wardley',
  'wardley-beta',
  'packet',
  'packet-beta',
  'radar',
  'radar-beta',
  'treemap',
  'treemap-beta',
  'venn',
  'venn-beta',
  'architecture',
  'architecture-beta',
  'gitgraph',
])

function hasTitleDirective(type: string): boolean {
  return TITLE_TYPES.has(type) || type.startsWith('railroad')
}

function stripQuotes(value: string): string {
  let v = value.trim()
  while (v.length >= 2) {
    const a = v[0]
    const b = v[v.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) v = v.slice(1, -1).trim()
    else break
  }
  return v
}

// Quotes, a trailing %% comment, whitespace; '' when nothing is left. Capped at MAX_LENGTH (by code point).
function cleanName(raw: string): string {
  let v = raw.replace(/(^|\s)%%.*$/, '')
  v = stripQuotes(v).replace(/\s+/g, ' ').trim()
  const points = Array.from(v)
  if (points.length > MAX_LENGTH) v = points.slice(0, MAX_LENGTH - 1).join('').trimEnd() + '…'
  return v
}

// YAML scalar of a frontmatter `title:` line. Quoted values keep a '#'; plain ones drop ` # comment`.
function yamlScalar(raw: string): string {
  const v = raw.trim()
  const quote = v[0]
  if (quote === '"' || quote === "'") {
    const end = v.indexOf(quote, 1)
    if (end > 0) return v.slice(1, end)
  }
  if (v === '|' || v === '>' || v === '|-' || v === '>-') return ''
  return v.replace(/\s+#.*$/, '')
}

// Splits off a YAML frontmatter block at the very top (leading blank lines allowed).
function splitFrontmatter(lines: string[]): { front: string[]; body: string[] } {
  let start = 0
  while (start < lines.length && lines[start].trim() === '') start++
  if (start < lines.length && /^---\s*$/.test(lines[start])) {
    for (let i = start + 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i])) return { front: lines.slice(start + 1, i), body: lines.slice(i + 1) }
    }
  }
  return { front: [], body: lines }
}

function frontmatterTitle(front: string[]): string {
  for (const line of front) {
    const m = /^title\s*:(.*)$/.exec(line) // top level only: no indentation
    if (m) {
      const name = cleanName(yamlScalar(m[1]))
      if (name) return name
    }
  }
  return ''
}

// Index of the first meaningful line: not blank, not a %% comment, not a (possibly multi-line) %%{...}%% directive.
function headerIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '') continue
    if (t.startsWith('%%{')) {
      let j = i
      while (j < lines.length && !lines[j].includes('}%%')) j++
      i = j
      continue
    }
    if (t.startsWith('%%')) continue
    return i
  }
  return -1
}

function humanize(keyword: string): string {
  const words = keyword
    .replace(/-(beta|v\d+)$/i, '')
    .replace(/diagram$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
  if (!words) return ''
  return words.charAt(0).toUpperCase() + words.slice(1) + ' diagram'
}

function typeName(keyword: string): string {
  const key = keyword.toLowerCase()
  if (TYPE_NAMES[key]) return TYPE_NAMES[key]
  if (key.startsWith('railroad')) return 'Railroad diagram'
  return humanize(keyword)
}

export function diagramName(code: string): string {
  try {
    if (typeof code !== 'string') return DEFAULT_DIAGRAM_NAME
    const lines = code.replace(/^﻿/, '').split(/\r\n|\r|\n/)
    const { front, body } = splitFrontmatter(lines)

    const fromFront = frontmatterTitle(front)
    if (fromFront) return fromFront

    const h = headerIndex(body)
    if (h < 0) return DEFAULT_DIAGRAM_NAME
    const header = body[h].trim()
    const keywordMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(header)
    const keyword = keywordMatch ? keywordMatch[0] : ''
    const type = keyword.toLowerCase()

    if (keyword && hasTitleDirective(type)) {
      // `pie title Pets`, `pie showData title Pets`
      const inline = /^pie\b.*?\btitle\s+(.*)$/i.exec(header)
      if (type === 'pie' && inline) {
        const name = cleanName(inline[1])
        if (name) return name
      }
      for (let i = h + 1; i < body.length; i++) {
        const m = /^\s*title(?::|\s)\s*(.*)$/.exec(body[i])
        if (m) {
          const name = cleanName(m[1])
          if (name) return name
        }
      }
    }

    for (let i = h; i < body.length; i++) {
      const m = /^\s*accTitle\s*:\s*(.*)$/.exec(body[i])
      if (m) {
        const name = cleanName(m[1])
        if (name) return name
      }
    }

    if (keyword) {
      const name = cleanName(typeName(keyword))
      if (name) return name
    }
    return DEFAULT_DIAGRAM_NAME
  } catch {
    return DEFAULT_DIAGRAM_NAME
  }
}
