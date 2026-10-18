import type { ParsedSchema, TableNaming } from './types.ts'

export function transformTableName(name: string, naming: TableNaming = 'preserve'): string {
  if (naming === 'preserve') return name
  const clean = name.replace(/[`"'\\]/g, '').trim()
  if (naming === 'snake_case') {
    return clean
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toLowerCase()
  }
  if (naming === 'PascalCase') {
    return clean
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('')
  }
  return clean
}

export function schemaToMermaid(schema: ParsedSchema, naming: TableNaming = 'preserve'): string {
  const lines: string[] = ['erDiagram']
  const tableMap = new Map<string, string>()

  for (const table of schema.tables) {
    tableMap.set(table.name, transformTableName(table.name, naming))
  }

  // Deduplicate relations
  const seenRels = new Set<string>()
  for (const rel of schema.relations) {
    const from = tableMap.get(rel.fromTable) ?? transformTableName(rel.fromTable, naming)
    const to = tableMap.get(rel.toTable) ?? transformTableName(rel.toTable, naming)
    const key = `${from}:${to}`
    if (seenRels.has(key)) continue
    seenRels.add(key)
    const card = rel.cardinality || '||--o{'
    const label = rel.label ? ` : "${rel.label}"` : ' : references'
    lines.push(`  ${from} ${card} ${to}${label}`)
  }

  if (schema.relations.length > 0 && schema.tables.length > 0) {
    lines.push('')
  }

  // Tables
  for (const table of schema.tables) {
    const tName = tableMap.get(table.name) ?? transformTableName(table.name, naming)
    lines.push(`  ${tName} {`)
    for (const col of table.columns) {
      const typeStr = (col.type || 'string').replace(/[\s,]+/g, '_')
      const nameStr = col.name.replace(/[`"'\s]/g, '')
      const parts: string[] = [typeStr, nameStr]
      const keys: string[] = []
      if (col.isPk) keys.push('PK')
      if (col.isFk) keys.push('FK')
      if (col.isUk) keys.push('UK')
      if (keys.length > 0) {
        parts.push(keys.join(', '))
      }
      if (col.comment) {
        parts.push(`"${col.comment.replace(/"/g, "'")}"`)
      }
      lines.push(`    ${parts.join(' ')}`)
    }
    lines.push('  }')
  }

  return lines.join('\n')
}
