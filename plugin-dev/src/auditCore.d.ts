// Types for auditCore.js (plain JS so it can be pasted into the Figma MCP `use_figma` tool).

export const AUDIT_NS: string
export interface AuditMeta {
  fixture?: string
  theme?: 'light' | 'dark'
  svgTextCount?: number
  [key: string]: unknown
}
export interface DiagramAudit {
  id: string
  name: string
  size: string
  counts: {
    GROUP: number
    VECTOR: number
    TEXT: number
    FRAME: number
    autoLayoutFrames: number
    maxDepth: number
  }
  duplicateStacks: number
  looseShapes: number
  unconvertedTables: string[]
  overflowingText: string[]
  unnamedLayers: number
  contentOverflow: {
    count: number
    px: { left: number; top: number; right: number; bottom: number }
    examples: string[]
  }
  textsExpected: number | null
  textsLost: number | null
  blackBoxes: { count: number; examples: string[] } | null
}
export function walk(n: any, fn: (n: any, depth: number) => void, depth?: number): void
export function isInsideAutoLayout(n: any, root: any): boolean
export function countSvgTexts(svg: string): number
export function isWrongThemeInk(
  color: { r: number; g: number; b: number } | null | undefined,
  theme?: string,
): boolean
export function readMeta(n: any): AuditMeta
export function auditDiagram(root: any, meta?: AuditMeta): DiagramAudit
export function summarizeAudit(a: DiagramAudit): { ok: boolean; issues: string[] }
export function findDiagramRoots(page: any): any[]
