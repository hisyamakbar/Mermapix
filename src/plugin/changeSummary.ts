// Phase 12: wording and bookkeeping around edits made in Figma. Pure (no DOM, no React), unit-tested in
// tests/unit/source-patch.test.mjs.
import type { DiagramChanges, TextChange } from '../../plugin/src/protocol.ts'

/** Phase 11 sentence: the only thing known is that the diagram differs from what was generated. */
export const CONFIRM_TEXT = 'This diagram was edited in Figma. Updating replaces those edits.'

/** Everything the update would replace is already in the code (the text edits were applied to it). */
export const CONFIRM_APPLIED_TEXT =
  'Updating regenerates the diagram. The text edits made in Figma are already in the code.'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function contextKey(c: TextChange['context']): string {
  if (!c) return ''
  switch (c.kind) {
    case 'erd-entity':
      return `entity:${c.entity}`
    case 'erd-attr':
      return `attr:${c.entity}:${c.row}:${c.col}:${c.part ?? ''}`
    case 'node':
      return `node:${c.id}`
    case 'cluster':
      return `cluster:${c.id}`
  }
}

function changeKey(c: TextChange): string {
  return JSON.stringify([c.from, c.to, contextKey(c.context)])
}

/** `changes` without the text edits the user already applied to the code (matched by from, to and context). */
export function remainingChanges(changes: DiagramChanges, handled: TextChange[]): DiagramChanges {
  if (handled.length === 0) return changes
  const done = new Set(handled.map(changeKey))
  return { ...changes, texts: changes.texts.filter((t) => !done.has(changeKey(t))) }
}

/** One text layer: the generated text and its context stay the same until the next update. */
function layerKey(c: TextChange): string {
  return JSON.stringify([c.from, contextKey(c.context)])
}

/** A text edit on the canvas that the code does not have yet. */
export interface PendingEdit {
  /**
   * The layer as the sandbox reports it: generated text -> text on the canvas now. Equal `from` and
   * `to` when an edit that was applied to the code has been typed back on the canvas.
   */
  layer: TextChange
  /** The same edit against the code as it is now (`from` is what the code holds): for `applyTextChanges`. */
  patch: TextChange
}

/**
 * The text edits still to offer, from the latest report of a watched diagram.
 *
 * The sandbox always compares the canvas with what was generated, but the code moves on when edits are
 * applied to it. So each reported edit is restated against the code: a layer edited again after its
 * first edit was applied starts from the applied text, and edits inside a renamed ERD table look for
 * the table under its new name. A layer whose applied edit was typed back is offered as the reverse
 * edit (not when layers were deleted: a deleted layer looks the same in the report).
 * Two layers that share generated text and context cannot be told apart, so they are never restated:
 * the patcher then reports them as unresolved instead of guessing.
 */
export function pendingEdits(
  changes: DiagramChanges,
  handled: TextChange[],
  ignored: TextChange[] = [],
): PendingEdit[] {
  const inCode = new Set(handled.map(changeKey))
  const skip = new Set(ignored.map(changeKey))
  const applied = new Map(handled.map((h) => [layerKey(h), h]))
  const reported = new Map<string, number>()
  for (const t of changes.texts) reported.set(layerKey(t), (reported.get(layerKey(t)) ?? 0) + 1)

  // ERD table titles as the code has them now.
  const titles = new Map<string, string>()
  for (const h of handled) if (h.context?.kind === 'erd-entity') titles.set(h.context.entity, h.to)
  const inCodeTerms = (c: TextChange['context']): TextChange['context'] => {
    if (!c || (c.kind !== 'erd-entity' && c.kind !== 'erd-attr')) return c
    const now = titles.get(c.entity)
    return now === undefined ? c : { ...c, entity: now }
  }
  const patch = (from: string, to: string, context: TextChange['context']): TextChange => {
    const c = inCodeTerms(context)
    return c ? { from, to, context: c } : { from, to }
  }

  const out: PendingEdit[] = []
  for (const t of changes.texts) {
    if (inCode.has(changeKey(t))) continue
    const before = reported.get(layerKey(t)) === 1 ? applied.get(layerKey(t)) : undefined
    out.push({ layer: t, patch: patch(before ? before.to : t.from, t.to, t.context) })
  }
  if (changes.removed === 0) {
    for (const h of handled) {
      if (reported.has(layerKey(h)) || h.from === h.to) continue
      const layer: TextChange = h.context ? { from: h.from, to: h.from, context: h.context } : { from: h.from, to: h.from }
      out.push({ layer, patch: patch(h.to, h.from, h.context) })
    }
  }
  return out.filter((p) => !skip.has(changeKey(p.layer)))
}

/** `handled` after the given edits (as `PendingEdit.layer`) were written into the code. */
export function settleHandled(handled: TextChange[], applied: TextChange[]): TextChange[] {
  const layers = new Set(applied.map(layerKey))
  return [...handled.filter((h) => !layers.has(layerKey(h))), ...applied.filter((c) => c.from !== c.to)]
}

/** True when an update would not replace anything: no count, no unexplained difference, no text edit. */
export function isNothingLeft(changes: DiagramChanges): boolean {
  return (
    changes.texts.length === 0 &&
    changes.moved === 0 &&
    changes.restyled === 0 &&
    changes.added === 0 &&
    changes.removed === 0 &&
    !changes.other
  )
}

/**
 * The sentence of the confirm step, built from what an update would replace. Only the non-zero parts
 * are named; `other` alone keeps the generic Phase 11 sentence.
 */
export function describeConfirm(changes: DiagramChanges): string {
  if (isNothingLeft(changes)) return CONFIRM_APPLIED_TEXT
  const parts: string[] = []
  if (changes.moved > 0) parts.push(plural(changes.moved, 'moved or resized layer', 'moved or resized layers'))
  if (changes.restyled > 0) parts.push(plural(changes.restyled, 'restyled layer', 'restyled layers'))
  if (changes.added > 0) parts.push(plural(changes.added, 'added layer', 'added layers'))
  if (changes.removed > 0) parts.push(plural(changes.removed, 'deleted layer', 'deleted layers'))
  const t = changes.texts.length
  if (t > 0) {
    parts.push(
      t === 1 ? '1 text edit that is not in the code' : `${t} text edits that are not in the code`,
    )
  }
  if (parts.length === 0) return CONFIRM_TEXT
  if (changes.other) parts.push('other changes')
  return `Updating replaces edits made in Figma: ${parts.join(', ')}.`
}

const PREVIEW_MAX = 26
const PREVIEW_LIST = 2

function preview(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > PREVIEW_MAX ? `${one.slice(0, PREVIEW_MAX - 1)}…` : one
}

function pair(c: TextChange, clip: boolean): string {
  const f = clip ? preview(c.from) : c.from.replace(/\s+/g, ' ').trim()
  const t = clip ? preview(c.to) : c.to.replace(/\s+/g, ' ').trim()
  return `"${f}" → "${t}"`
}

export interface ApplyOutcome {
  /** Changes written into the code plus those that could not be placed. */
  total: number
  /** The ones that could not be placed in the code. */
  unresolved: TextChange[]
}

/**
 * What happened when text edits made in Figma were written into the code (Phase 13: automatically, as
 * they arrive). `short` is the line in the strip (at most two
 * unresolved edits, each clipped); `full` lists every one untruncated, for the details view and tooltip.
 */
export function describeApplyResult(outcome: ApplyOutcome): {
  short: string
  full: string
  truncated: boolean
} {
  const applied = outcome.total - outcome.unresolved.length
  const n = outcome.unresolved.length
  if (n === 0) {
    const s = `Added ${plural(applied, 'text edit', 'text edits')} from Figma to the code.`
    return { short: s, full: s, truncated: false }
  }
  const lead = applied > 0 ? `Added ${applied} from Figma. ` : ''
  const shown = outcome.unresolved.slice(0, PREVIEW_LIST)
  const clipped = shown.some((c) => preview(c.from) !== c.from.replace(/\s+/g, ' ').trim() || preview(c.to) !== c.to.replace(/\s+/g, ' ').trim())
  const more = n - shown.length
  const short = `${lead}Could not match ${n}: ${shown.map((c) => pair(c, true)).join(', ')}${more > 0 ? ` and ${more} more` : ''}`
  const full = `${lead}Could not match ${n}: ${outcome.unresolved.map((c) => pair(c, false)).join(', ')}`
  return { short, full, truncated: more > 0 || clipped }
}
