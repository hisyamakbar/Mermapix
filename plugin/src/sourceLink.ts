// Source-linked diagrams (Phase 11): a diagram inserted by the plugin remembers its Mermaid source in
// private plugin data on its root node, so it can be found again from any layer inside it and regenerated.
//
// Everything here is pure: no top-level `figma` access, only the node objects passed in. That keeps it
// importable from unit tests (`node --experimental-strip-types`) and from the sandbox bundle alike.
//
// The stored format is versioned (`v: 1`) and must stay readable by later plugin versions: files that hold
// diagrams outlive the plugin build that wrote them.

import type { DiagramTheme } from './protocol.ts'

/** Plugin data key holding the JSON payload `{ v: 1, source, theme, type }`. */
export const DIAGRAM_KEY = 'mermapix:diagram'
/** Plugin data key holding the structural fingerprint written right after the plugin last built the tree. */
export const FINGERPRINT_KEY = 'mermapix:fingerprint'
/** Every plugin data key this plugin writes on a diagram root starts with this prefix. */
export const DATA_PREFIX = 'mermapix:'

/** Figma limits one plugin data entry (key + value) to 100 kB; stay clear of it. */
export const MAX_ENTRY_BYTES = 90000

export interface StoredDiagram {
  v: 1
  /** Mermaid source exactly as it was in the editor. */
  source: string
  theme: DiagramTheme
  /** `aria-roledescription` of the diagram (`flowchart-v2`, `erDiagram`, ...), '' when unknown. */
  type: string
}

/** UTF-8 byte length of a string, counted by hand (the sandbox has no guaranteed TextEncoder). */
export function utf8Length(s: string): number {
  let bytes = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

/** The JSON entry to store, or null when it would not fit into one plugin data entry. */
export function encodeDiagram(d: { source: string; theme: DiagramTheme; type?: string }): string | null {
  if (typeof d.source !== 'string') return null
  const entry = JSON.stringify({ v: 1, source: d.source, theme: d.theme === 'dark' ? 'dark' : 'light', type: d.type || '' })
  if (utf8Length(DIAGRAM_KEY) + utf8Length(entry) > MAX_ENTRY_BYTES) return null
  return entry
}

/** Parses a stored entry. Garbage, empty values and unknown versions give null; never throws. */
export function decodeDiagram(raw: unknown): StoredDiagram | null {
  if (typeof raw !== 'string' || raw === '') return null
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || data.v !== 1) return null
  if (typeof data.source !== 'string') return null
  if (data.theme !== 'light' && data.theme !== 'dark') return null
  return { v: 1, source: data.source, theme: data.theme, type: typeof data.type === 'string' ? data.type : '' }
}

function pluginData(node: any, key: string): string {
  try {
    if (node && typeof node.getPluginData === 'function') {
      const v = node.getPluginData(key)
      return typeof v === 'string' ? v : ''
    }
  } catch {}
  return ''
}

/** The decoded source link stored on exactly this node (not its ancestors), or null. */
export function readDiagram(node: any): StoredDiagram | null {
  return decodeDiagram(pluginData(node, DIAGRAM_KEY))
}

/** Walks `parent` up from `node` to the first node whose `mermapix:diagram` decodes; null when none. */
export function findDiagramRoot(node: any): any | null {
  let n = node
  for (let guard = 0; n && guard < 10000; guard++) {
    if (readDiagram(n)) return n
    n = n.parent
  }
  return null
}

/**
 * A diagram can be regenerated in place unless its root or any ancestor is a component INSTANCE (the
 * children of an instance are read-only). The source can still be loaded in that case.
 */
export function editability(node: any): { editable: true } | { editable: false; reason: 'instance' } {
  let n = node
  for (let guard = 0; n && guard < 10000; guard++) {
    if (n.type === 'INSTANCE') return { editable: false, reason: 'instance' }
    n = n.parent
  }
  return { editable: true }
}

// ---------------------------------------------------------------- fingerprint

const FNV_PRIME = 0x01000193

function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  return h
}

function hex8(n: number): string {
  return ('00000000' + (n >>> 0).toString(16)).slice(-8)
}

/** Rounded number, or '' for anything that is not a finite number (undefined, figma.mixed symbol). */
function num(v: unknown): string {
  return typeof v === 'number' && isFinite(v) ? String(Math.round(v)) : ''
}

function solidFills(node: any): string {
  let fills: any
  try {
    fills = node.fills
  } catch {
    return ''
  }
  if (!Array.isArray(fills)) return ''
  const out: string[] = []
  for (const p of fills) {
    if (!p || p.type !== 'SOLID' || !p.color) continue
    const c = p.color
    const op = typeof p.opacity === 'number' ? Math.round(p.opacity * 100) : 100
    out.push(`${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${op}${p.visible === false ? 'h' : ''}`)
  }
  return out.join(';')
}

function describe(node: any, isRoot: boolean): string {
  const size = `${num(node.width)}x${num(node.height)}`
  // The root's own position and name are not part of the content: moving or renaming the whole diagram is not an edit.
  const geom = isRoot ? size : `${num(node.x)},${num(node.y)},${size}`
  const name = isRoot ? '' : typeof node.name === 'string' ? node.name : ''
  const text = node.type === 'TEXT' && typeof node.characters === 'string' ? node.characters : ''
  // The root's type is not content either: the user may turn the diagram frame into a component.
  return `${isRoot ? 'ROOT' : node.type}|${name}|${geom}|${text}|${solidFills(node)}`
}

/**
 * Stable hash of the diagram tree: a DFS over the root's descendants (type, name, bounds relative to the
 * parent rounded to integers, text characters, solid fill colors) plus the root's own size. Excludes the
 * root's x/y, name and type (FRAME vs COMPONENT). Two independent 32-bit FNV-1a passes make it a 64-bit hex string.
 */
export function fingerprint(root: any): string {
  const parts: string[] = []
  const visit = (n: any, isRoot: boolean) => {
    if (!n || n.removed) return
    parts.push(describe(n, isRoot))
    const kids = n.children
    if (Array.isArray(kids)) {
      parts.push('(')
      for (const c of kids) visit(c, false)
      parts.push(')')
    }
  }
  visit(root, true)
  const s = parts.join('\n')
  return hex8(fnv1a(s, 0x811c9dc5)) + hex8(fnv1a(s, 0x01000193 ^ 0x9e3779b9))
}

// ---------------------------------------------------------------- writing

/** Short text shown next to the relaunch button. */
export const RELAUNCH_LABEL = 'Edit this diagram from its Mermaid source'

/**
 * Records the structural fingerprint and the relaunch button on a diagram root. Call it after the tree
 * is final. The relaunch API is missing in some editors and in the mock, so it is guarded.
 */
export function stampDiagram(root: any): void {
  try {
    root.setPluginData(FINGERPRINT_KEY, fingerprint(root))
  } catch {}
  try {
    if (typeof root.setRelaunchData === 'function') root.setRelaunchData({ edit: RELAUNCH_LABEL })
  } catch {}
}

/**
 * Stores the source link on a diagram root (fingerprint and relaunch data included). Returns false and
 * stores nothing when the entry would exceed the plugin data limit or the node refuses plugin data.
 */
export function storeDiagram(root: any, d: { source: string; theme: DiagramTheme; type?: string }): boolean {
  const entry = encodeDiagram(d)
  if (entry === null) return false
  try {
    root.setPluginData(DIAGRAM_KEY, entry)
  } catch {
    return false
  }
  stampDiagram(root)
  return true
}
