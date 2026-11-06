// Pure helpers for the test runner: grid placement and page naming. No Figma API.

export interface GridCell {
  id: string
  row: number
  col: number
  width: number
  height: number
}

export interface GridOptions {
  gapX: number
  gapY: number
}

export interface GridPlan {
  positions: Record<string, { x: number; y: number }>
  colWidths: number[]
  rowHeights: number[]
  width: number
  height: number
}

/**
 * Aligned grid: every column is as wide as its widest cell and every row as tall as its tallest,
 * so cells never overlap however large a diagram is. Cells sit at the top-left of their slot.
 * Row/col indexes may be sparse; empty rows/cols take no space.
 */
export function planGrid(cells: GridCell[], opts: GridOptions): GridPlan {
  const colWidth = new Map<number, number>()
  const rowHeight = new Map<number, number>()
  for (const c of cells) {
    colWidth.set(c.col, Math.max(colWidth.get(c.col) ?? 0, c.width))
    rowHeight.set(c.row, Math.max(rowHeight.get(c.row) ?? 0, c.height))
  }
  const cols = [...colWidth.keys()].sort((a, b) => a - b)
  const rows = [...rowHeight.keys()].sort((a, b) => a - b)
  const colX = new Map<number, number>()
  const rowY = new Map<number, number>()
  let x = 0
  for (const c of cols) {
    colX.set(c, x)
    x += colWidth.get(c)! + opts.gapX
  }
  let y = 0
  for (const r of rows) {
    rowY.set(r, y)
    y += rowHeight.get(r)! + opts.gapY
  }
  const positions: Record<string, { x: number; y: number }> = {}
  for (const c of cells) positions[c.id] = { x: colX.get(c.col)!, y: rowY.get(c.row)! }
  return {
    positions,
    colWidths: cols.map((c) => colWidth.get(c)!),
    rowHeights: rows.map((r) => rowHeight.get(r)!),
    width: cols.length ? x - opts.gapX : 0,
    height: rows.length ? y - opts.gapY : 0,
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** `Test Run YYYY-MM-DD HH:mm` (local time). */
export function formatRunName(d: Date): string {
  return `Test Run ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Section / diagram label: `<fixture> · <theme>`. */
export function diagramLabel(fixture: string, theme: string): string {
  return `${fixture} · ${theme}`
}

export type ThemeMode = 'both' | 'light' | 'dark'

/** Keeps fixtures whose name contains any comma/space separated token (case-insensitive). Empty filter keeps all. */
export function filterFixtures(names: string[], filter: string): string[] {
  const tokens = filter
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
  if (!tokens.length) return names.slice()
  return names.filter((n) => tokens.some((t) => n.toLowerCase().includes(t)))
}

export interface RunItem {
  key: string
  fixture: string
  theme: 'light' | 'dark'
  row: number
  col: number
}

/** One row per fixture; dark in column 0 and light in column 1 when both are selected. */
export function buildRunItems(fixtures: string[], mode: ThemeMode): RunItem[] {
  const themes: ('light' | 'dark')[] = mode === 'both' ? ['dark', 'light'] : [mode]
  const items: RunItem[] = []
  fixtures.forEach((fixture, row) => {
    themes.forEach((theme, col) => {
      items.push({ key: `${fixture}|${theme}`, fixture, theme, row, col })
    })
  })
  return items
}
