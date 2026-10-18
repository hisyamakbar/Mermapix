import type { ColumnDef, ParsedSchema, RelationDef, TableDef, TableNaming } from './types.ts'
import { schemaToMermaid } from './utils.ts'

export function parseDbml(content: string): ParsedSchema {
  const tables: TableDef[] = []
  const relations: RelationDef[] = []

  // Remove single line comments // and multi-line comments /* ... */
  const clean = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  // Extract Table blocks
  const tableRegex = /Table\s+([A-Za-z0-9_."]+)(?:\s+as\s+[A-Za-z0-9_]+)?\s*\{([^}]*)\}/gi
  let tableMatch: RegExpExecArray | null

  while ((tableMatch = tableRegex.exec(clean)) !== null) {
    const rawTableName = tableMatch[1].replace(/[`"']/g, '').trim()
    const body = tableMatch[2]
    const columns: ColumnDef[] = []

    const lines = body.split('\n')
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//') || line.startsWith('Note:')) continue

      // Match column definition: name type [settings]
      const colMatch = line.match(/^([A-Za-z0-9_]+)\s+([A-Za-z0-9_(),.]+)(?:\s*\[(.*)\])?/)
      if (colMatch) {
        const colName = colMatch[1]
        const colType = colMatch[2]
        const settings = colMatch[3] || ''

        let isPk = /primary\s+key|\bpk\b/i.test(settings)
        let isUk = /\bunique\b/i.test(settings)
        let isFk = false
        let comment: string | undefined

        // Note in settings: note: 'my note'
        const noteMatch = settings.match(/note:\s*['"]([^'"]+)['"]/i)
        if (noteMatch) {
          comment = noteMatch[1]
        }

        // Inline ref: ref: > users.id
        const inlineRef = settings.match(/ref:\s*([><-])\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/i)
        if (inlineRef) {
          isFk = true
          const op = inlineRef[1]
          const targetTable = inlineRef[2]
          if (op === '>') {
            relations.push({
              fromTable: targetTable,
              toTable: rawTableName,
              cardinality: '||--o{',
            })
          } else if (op === '<') {
            relations.push({
              fromTable: rawTableName,
              toTable: targetTable,
              cardinality: '||--o{',
            })
          } else {
            relations.push({
              fromTable: targetTable,
              toTable: rawTableName,
              cardinality: '||--||',
            })
          }
        }

        columns.push({
          name: colName,
          type: colType,
          isPk,
          isFk,
          isUk,
          comment,
        })
      }
    }

    tables.push({
      name: rawTableName,
      columns,
    })
  }

  // Extract standalone Ref definitions:
  // Ref: posts.user_id > users.id
  // Ref fk_name: orders.customer_id > customers.id
  const refRegex = /Ref(?:\s+[A-Za-z0-9_]+)?:\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*([><-])\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/gi
  let refMatch: RegExpExecArray | null
  while ((refMatch = refRegex.exec(clean)) !== null) {
    const fromTable = refMatch[1]
    const fromCol = refMatch[2]
    const op = refMatch[3]
    const toTable = refMatch[4]
    const toCol = refMatch[5]

    // Mark FK on the child table column
    const childTable = op === '>' ? fromTable : toTable
    const childCol = op === '>' ? fromCol : toCol
    const foundTable = tables.find((t) => t.name === childTable)
    const foundCol = foundTable?.columns.find((c) => c.name === childCol)
    if (foundCol) foundCol.isFk = true

    if (op === '>') {
      // posts.user_id > users.id => users ||--o{ posts
      relations.push({
        fromTable: toTable,
        toTable: fromTable,
        cardinality: '||--o{',
      })
    } else if (op === '<') {
      relations.push({
        fromTable: fromTable,
        toTable: toTable,
        cardinality: '||--o{',
      })
    } else {
      relations.push({
        fromTable: toTable,
        toTable: fromTable,
        cardinality: '||--||',
      })
    }
  }

  return { tables, relations }
}

export function convertDbmlToMermaid(content: string, naming: TableNaming = 'preserve'): string {
  const schema = parseDbml(content)
  return schemaToMermaid(schema, naming)
}
