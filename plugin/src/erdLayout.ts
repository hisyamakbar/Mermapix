// ERD column width planning (pure math, unit-testable).

/** Horizontal cell padding (8 left + 8 right) used by every ERD cell. */
export const CELL_PADDING_X = 16
/** Extra px per column to absorb Figma-vs-browser text metric differences. */
export const COLUMN_SLACK = 2
const MIN_COLUMN = 24

export interface ColumnContent {
  /** Widest text (type column), 0 if the column does not exist. */
  type: number
  name: number
  /** Widest total of badge widths + gaps in a row, 0 if none. */
  key: number
  comment: number
  hasType: boolean
  hasKey: boolean
  hasComment: boolean
}

export interface ColumnWidths {
  type: number
  name: number
  key: number
  comment: number
}

/**
 * Plan widths so every column fits its widest content (text width + cell padding),
 * summing exactly to `tableWidth`. The Name column takes the remainder. If the content
 * cannot fit, all columns shrink proportionally (the table keeps Mermaid's width so
 * connectors stay attached).
 */
export function computeColumnWidths(tableWidth: number, c: ColumnContent): ColumnWidths {
  const need = (w: number) => Math.ceil(w) + CELL_PADDING_X + COLUMN_SLACK
  const needs: ColumnWidths = {
    type: c.hasType ? need(c.type) : 0,
    name: Math.max(MIN_COLUMN, need(c.name)),
    key: c.hasKey ? need(c.key) : 0,
    comment: c.hasComment ? need(c.comment) : 0,
  }
  const total = needs.type + needs.name + needs.key + needs.comment

  if (total <= tableWidth) {
    const fixed = needs.type + needs.key + needs.comment
    return { ...needs, name: tableWidth - fixed }
  }

  const scale = tableWidth / total
  const shrink = (w: number) => (w === 0 ? 0 : Math.max(MIN_COLUMN, Math.floor(w * scale)))
  const type = shrink(needs.type)
  const key = shrink(needs.key)
  const comment = shrink(needs.comment)
  return { type, key, comment, name: Math.max(MIN_COLUMN, tableWidth - type - key - comment) }
}
