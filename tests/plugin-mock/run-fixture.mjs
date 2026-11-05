// Runs the built plugin (plugin/code.js) on a real Mermaid payload SVG from tests/fixtures/plugin
// through the mock SVG importer (which imitates figma.createNodeFromSvg).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { runPlugin } from './figma-mock.mjs'
import { importSvg } from './svg-import.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const CODE = path.resolve(here, '../../plugin/code.js')
export const FIXTURE_DIR = path.resolve(here, '../fixtures/plugin')

// Subset of src/themes/presets.ts THEME_PRESETS (what the plugin UI posts as `themeVariables`).
export const THEMES = {
  dark: { darkMode: true, primaryColor: '#1e293b', primaryTextColor: '#f8fafc', primaryBorderColor: '#38bdf8', lineColor: '#38bdf8', background: '#090d16', edgeLabelBackground: '#1e293b', attributeBackgroundColorOdd: '#1e293b', attributeBackgroundColorEven: '#131b2e' },
  light: { primaryColor: '#f8fafc', primaryTextColor: '#09090b', primaryBorderColor: '#e4e4e7', lineColor: '#e4e4e7', background: '#ffffff', edgeLabelBackground: '#ffffff', attributeBackgroundColorOdd: '#ffffff', attributeBackgroundColorEven: '#fafafa' },
}
export const EXAMPLES = ['1-ex-erd', '2-ex-flowchart', '3-ex-sequence', '4-ex-sitemap']
// Flowchart-type fixtures (Phase 8.3): the two built-in examples + the nested-subgraph edge-case fixture
// (tests/figma-fixtures/07-flowchart-nested-subgraphs.mmd).
export const FLOW_EXAMPLES = ['2-ex-flowchart', '4-ex-sitemap', '7-case-nested-subgraphs']

export const fixturePath = (example, theme) => path.join(FIXTURE_DIR, `${example}${theme === 'light' ? '-light' : ''}.svg`)

/** Returns { svg, svgSeen (what createNodeFromSvg received), tree (serialized result), root (live result), log }. */
export async function runFixture(example, theme) {
  const svg = fs.readFileSync(fixturePath(example, theme), 'utf8')
  const r = await runPlugin(CODE, svg, (env, s) => importSvg(env, s), { theme, themeVariables: THEMES[theme] })
  return { svg, ...r }
}

/** Absolute bounds of a node in root-frame coordinates (GROUPs are coordinate-transparent). */
export function absOrigin(parent) {
  if (!parent) return { x: 0, y: 0 }
  if (parent.type === 'GROUP') return absOrigin(parent.parent)
  if (parent.type === 'FRAME') { const o = absOrigin(parent.parent); return { x: o.x + parent.x, y: o.y + parent.y } }
  return { x: 0, y: 0 }
}
export function absBounds(n) {
  const o = absOrigin(n.parent)
  return { x: n.x + o.x, y: n.y + o.y, width: n.width, height: n.height }
}

/** Runs the plugin on an SVG string. */
export async function runSvg(svg, theme) {
  const r = await runPlugin(CODE, svg, (env, s) => importSvg(env, s), { theme, themeVariables: THEMES[theme] })
  return { svg, ...r }
}

// Phase 8.5 survey payloads (one per remaining Mermaid diagram type, gzipped to keep the repo small).
export const SURVEY_DIR = path.join(FIXTURE_DIR, 'survey')
export const SURVEY_TYPES = fs
  .readdirSync(SURVEY_DIR)
  .filter((f) => f.endsWith('.svg.gz') && !f.endsWith('-light.svg.gz'))
  .map((f) => f.replace(/\.svg\.gz$/, ''))
  .sort()
export const readSurveySvg = (type, theme) =>
  zlib.gunzipSync(fs.readFileSync(path.join(SURVEY_DIR, `${type}${theme === 'light' ? '-light' : ''}.svg.gz`))).toString('utf8')
export const runSurvey = (type, theme) => runSvg(readSurveySvg(type, theme), theme)
