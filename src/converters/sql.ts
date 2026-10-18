import type { ColumnDef, ParsedSchema, RelationDef, TableDef, TableNaming } from './types.ts'
import { schemaToMermaid } from './utils.ts'

export function parseSql(content: string): ParsedSchema {
  const tables: TableDef[] = []
  const relations: RelationDef[] = []

  // Strip SQL comments: -- ... and /* ... */
  const clean = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')

  // Regex to match CREATE TABLE statements
  const createTableRegex = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"']?([A-Za-z0-9_]+)[`"']?\s*\(([\s\S]*?)\)(?:\s*;|\s+ENGINE|\s*$)/gi
  let match: RegExpExecArray | null

  while ((match = createTableRegex.exec(clean)) !== null) {
    const rawTableName = match[1]
    const body = match[2]
    const columns: ColumnDef[] = []
    const tableLevelPks: string[] = []
    const tableLevelUks: string[] = []

    // Split body into comma-separated items, respecting parentheses like VARCHAR(255), DECIMAL(10, 2)
    const items: string[] = []
    let current = ''
    let depth = 0
    for (let i = 0; i < body.length; i++) {
      const char = body[i]
      if (char === '(') depth++
      else if (char === ')') depth--

      if (char === ',' && depth === 0) {
        items.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) {
      items.push(current.trim())
    }

    for (const item of items) {
      if (!item) continue

      // Check table constraints first
      // PRIMARY KEY (col1, col2)
      const pkMatch = item.match(/^(?:CONSTRAINT\s+[`"']?[A-Za-z0-9_]+[`"']?\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i)
      if (pkMatch) {
        const pks = pkMatch[1].split(',').map((p) => p.replace(/[`"'\s]/g, ''))
        tableLevelPks.push(...pks)
        continue
      }

      // FOREIGN KEY (col) REFERENCES target_table(target_col)
      const fkMatch = item.match(
        /^(?:CONSTRAINT\s+[`"']?[A-Za-z0-9_]+[`"']?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+[`"']?([A-Za-z0-9_]+)[`"']?\s*\(([^)]+)\)/i,
      )
      if (fkMatch) {
        const fkCols = fkMatch[1].split(',').map((p) => p.replace(/[`"'\s]/g, ''))
        const targetTable = fkMatch[2]
        relations.push({
          fromTable: targetTable,
          toTable: rawTableName,
          cardinality: '||--o{',
        })
        for (const colName of fkCols) {
          const c = columns.find((col) => col.name.toLowerCase() === colName.toLowerCase())
          if (c) c.isFk = true
        }
        continue
      }

      // UNIQUE (col1, col2)
      const ukMatch = item.match(/^(?:CONSTRAINT\s+[`"']?[A-Za-z0-9_]+[`"']?\s+)?UNIQUE(?:\s+KEY)?\s*\(([^)]+)\)/i)
      if (ukMatch) {
        const uks = ukMatch[1].split(',').map((p) => p.replace(/[`"'\s]/g, ''))
        tableLevelUks.push(...uks)
        continue
      }

      // Skip other constraints like CHECK (...), KEY `idx` (...)
      if (/^(?:CONSTRAINT|CHECK|KEY|INDEX)\b/i.test(item)) {
        continue
      }

      // Otherwise column definition:
      // name TYPE [NULL/NOT NULL] [PRIMARY KEY] [UNIQUE] [REFERENCES target(id)] [COMMENT '...']
      const colMatch = item.match(/^[`"']?([A-Za-z0-9_]+)[`"']?\s+([A-Za-z0-9_]+(?:\([^)]+\))?)(.*)$/i)
      if (colMatch) {
        const colName = colMatch[1]
        const colType = colMatch[2]
        const rest = colMatch[3]

        const isPk = /\bPRIMARY\s+KEY\b/i.test(rest)
        const isUk = /\bUNIQUE\b/i.test(rest)
        let isFk = false
        let comment: string | undefined

        // Inline REFERENCES table(col)
        const inlineRef = rest.match(/\bREFERENCES\s+[`"']?([A-Za-z0-9_]+)[`"']?\s*\(([^)]+)\)/i)
        if (inlineRef) {
          isFk = true
          const targetTable = inlineRef[1]
          relations.push({
            fromTable: targetTable,
            toTable: rawTableName,
            cardinality: '||--o{',
          })
        }

        // COMMENT 'text'
        const commentMatch = rest.match(/COMMENT\s+['"]([^'"]+)['"]/i)
        if (commentMatch) {
          comment = commentMatch[1]
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

    // Apply table-level PKs and UKs
    for (const col of columns) {
      if (tableLevelPks.some((pk) => pk.toLowerCase() === col.name.toLowerCase())) {
        col.isPk = true
      }
      if (tableLevelUks.some((uk) => uk.toLowerCase() === col.name.toLowerCase())) {
        col.isUk = true
      }
    }

    tables.push({
      name: rawTableName,
      columns,
    })
  }

  // Also check standalone ALTER TABLE statements adding FOREIGN KEY
  const alterTableRegex = /ALTER\s+TABLE\s+[`"']?([A-Za-z0-9_]+)[`"']?\s+ADD\s+(?:CONSTRAINT\s+[`"']?[A-Za-z0-9_]+[`"']?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+[`"']?([A-Za-z0-9_]+)[`"']?\s*\(([^)]+)\)/gi
  let alterMatch: RegExpExecArray | null
  while ((alterMatch = alterTableRegex.exec(clean)) !== null) {
    const childTable = alterMatch[1]
    const childCols = alterMatch[2].split(',').map((p) => p.replace(/[`"'\s]/g, ''))
    const parentTable = alterMatch[3]

    relations.push({
      fromTable: parentTable,
      toTable: childTable,
      cardinality: '||--o{',
    })

    const foundTable = tables.find((t) => t.name.toLowerCase() === childTable.toLowerCase())
    if (foundTable) {
      for (const colName of childCols) {
        const foundCol = foundTable.columns.find((c) => c.name.toLowerCase() === colName.toLowerCase())
        if (foundCol) foundCol.isFk = true
      }
    }
  }

  return { tables, relations }
}

export function convertSqlToMermaid(content: string, naming: TableNaming = 'preserve'): string {
  const schema = parseSql(content)
  return schemaToMermaid(schema, naming)
}
