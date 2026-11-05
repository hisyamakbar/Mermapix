// Pure naming helpers (no `figma` usage): entity matching and layer-name mapping.
// Kept free of Figma APIs so they are unit-testable in node.

/** Mermaid ER entity group ids look like `<svgId>-entity-<Name>-<index>`. */
const ENTITY_NAME_RE = /-entity-(.+)-(\d+)$/

/**
 * True for the GROUP that holds one ER entity table.
 * Excludes relationship edges (`…id_entity-A-0_entity-B-1_0`) and self-relationship
 * pieces (`…-entity-X-4-cyclic-special-1`). Decided on the exact layer name, never on
 * substrings like "edge"/"label", so a table named KNOWLEDGE_BASE is a normal entity.
 */
export function isErdEntityName(name: string | null | undefined): boolean {
  if (!name || typeof name !== 'string') return false
  if (name.includes('id_entity') || name.includes('cyclic-special')) return false
  return ENTITY_NAME_RE.test(name)
}

export type MarkerKind =
  | 'crowsfoot-only-one'
  | 'crowsfoot-zero-or-one'
  | 'crowsfoot-one-or-more'
  | 'crowsfoot-zero-or-more'
  | 'arrowhead'
  | 'cross'
  | 'circle'
  | 'sequence-number'
  | 'inheritance'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'lollipop'
  | 'marker'

export type MarkerPosition = 'start' | 'end'

/** Classify a Mermaid `<marker id="…">` into a stable kind. */
export function markerKindFromId(markerId: string | null | undefined): MarkerKind {
  const id = (markerId || '').toLowerCase()
  if (id.includes('sequencenumber')) return 'sequence-number'
  if (id.includes('er-onlyone')) return 'crowsfoot-only-one'
  if (id.includes('er-zeroorone')) return 'crowsfoot-zero-or-one'
  if (id.includes('er-oneormore')) return 'crowsfoot-one-or-more'
  if (id.includes('er-zeroormore')) return 'crowsfoot-zero-or-more'
  if (id.includes('extension')) return 'inheritance'
  if (id.includes('composition')) return 'composition'
  if (id.includes('aggregation')) return 'aggregation'
  if (id.includes('dependency')) return 'dependency'
  if (id.includes('lollipop')) return 'lollipop'
  if (id.includes('cross')) return 'cross'
  if (id.includes('circle')) return 'circle'
  if (id.includes('point') || id.includes('arrowhead') || id.includes('head')) return 'arrowhead'
  return 'marker'
}

const MARKER_ID_PREFIX = 'inlined-marker'
const MARKER_ID_RE = /^inlined-marker-\d+-([a-z-]+)-(start|end)$/

/** Unique SVG id given to an inlined marker `<g>`; Figma uses it as the layer name. */
export function buildMarkerLayerId(index: number, kind: MarkerKind, position: MarkerPosition): string {
  return `${MARKER_ID_PREFIX}-${index}-${kind}-${position}`
}

const FIXED_MARKER_LABELS: Partial<Record<MarkerKind, string>> = {
  'sequence-number': 'Sequence Number Badge',
  inheritance: 'Inheritance Arrow',
  composition: 'Composition Diamond',
  aggregation: 'Aggregation Diamond',
  dependency: 'Dependency Arrow',
  lollipop: 'Lollipop',
  marker: 'Marker',
}

const POSITIONED_MARKER_LABELS: Partial<Record<MarkerKind, string>> = {
  'crowsfoot-only-one': "Crow's Foot: only-one",
  'crowsfoot-zero-or-one': "Crow's Foot: zero-or-one",
  'crowsfoot-one-or-more': "Crow's Foot: one-or-more",
  'crowsfoot-zero-or-more': "Crow's Foot: zero-or-more",
  arrowhead: 'Arrowhead',
  cross: 'Cross',
  circle: 'Circle',
}

/** Human layer name for a layer whose current name contains `inlined-marker`. */
export function markerLayerName(layerName: string): string {
  const m = MARKER_ID_RE.exec((layerName || '').trim().toLowerCase())
  if (!m) return 'Marker'
  const kind = m[1] as MarkerKind
  const position = m[2]
  const fixed = FIXED_MARKER_LABELS[kind]
  if (fixed) return fixed
  const positioned = POSITIONED_MARKER_LABELS[kind]
  return positioned ? `${positioned} (${position})` : 'Marker'
}

/** Parent layer names (lowercased) whose unnamed vectors are connector lines. */
export function isConnectorLayerName(name: string | null | undefined): boolean {
  const n = (name || '').toLowerCase()
  return /edgepath|edgelabel|(^|[^a-z0-9])l_[a-z0-9]|id_entity|cyclic-special/.test(n)
}

/** Parent layer names (lowercased) whose unnamed vectors are flowchart node shapes. */
export function isShapeLayerName(name: string | null | undefined): boolean {
  const n = (name || '').toLowerCase()
  return n.includes('flowchart-') || /(^|\s)node(\s|$)/.test(n)
}
