// Pure helpers for the railroad converter (Phase 9.2). No `figma` usage, unit-testable in node.
//
// Mermaid's railroad renderer (`railroad-beta`, `railroad-ebnf-beta`, `railroad-abnf-beta`, `railroad-peg-beta`
// share it) draws, per rule, one group holding: the definition (nested groups of boxes and track paths), a group
// with the bold rule name text (`<name> =`), a group with the start circle, one with the end circle and two
// track paths. The payload has no class attributes, so boxes are told apart by corner radius and text.

/** `aria-roledescription` values of the four railroad grammar diagram types. */
export const RAILROAD_TYPES = ['railroad', 'railroadEbnf', 'railroadAbnf', 'railroadPeg']

export function isRailroadType(type: string | null | undefined): boolean {
  return RAILROAD_TYPES.includes(String(type || ''))
}

export type RailroadBoxKind = 'Terminal' | 'NonTerminal' | 'Special'

/** `? text ?` is Mermaid's special-sequence label (also used for PEG `&x` / `!x` predicates). */
export function isSpecialLabel(text: string): boolean {
  return /^\?\s[\s\S]*\s\?$/.test(String(text || '').trim())
}

/** Terminal = rounded box (rx 10), non-terminal / special = square box. */
export function boxKind(cornerRadius: number, text: string): RailroadBoxKind {
  if (cornerRadius > 0.5) return 'Terminal'
  return isSpecialLabel(text) ? 'Special' : 'NonTerminal'
}

/** The bold rule-name text is `<name> =`. Returns the bare name, or null when the text is not a rule name. */
export function ruleNameOf(text: string, weight: number): string | null {
  if (weight < 600) return null
  const m = String(text || '').trim().match(/^([\s\S]*\S)\s*=$/)
  return m ? m[1].trim() : null
}

export const boxTitle = (kind: RailroadBoxKind, text: string): string => `${kind}: ${String(text || '').trim()}`

/** Start is the leftmost marker of a rule, End the rightmost; anything else stays a plain `Marker`. */
export function markerNames(xs: number[]): string[] {
  if (xs.length !== 2) return xs.map(() => 'Marker')
  return xs[0] <= xs[1] ? ['Start', 'End'] : ['End', 'Start']
}
