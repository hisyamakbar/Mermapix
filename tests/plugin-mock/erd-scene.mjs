// Synthetic Figma node tree resembling what createNodeFromSvg yields for a Mermaid ERD
// (layer names taken from real Figma audits: `mermaid-plugin-svg-2-entity-<Name>-<n>`,
// `…-id_entity-A-0_entity-B-1_0`, `…-cyclic-special-1`).
import { MockNode } from './figma-mock.mjs'

export const COLORS = {
  header: { r: 0.9333, g: 0.9451, b: 0.9608 }, // pair 0 fill (outer box)
  odd: { r: 1, g: 1, b: 1 }, // row pair fills
  even: { r: 0.9961, g: 0.9608, b: 0.9608 },
  border: { r: 0.5412, g: 0.5804, b: 0.651 }, // outline stroke
}
const solid = (c) => [{ type: 'SOLID', color: c }]

/**
 * rows: array of [type, name, key?, comment?] ; header is the entity name.
 * Structure: entity GROUP > pair GROUPs (fill VECTOR + outline VECTOR) ... + divider VECTORs + TEXTs.
 */
export function entity(env, svgId, name, index, { x, y, w, rows }) {
  const mk = (t, p) => new MockNode(env, t, p)
  const h = 30 * (rows.length + 1)
  const e = mk('GROUP', { name: `${svgId}-entity-${name}-${index}`, x, y, width: w, height: h })
  const pair = (fillColor, py, ph) => {
    const g = mk('GROUP', { name: 'Group' })
    g.appendChild(mk('VECTOR', { x, y: py, width: w, height: ph, fills: solid(fillColor) }))
    g.appendChild(mk('VECTOR', { x, y: py, width: w, height: ph, strokes: solid(COLORS.border) }))
    return g
  }
  e.appendChild(pair(COLORS.header, y, h)) // pair 0: outer box
  rows.forEach((_, i) => e.appendChild(pair(i % 2 === 0 ? COLORS.odd : COLORS.even, y + 30 * (i + 1), 30)))
  e.appendChild(mk('VECTOR', { x, y: y + 30, width: w, height: 0.01, strokes: solid(COLORS.border) })) // divider
  const text = (s, tx, ty) => e.appendChild(mk('TEXT', { characters: s, x: tx, y: ty, width: s.length * 6, height: 14 }))
  text(name, x + w / 2 - 20, y + 8)
  rows.forEach((r, i) => r.forEach((s, ci) => s && text(s, x + 8 + ci * 70, y + 38 + 30 * i)))
  return e
}

export function buildErdScene(env, svg) {
  const mk = (t, p) => new MockNode(env, t, p)
  const svgId = 'mermaid-plugin-svg-2'
  const root = mk('FRAME', { name: 'frame', width: 900, height: 700 })
  const rg = mk('GROUP', { name: 'root-0' })
  root.appendChild(rg)
  rg.appendChild(entity(env, svgId, 'ARTICLE', 1, { x: 10, y: 10, w: 300, rows: [['string', 'title', 'PK'], ['int', 'id', 'FK', 'the pk'], ['varchar(255)', 'slug', 'UK']] }))
  rg.appendChild(entity(env, svgId, 'KNOWLEDGE_BASE', 0, { x: 400, y: 10, w: 220, rows: [['string', 'name'], ['int', 'id']] }))
  rg.appendChild(entity(env, svgId, 'CATEGORY', 4, { x: 700, y: 10, w: 180, rows: [['int', 'id']] }))
  // relationship edge + self-relationship pieces: must NOT be treated as entities
  rg.appendChild(mk('VECTOR', { name: `${svgId}-id_entity-KNOWLEDGE_BASE-0_entity-ARTICLE-1_0`, x: 230, y: 40, width: 70, height: 2, strokes: solid(COLORS.border) }))
  for (const s of ['1', 'mid', '2']) rg.appendChild(mk('VECTOR', { name: `mermaid-svg-0-entity-CATEGORY-4-cyclic-special-${s}`, x: 700, y: 100, width: 20, height: 20, strokes: solid(COLORS.border) }))
  // inlined marker groups: Figma names them by the injected `id` attribute
  for (const m of svg.matchAll(/<g id="(inlined-marker[^"]*)"/g)) {
    const g = mk('GROUP', { name: m[1] })
    g.appendChild(mk('VECTOR', { width: 8, height: 8, strokes: solid(COLORS.border) }))
    rg.appendChild(g)
  }
  return root
}
