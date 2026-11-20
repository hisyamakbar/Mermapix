// Phase 12: write text edits made on the Figma canvas back into Mermaid source.
// Pure (no DOM, no React). The governing rule is to be conservative: a wrong replacement silently
// corrupts someone's diagram, an unresolved one just asks them to type it. Candidates are never chosen
// by order of occurrence: a change is applied only when exactly one place in the source can be meant.
import type { TextChange } from '../../plugin/src/protocol.ts'

export interface PatchResult {
  source: string
  /** Changes written into `source`. */
  applied: TextChange[]
  /** Changes that could not be placed safely. Changes whose text is unchanged after normalization are in neither list. */
  unresolved: TextChange[]
}

type Kind = 'flow' | 'sequence' | 'er' | 'other'

interface Edit {
  start: number
  end: number
  text: string
}

// ---------------------------------------------------------------- text helpers

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  lt: '<',
  gt: '>',
  amp: '&',
  apos: "'",
  nbsp: ' ',
}

/** Mermaid entity codes (`#quot;`, `#35;`) and their HTML spellings, decoded for comparison only. */
function decodeEntities(s: string): string {
  return s.replace(/[#&](\w+);/g, (whole, name: string) => {
    if (/^\d+$/.test(name)) {
      const code = Number(name)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole
  })
}

/** Comparison form: `<br>` variants and whitespace runs are one space, entities decoded, trimmed. */
function norm(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, ' ')).replace(/\s+/g, ' ').trim()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
}

/** Same length as `source`; `%%` comment lines blanked so they never count or get patched. */
function maskComments(source: string): string {
  return source.replace(/^[ \t]*%%[^\r\n]*/gm, (m) => ' '.repeat(m.length))
}

/** End offset of a leading YAML frontmatter block, or 0. Text in there is counted but never patched. */
function frontmatterEnd(text: string): number {
  const m = /^\s*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  return m ? m[0].length : 0
}

function lineBounds(text: string, pos: number): [number, number] {
  const start = pos > 0 ? text.lastIndexOf('\n', pos - 1) + 1 : 0
  let end = pos
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++
  return [start, end]
}

interface Line {
  start: number
  end: number
  text: string
}

function splitLines(text: string): Line[] {
  const out: Line[] = []
  let i = 0
  for (;;) {
    let j = i
    while (j < text.length && text[j] !== '\n' && text[j] !== '\r') j++
    out.push({ start: i, end: j, text: text.slice(i, j) })
    if (j >= text.length) break
    i = text[j] === '\r' && text[j + 1] === '\n' ? j + 2 : j + 1
  }
  return out
}

function applyEdits(source: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  let out = source
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

function detectKind(source: string): Kind {
  let first = true
  let front = false
  for (const raw of source.split(/\r?\n/)) {
    const t = raw.trim()
    if (front) {
      if (t === '---') front = false
      continue
    }
    if (t === '') continue
    if (first && t === '---') {
      front = true
      first = false
      continue
    }
    first = false
    if (t.startsWith('%%') || t.startsWith('```')) continue
    const word = (t.split(/[\s;{]/)[0] ?? '').toLowerCase()
    if (word === 'flowchart' || word === 'flowchart-elk' || word === 'graph') return 'flow'
    if (word === 'sequencediagram') return 'sequence'
    if (word === 'erdiagram') return 'er'
    return 'other'
  }
  return 'other'
}

// ---------------------------------------------------------------- writing a new value

/** One pass, so entity codes produced here are never escaped again. Newlines become `<br/>`. */
function escapeText(text: string, map: Record<string, string>): string {
  return text
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map((l) => [...l.trim()].map((ch) => map[ch] ?? ch).join(''))
    .join('<br/>')
}

const QUOTED_MAP: Record<string, string> = { '"': '#quot;', '<': '#lt;', '>': '#gt;' }
const LINE_MAP: Record<string, string> = { '#': '#35;', ';': '#59;', '<': '#lt;', '>': '#gt;' }

function quoteLabel(text: string): string | null {
  const t = text.trim()
  if (!t || t.startsWith('`')) return null
  return `"${escapeText(t, QUOTED_MAP)}"`
}

/** Safe unquoted inside a shape or on an edge: no delimiter, no markup, not the reserved word `end`. */
function isBareSafe(t: string): boolean {
  return !/["`[\](){}|\\/<>;#\n\r]/.test(t) && !/(^|\s)end(\s|$)/.test(t)
}

const SIMPLE_TEXT = /^[\w][\w .,'!?+-]*$/

type Mode = 'quoted' | 'bracket' | 'edge' | 'line' | 'bareid'

/** New text for a label found at a place of `mode`; null when it cannot be written there. */
function encodeFor(mode: Mode, kind: Kind, text: string): string | null {
  const t = text.trim()
  if (!t) return null
  switch (mode) {
    case 'quoted': {
      if (t.startsWith('`')) return null
      return escapeText(t, QUOTED_MAP)
    }
    case 'bracket':
    case 'edge': {
      if (isBareSafe(t)) return t
      return kind === 'flow' ? quoteLabel(t) : null
    }
    case 'line': {
      if (kind === 'sequence') return escapeText(t, LINE_MAP)
      return SIMPLE_TEXT.test(t) && !/^end$/.test(t) ? t : null
    }
    case 'bareid':
      return /^[A-Za-z_]\w*$/.test(t) && t !== 'end' ? t : null
  }
}

// ---------------------------------------------------------------- generic rule

function sourceRegex(from: string): RegExp {
  const sep = '(?:\\s+|\\s*<[bB][rR]\\s*\\/?>\\s*)+'
  const body = norm(from)
    .split(' ')
    .map((w) => escapeRe(w).replace(/"/g, '(?:"|#quot;|&quot;)'))
    .join(sep)
  return new RegExp(body, 'g')
}

/** Every whole-token occurrence of `from` (whitespace and `<br>` flexible) outside comments. */
function findOccurrences(masked: string, from: string): Array<[number, number]> {
  const hits: Array<[number, number]> = []
  const re = sourceRegex(from)
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    const s = m.index
    const e = s + m[0].length
    const first = m[0][0]
    const last = m[0][m[0].length - 1]
    if (/\w/.test(first) && s > 0 && /\w/.test(masked[s - 1])) {
      re.lastIndex = s + 1
      continue
    }
    if (/\w/.test(last) && e < masked.length && /\w/.test(masked[e])) {
      re.lastIndex = s + 1
      continue
    }
    hits.push([s, e])
  }
  return hits
}

const LINE_KEYWORDS =
  /(?:^|\s)(?:as|alt|else|opt|loop|par|and|critical|option|break|rect|title|subgraph|section|accTitle|accDescr)$/

/**
 * Where does the match sit? Only complete labels qualify: a label is delimited by quotes, brackets,
 * pipes, an edge, a colon or keyword before it and the end of the line, so a phrase inside a longer
 * label never matches.
 */
function classify(text: string, start: number, end: number, kind: Kind): Mode | null {
  const [ls] = lineBounds(text, start)
  const [, le] = lineBounds(text, end)
  const L = text.slice(ls, start)
  const R = text.slice(end, le)
  const Lt = L.replace(/\s+$/, '')
  const Rt = R.replace(/^\s+/, '')

  if (((L.match(/"/g) ?? []).length & 1) === 1) {
    if (!Rt.startsWith('"')) return null
    if (/"\s*`/.test(L.slice(L.lastIndexOf('"')))) return null
    return 'quoted'
  }

  const pairs: Record<string, string> = { '[': ']', '(': ')', '{': '}', '>': ']', '|': '|', '/': '/\\', '\\': '/\\' }
  const open = Lt.slice(-1)
  if (open && Rt && pairs[open]?.includes(Rt[0])) return 'bracket'

  if (kind === 'flow' && /(?:--|-\.|==)$/.test(Lt) && /^[-=.]{2,}[>xo-]?/.test(Rt)) return 'edge'

  if (Rt === '' && (Lt.endsWith(':') || LINE_KEYWORDS.test(Lt))) return 'line'

  if (
    kind === 'flow' &&
    (Lt === '' || /(?:-->|---|==>|-\.->|&|;|\|)$/.test(Lt)) &&
    (Rt === '' || /^(?:[-=.]{2,}|&|;)/.test(Rt))
  ) {
    return 'bareid'
  }
  return null
}

function patchGeneric(source: string, change: TextChange, kind: Kind): string | null {
  const masked = maskComments(source)
  const hits = findOccurrences(masked, change.from)
  if (hits.length !== 1) return null
  const [s, e] = hits[0]
  if (s < frontmatterEnd(masked)) return null
  if (kind === 'er') return patchErRelationLabel(source, masked, change, s, e)
  const mode = classify(masked, s, e, kind)
  if (!mode) return null
  if ((mode === 'edge' || mode === 'bareid') && kind !== 'flow') return null
  const text = encodeFor(mode, kind, change.to)
  if (text === null) return null
  return applyEdits(source, [{ start: s, end: e, text }])
}

// ---------------------------------------------------------------- node / cluster label by id

interface LabelSpan {
  start: number
  end: number
  quoted: boolean
}

const OPENERS = ['(((', '((', '([', '[[', '[(', '[/', '[\\', '{{', '[', '(', '{', '>']
const CLOSERS: Record<string, string[]> = {
  '(((': [')))'],
  '((': ['))'],
  '([': ['])'],
  '[[': [']]'],
  '[(': [')]'],
  '[/': ['/]', '\\]'],
  '[\\': ['\\]', '/]'],
  '{{': ['}}'],
  '[': [']'],
  '(': [')'],
  '{': ['}'],
  '>': [']'],
}

/** The label of the shape that starts at `pos` (just after the id), or null when it is not a shape. */
function shapeLabelAt(text: string, pos: number): LabelSpan | null {
  if (text.startsWith('@{', pos)) return atLabel(text, pos + 2)
  const op = OPENERS.find((o) => text.startsWith(o, pos))
  if (!op) return null
  const p = pos + op.length
  if (text[p] === '"') {
    const q = text.indexOf('"', p + 1)
    if (q < 0) return null
    const after = text.slice(q + 1, q + 4)
    if (!CLOSERS[op].some((c) => after.startsWith(c))) return null
    return { start: p + 1, end: q, quoted: true }
  }
  const lineEnd = lineBounds(text, p)[1]
  let best = -1
  for (const c of CLOSERS[op]) {
    const i = text.indexOf(c, p)
    if (i >= 0 && i < lineEnd && (best < 0 || i < best)) best = i
  }
  return best < 0 ? null : { start: p, end: best, quoted: false }
}

/** `id@{ shape: rect, label: "..." }`: the value of `label`, `pos` being just after `@{`. */
function atLabel(text: string, pos: number): LabelSpan | null {
  let i = pos
  let inQuote = false
  while (i < text.length) {
    if (text[i] === '"') inQuote = !inQuote
    else if (text[i] === '}' && !inQuote) break
    i++
  }
  if (i >= text.length) return null
  const body = text.slice(pos, i)
  const m = /(?:^|[\s,])label\s*:\s*/.exec(body)
  if (!m) return null
  const vs = pos + m.index + m[0].length
  if (text[vs] === '"') {
    const q = text.indexOf('"', vs + 1)
    return q < 0 || q > i ? null : { start: vs + 1, end: q, quoted: true }
  }
  if (text[vs] === "'") return null
  let ve = vs
  while (ve < i && text[ve] !== ',') ve++
  const raw = text.slice(vs, ve)
  const trimmedEnd = vs + raw.replace(/\s+$/, '').length
  return trimmedEnd > vs ? { start: vs, end: trimmedEnd, quoted: false } : null
}

/**
 * undefined: no definition of `id` with that label (fall through to the generic rule).
 * null: found, but the new text cannot be written there. string: the patched source.
 */
function patchNodeLabel(
  source: string,
  id: string,
  change: TextChange,
  kind: Kind,
): string | null | undefined {
  const masked = maskComments(source)
  const front = frontmatterEnd(masked)
  const spans: LabelSpan[] = []
  const idRe = escapeRe(id)
  const defs = new RegExp(`(?<![\\w.\\-])${idRe}(?=[\\[({>@])`, 'g')
  let m: RegExpExecArray | null
  while ((m = defs.exec(masked))) {
    const span = shapeLabelAt(masked, m.index + id.length)
    if (span) spans.push(span)
  }
  const sub = new RegExp(`^[ \\t]*subgraph[ \\t]+${idRe}[ \\t]*(?=\\[)`, 'gm')
  while ((m = sub.exec(masked))) {
    const span = shapeLabelAt(masked, m.index + m[0].length)
    if (span) spans.push(span)
  }
  const target = norm(change.from)
  const wanted = spans.filter((s) => s.start >= front && norm(masked.slice(s.start, s.end)) === target)
  if (wanted.length === 0) return undefined
  const edits: Edit[] = []
  const seen = new Set<number>()
  for (const s of wanted) {
    if (seen.has(s.start)) continue
    seen.add(s.start)
    const text = s.quoted ? encodeFor('quoted', kind, change.to) : encodeFor('bracket', 'flow', change.to)
    if (text === null) return null
    edits.push({ start: s.start, end: s.end, text })
  }
  return applyEdits(source, edits)
}

// ---------------------------------------------------------------- erDiagram

interface ErTok {
  /** Span of the whole token, quotes included. */
  start: number
  end: number
  /** Name without quotes. */
  value: string
  quoted: boolean
}

interface ErAlias {
  /** Span of the alias text inside the brackets (inside the quotes when quoted). */
  start: number
  end: number
  value: string
  quoted: boolean
}

interface ErRef {
  id: ErTok
  alias?: ErAlias
}

interface ErModel {
  blocks: Array<{ id: ErTok; rows: Line[] }>
  refs: ErRef[]
  labels: LabelSpan[]
  styleRefs: ErTok[]
  unknown: Line[]
}

/** `NAME`, `"Quoted name"`, optionally followed by `[Alias]` / `["Alias"]`. `t` is one line at offset `off`. */
function readEntity(t: string, i: number, off: number): (ErRef & { next: number }) | null {
  let id: ErTok
  let next: number
  if (t[i] === '"') {
    const q = t.indexOf('"', i + 1)
    if (q < 0) return null
    id = { start: off + i, end: off + q + 1, value: t.slice(i + 1, q), quoted: true }
    next = q + 1
  } else {
    const re = /[A-Za-z_][\w-]*/y
    re.lastIndex = i
    const m = re.exec(t)
    if (!m) return null
    id = { start: off + i, end: off + i + m[0].length, value: m[0], quoted: false }
    next = i + m[0].length
  }
  if (t[next] !== '[') return { id, next }
  const close = t.indexOf(']', next)
  if (close < 0) return null
  const inner = t.slice(next + 1, close)
  const lead = inner.length - inner.trimStart().length
  const trimmed = inner.trim()
  const base = off + next + 1
  let alias: ErAlias
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    alias = {
      start: base + lead + 1,
      end: base + lead + trimmed.length - 1,
      value: trimmed.slice(1, -1),
      quoted: true,
    }
  } else {
    alias = { start: base + lead, end: base + lead + trimmed.length, value: trimmed, quoted: false }
  }
  return { id, alias, next: close + 1 }
}

const ER_CLASS = String.raw`(?::::[\w-]+)?`

function parseEr(masked: string): ErModel {
  const model: ErModel = { blocks: [], refs: [], labels: [], styleRefs: [], unknown: [] }
  let cur: { id: ErTok; rows: Line[] } | null = null
  for (const ln of splitLines(masked)) {
    const t = ln.text
    if (cur) {
      if (t.trim().startsWith('}')) cur = null
      else if (t.trim()) cur.rows.push(ln)
      continue
    }
    const trimmed = t.trim()
    if (!trimmed) continue
    if (/^erDiagram\b/.test(trimmed) || /^direction\b/.test(trimmed) || /^classDef\b/.test(trimmed)) continue
    const lead = t.length - t.trimStart().length
    const a = readEntity(t, lead, ln.start)
    let handled = false
    if (a) {
      const rest = t.slice(a.next)
      if (new RegExp(`^${ER_CLASS}\\s*\\{\\s*$`).test(rest)) {
        model.refs.push({ id: a.id, alias: a.alias })
        cur = { id: a.id, rows: [] }
        model.blocks.push(cur)
        handled = true
      } else if (new RegExp(`^${ER_CLASS}\\s*$`).test(rest)) {
        model.refs.push({ id: a.id, alias: a.alias })
        handled = true
      } else {
        const rel = new RegExp(`^${ER_CLASS}(\\s+)([|}{o.\\-]+)(\\s+)`).exec(rest)
        if (rel && /--|\.\./.test(rel[2])) {
          const bPos = a.next + rel[0].length
          const b = readEntity(t, bPos, ln.start)
          if (b) {
            const tail = t.slice(b.next)
            const lab = new RegExp(`^${ER_CLASS}\\s*(?::\\s*(.*?))?\\s*$`).exec(tail)
            if (lab) {
              model.refs.push({ id: a.id, alias: a.alias }, { id: b.id, alias: b.alias })
              if (lab[1] !== undefined && lab[1] !== '') {
                const colon = t.indexOf(':', b.next)
                let s = colon + 1
                while (t[s] === ' ' || t[s] === '\t') s++
                const e = s + lab[1].length
                if (lab[1].length >= 2 && lab[1].startsWith('"') && lab[1].endsWith('"')) {
                  model.labels.push({ start: ln.start + s + 1, end: ln.start + e - 1, quoted: true })
                } else {
                  model.labels.push({ start: ln.start + s, end: ln.start + e, quoted: false })
                }
              }
              handled = true
            }
          }
        }
      }
    }
    if (!handled) {
      const sc = /^(\s*)(style|class)(\s+)(\S+)/.exec(t)
      if (sc) {
        let pos = sc[1].length + sc[2].length + sc[3].length
        for (const part of sc[4].split(',')) {
          model.styleRefs.push({ start: ln.start + pos, end: ln.start + pos + part.length, value: part, quoted: false })
          pos += part.length + 1
        }
      } else {
        model.unknown.push(ln)
      }
    }
  }
  return model
}

interface ErEntity {
  id: string
  /** Distinct alias texts (normalized) declared for this id. */
  aliases: Set<string>
}

function erEntities(model: ErModel): Map<string, ErEntity> {
  const map = new Map<string, ErEntity>()
  const touch = (id: string) => {
    let e = map.get(id)
    if (!e) {
      e = { id, aliases: new Set() }
      map.set(id, e)
    }
    return e
  }
  for (const b of model.blocks) touch(b.id.value)
  for (const r of model.refs) {
    const e = touch(r.id.value)
    if (r.alias) e.aliases.add(norm(r.alias.value))
  }
  return map
}

/** Ids whose rendered title is `title`; ids with conflicting aliases have no single title and never match. */
function idsWithTitle(model: ErModel, title: string): string[] {
  const want = norm(title)
  const out: string[] = []
  for (const e of erEntities(model).values()) {
    if (e.aliases.size > 1) continue
    const t = e.aliases.size === 1 ? [...e.aliases][0] : norm(e.id)
    if (t === want) out.push(e.id)
  }
  return out
}

function erName(to: string): string | null {
  const t = to.trim()
  if (!t || /[\r\n]/.test(t)) return null
  return /^[A-Za-z_][\w-]*$/.test(t) ? t : `"${t.replace(/"/g, '#quot;')}"`
}

/** Text for an alias, comment or relationship label: quoted when needed, `<br/>` for newlines. */
function erFreeText(to: string, quoted: boolean): string | null {
  const t = to.trim()
  if (!t) return null
  if (quoted) return escapeText(t, { '"': '#quot;', '<': '#lt;', '>': '#gt;' })
  // Bare ER text is one word; anything else needs quotes.
  if (/^[A-Za-z_][\w-]*$/.test(t)) return t
  return quoteLabel(t)
}

function patchErEntity(source: string, change: TextChange, entity: string): string | null {
  const masked = maskComments(source)
  const model = parseEr(masked)
  const ids = idsWithTitle(model, entity)
  if (ids.length !== 1) return null
  const id = ids[0]
  const info = erEntities(model).get(id)
  if (!info) return null
  const edits: Edit[] = []

  if (info.aliases.size === 1) {
    // The rendered title is the alias: only the alias text changes, the id (used by relationships) stays.
    for (const r of model.refs) {
      if (r.id.value !== id || !r.alias) continue
      const text = erFreeText(change.to, r.alias.quoted)
      if (text === null) return null
      edits.push({ start: r.alias.start, end: r.alias.end, text })
    }
    return edits.length ? applyEdits(source, edits) : null
  }

  // The title is the id itself: rename it everywhere it is referenced, as a whole token.
  const next = erName(change.to)
  if (next === null) return null
  const nextValue = next.startsWith('"') ? change.to.trim() : next
  if (nextValue !== id && erEntities(model).has(nextValue)) return null
  // Another entity whose alias is exactly the old name would make the title ambiguous.
  for (const e of erEntities(model).values()) if (e.aliases.has(norm(id)) && e.id !== id) return null
  for (const u of model.unknown) if (u.text.includes(id)) return null
  for (const r of model.refs) if (r.id.value === id) edits.push({ start: r.id.start, end: r.id.end, text: next })
  for (const s of model.styleRefs) if (s.value === id) edits.push({ start: s.start, end: s.end, text: next })
  return edits.length ? applyEdits(source, edits) : null
}

const ER_TYPE = String.raw`[A-Za-z_][\w\-\[\]]*(?:\([\w ,]*\))?[\w\-\[\]]*`
const ER_NAME = String.raw`[*A-Za-z_][\w\-\[\]()]*`
const ER_ROW = new RegExp(
  String.raw`^(\s*)(${ER_TYPE})(\s+)(${ER_NAME})((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?)((?:\s+"[^"]*")?)\s*$`,
)
const ER_TYPE_ONLY = new RegExp(`^${ER_TYPE}$`)
const ER_NAME_ONLY = new RegExp(`^${ER_NAME}$`)
const KEYS = ['PK', 'FK', 'UK']

function patchErAttr(
  source: string,
  change: TextChange,
  ctx: { entity: string; row: number; col: 'type' | 'name' | 'key' | 'comment'; part?: number },
): string | null {
  const masked = maskComments(source)
  const model = parseEr(masked)
  const ids = idsWithTitle(model, ctx.entity)
  if (ids.length !== 1) return null
  const blocks = model.blocks.filter((b) => b.id.value === ids[0])
  if (blocks.length !== 1) return null
  const row = blocks[0].rows[ctx.row]
  if (!row) return null
  const m = ER_ROW.exec(row.text)
  if (!m) return null

  const typeStart = row.start + m[1].length
  const nameStart = typeStart + m[2].length + m[3].length
  const keysStart = nameStart + m[4].length
  const commentStart = keysStart + m[5].length
  const from = norm(change.from)
  const to = change.to.trim()
  if (!to) return null

  switch (ctx.col) {
    case 'type':
      if (norm(m[2]) !== from || !ER_TYPE_ONLY.test(to)) return null
      return applyEdits(source, [{ start: typeStart, end: typeStart + m[2].length, text: to }])
    case 'name':
      if (norm(m[4]) !== from || !ER_NAME_ONLY.test(to)) return null
      return applyEdits(source, [{ start: nameStart, end: nameStart + m[4].length, text: to }])
    case 'key': {
      const items: Array<{ start: number; end: number; value: string }> = []
      const re = /PK|FK|UK/g
      let k: RegExpExecArray | null
      while ((k = re.exec(m[5]))) {
        items.push({ start: keysStart + k.index, end: keysStart + k.index + 2, value: k[0] })
      }
      const next = to.split(',').map((s) => s.trim().toUpperCase())
      if (next.some((s) => !KEYS.includes(s)) || new Set(next).size !== next.length) return null
      // The plugin renders a multi-key cell (`PK, FK`) as ONE text layer, so the edit arrives without
      // `part` and describes the whole cell: replace the whole key list when it is what was generated.
      if (ctx.part === undefined && items.length > 1) {
        const whole = change.from.replace(/\s+/g, '').toUpperCase()
        if (whole !== items.map((i) => i.value).join(',')) return null
        return applyEdits(source, [{ start: items[0].start, end: items[items.length - 1].end, text: next.join(', ') }])
      }
      const part = ctx.part ?? 0
      const item = items[part]
      if (!item || item.value !== from) return null
      const others = items.filter((i) => i !== item).map((i) => i.value)
      if (next.some((s) => others.includes(s))) return null
      return applyEdits(source, [{ start: item.start, end: item.end, text: next.join(', ') }])
    }
    case 'comment': {
      if (!m[6]) return null
      const q1 = commentStart + m[6].indexOf('"')
      const q2 = commentStart + m[6].lastIndexOf('"')
      if (norm(source.slice(q1 + 1, q2)) !== from) return null
      const text = erFreeText(to, true)
      return text === null ? null : applyEdits(source, [{ start: q1 + 1, end: q2, text }])
    }
  }
}

/** Generic rule on an erDiagram: only a relationship label can be patched without context. */
function patchErRelationLabel(
  source: string,
  masked: string,
  change: TextChange,
  s: number,
  e: number,
): string | null {
  const model = parseEr(masked)
  const label = model.labels.find((l) => l.start <= s && l.end >= e && norm(masked.slice(l.start, l.end)) === norm(change.from))
  if (!label) return null
  const text = erFreeText(change.to, label.quoted)
  return text === null ? null : applyEdits(source, [{ start: label.start, end: label.end, text }])
}

// ---------------------------------------------------------------- entry point

function patchOne(source: string, change: TextChange): string | null {
  if (!change.from.trim() || !change.to.trim()) return null
  const kind = detectKind(source)
  const ctx = change.context
  if (ctx) {
    switch (ctx.kind) {
      case 'erd-entity':
        return kind === 'er' ? patchErEntity(source, change, ctx.entity) : null
      case 'erd-attr':
        return kind === 'er' ? patchErAttr(source, change, ctx) : null
      case 'node':
      case 'cluster': {
        const r = patchNodeLabel(source, ctx.id, change, kind)
        if (r !== undefined) return r
        break
      }
    }
  }
  return patchGeneric(source, change, kind)
}

type Outcome = 'applied' | 'unresolved' | 'dropped'

/**
 * The shared loop: one change after another on the evolving source(s). Entity renames are applied after
 * every other change (those refer to the old title); results keep the input order.
 */
function runChanges(changes: TextChange[], step: (change: TextChange) => boolean): Outcome[] {
  const outcome: Outcome[] = changes.map(() => 'unresolved')
  const order = changes
    .map((_, i) => i)
    .sort((a, b) => Number(changes[a].context?.kind === 'erd-entity') - Number(changes[b].context?.kind === 'erd-entity') || a - b)
  for (const i of order) {
    const change = changes[i]
    if (norm(change.from) === norm(change.to)) {
      outcome[i] = 'dropped'
      continue
    }
    if (step(change)) outcome[i] = 'applied'
  }
  return outcome
}

/**
 * Write text edits made in Figma back into Mermaid source, one after another on the evolving source.
 * Entity renames are applied after every other change (those refer to the old title), results keep
 * the input order.
 */
export function applyTextChanges(source: string, changes: TextChange[]): PatchResult {
  let current = source
  const outcome = runChanges(changes, (change) => {
    const next = patchOne(current, change)
    if (next === null) return false
    current = next
    return true
  })
  return {
    source: current,
    applied: changes.filter((_, i) => outcome[i] === 'applied'),
    unresolved: changes.filter((_, i) => outcome[i] === 'unresolved'),
  }
}

// ---------------------------------------------------------------- editor ahead of the diagram

export interface CanvasPatchResult extends PatchResult {
  /** `reference` with the applied changes written into it: what the canvas shows, as code. */
  reference: string
}

/**
 * Where line `i` of `from` sits in `to`, by the lines both share at the top and at the bottom. Null when
 * the line is inside the part that differs, or when the top-first and the bottom-first reading disagree
 * (a line inserted next to an identical one: either place could be meant).
 */
function lineMapper(from: string[], to: string[]): (i: number) => number | null {
  const limit = Math.min(from.length, to.length)
  const prefix = (max: number) => {
    let n = 0
    while (n < max && from[n] === to[n]) n++
    return n
  }
  const suffix = (max: number) => {
    let n = 0
    while (n < max && from[from.length - 1 - n] === to[to.length - 1 - n]) n++
    return n
  }
  const shift = to.length - from.length
  const topFirst = prefix(limit)
  const bottomOfTop = suffix(limit - topFirst)
  const bottomFirst = suffix(limit)
  const topOfBottom = prefix(limit - bottomFirst)
  const at = (i: number, top: number, bottom: number) =>
    i < top ? i : i >= from.length - bottom ? i + shift : null
  return (i) => {
    const a = at(i, topFirst, bottomOfTop)
    const b = at(i, topOfBottom, bottomFirst)
    return a !== null && a === b ? a : null
  }
}

/** Offset of the start of every line of `text` (split on `\n`). */
function lineStarts(lines: string[]): number[] {
  const out: number[] = []
  let at = 0
  for (const l of lines) {
    out.push(at)
    at += l.length + 1
  }
  return out
}

/** Index of the line that holds `offset`. */
function lineOf(starts: number[], offset: number): number {
  let n = 0
  while (n + 1 < starts.length && starts[n + 1] <= offset) n++
  return n
}

/**
 * An edited ERD attribute row, carried from the reference to the editor: the row and the header of its
 * table must both be unchanged lines in the editor, and the row must still sit in that table. The new
 * editor code, or null.
 */
function carryErRow(
  ref: string,
  cur: string,
  refLines: string[],
  curLines: string[],
  map: (i: number) => number | null,
  edited: number[],
  newRefLines: string[],
): string | null {
  if (edited.length !== 1 || detectKind(cur) !== 'er') return null
  const i = edited[0]
  const j = map(i)
  if (j === null) return null
  const refStarts = lineStarts(refLines)
  const curStarts = lineStarts(curLines)
  const refBlock = parseEr(maskComments(ref)).blocks.find((b) => b.rows.some((r) => r.start === refStarts[i]))
  const curBlock = parseEr(maskComments(cur)).blocks.find((b) => b.rows.some((r) => r.start === curStarts[j]))
  if (!refBlock || !curBlock) return null
  const header = map(lineOf(refStarts, refBlock.id.start))
  if (header === null || lineOf(curStarts, curBlock.id.start) !== header) return null
  const out = [...curLines]
  out[j] = newRefLines[i]
  return out.join('\n')
}

/**
 * `applyTextChanges` for an editor that may be ahead of the diagram (Phase 13.11). The canvas report
 * (row numbers of an ERD table, ...) describes the code the diagram shows, `reference`. When the editor
 * holds other code, a change is applied only if its place is the same in both: it is resolved in the
 * reference and in the editor, and the editor's result must be exactly the reference's edit carried to
 * the same, unchanged line(s) of the editor. Anything else is unresolved, never placed by guesswork.
 */
export function applyCanvasEdits(reference: string, editor: string, changes: TextChange[]): CanvasPatchResult {
  if (reference === editor) {
    const r = applyTextChanges(editor, changes)
    return { ...r, reference: r.source }
  }
  let ref = reference
  let cur = editor
  const outcome = runChanges(changes, (change) => {
    const nextRef = patchOne(ref, change)
    if (nextRef === null) return false
    const refLines = ref.split('\n')
    const newRefLines = nextRef.split('\n')
    if (refLines.length !== newRefLines.length) return false
    const curLines = cur.split('\n')
    const map = lineMapper(refLines, curLines)
    const edited: number[] = []
    for (let i = 0; i < refLines.length; i++) if (refLines[i] !== newRefLines[i]) edited.push(i)
    let nextCur: string | null
    if (change.context?.kind === 'erd-attr') {
      // One row: carried to the same row of the editor, wherever rows were added or removed above it.
      nextCur = carryErRow(ref, cur, refLines, curLines, map, edited, newRefLines)
    } else {
      // Anything that can touch several places (a rename, a label found by its text): the editor must
      // resolve it by itself to exactly the reference's edit on the same unchanged lines.
      nextCur = patchOne(cur, change)
      if (nextCur !== null) {
        const expected = [...curLines]
        for (const i of edited) {
          const j = map(i)
          if (j === null) return false
          expected[j] = newRefLines[i]
        }
        if (expected.join('\n') !== nextCur) return false
      }
    }
    if (nextCur === null) return false
    ref = nextRef
    cur = nextCur
    return true
  })
  return {
    source: cur,
    reference: ref,
    applied: changes.filter((_, i) => outcome[i] === 'applied'),
    unresolved: changes.filter((_, i) => outcome[i] === 'unresolved'),
  }
}
