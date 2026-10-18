import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDbml, convertDbmlToMermaid } from '../../src/converters/dbml.ts'
import { parseSql, convertSqlToMermaid } from '../../src/converters/sql.ts'
import { transformTableName } from '../../src/converters/utils.ts'

test('transformTableName handles cases properly', () => {
  assert.equal(transformTableName('user_profiles', 'PascalCase'), 'UserProfiles')
  assert.equal(transformTableName('UserProfiles', 'snake_case'), 'user_profiles')
  assert.equal(transformTableName('UserProfiles', 'preserve'), 'UserProfiles')
})

test('DBML converter parses tables, columns, and relations', () => {
  const dbml = `
    Table users {
      id integer [pk]
      username varchar [unique, note: 'user handle']
      created_at timestamp
    }

    Table posts {
      id integer [primary key]
      user_id integer [ref: > users.id]
      title varchar
    }
  `

  const schema = parseDbml(dbml)
  assert.equal(schema.tables.length, 2)
  assert.equal(schema.relations.length, 1)

  const users = schema.tables.find((t) => t.name === 'users')
  assert.ok(users)
  assert.equal(users.columns.find((c) => c.name === 'id')?.isPk, true)
  assert.equal(users.columns.find((c) => c.name === 'username')?.isUk, true)
  assert.equal(users.columns.find((c) => c.name === 'username')?.comment, 'user handle')

  const posts = schema.tables.find((t) => t.name === 'posts')
  assert.ok(posts)
  assert.equal(posts.columns.find((c) => c.name === 'user_id')?.isFk, true)

  const mermaid = convertDbmlToMermaid(dbml)
  assert.match(mermaid, /^erDiagram/)
  assert.match(mermaid, /users \|\|--o\{ posts : references/)
  assert.match(mermaid, /integer id PK/)
  assert.match(mermaid, /varchar username UK "user handle"/)
})

test('SQL converter parses CREATE TABLE, types, keys, and foreign keys', () => {
  const sql = `
    CREATE TABLE users (
      id INT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(100)
    );

    CREATE TABLE orders (
      id INT,
      user_id INT,
      total_price DECIMAL(10,2),
      PRIMARY KEY (id),
      CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `

  const schema = parseSql(sql)
  assert.equal(schema.tables.length, 2)
  assert.equal(schema.relations.length, 1)

  const users = schema.tables.find((t) => t.name === 'users')
  assert.ok(users)
  assert.equal(users.columns.find((c) => c.name === 'id')?.isPk, true)
  assert.equal(users.columns.find((c) => c.name === 'email')?.isUk, true)

  const orders = schema.tables.find((t) => t.name === 'orders')
  assert.ok(orders)
  assert.equal(orders.columns.find((c) => c.name === 'id')?.isPk, true)
  assert.equal(orders.columns.find((c) => c.name === 'user_id')?.isFk, true)

  const mermaid = convertSqlToMermaid(sql, 'PascalCase')
  assert.match(mermaid, /^erDiagram/)
  assert.match(mermaid, /Users \|\|--o\{ Orders/)
  assert.match(mermaid, /INT id PK/)
})
