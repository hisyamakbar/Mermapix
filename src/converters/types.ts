export type TableNaming = 'preserve' | 'snake_case' | 'PascalCase'

export type ColumnDef = {
  name: string
  type: string
  isPk?: boolean
  isFk?: boolean
  isUk?: boolean
  comment?: string
}

export type TableDef = {
  name: string
  columns: ColumnDef[]
}

export type RelationDef = {
  fromTable: string
  toTable: string
  cardinality?: string
  label?: string
}

export type ParsedSchema = {
  tables: TableDef[]
  relations: RelationDef[]
}
