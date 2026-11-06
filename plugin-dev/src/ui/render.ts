// Renders one Mermaid source to the exact payload SVG the production plugin UI posts to its sandbox.
// Mirrors src/plugin/AppPlugin.tsx: sanitize -> initMermaid(theme) -> mermaid.parse -> mermaid.render ->
// put the SVG into a `.diagram-stage` inside `.mpx-app[data-theme]` -> buildExportSvg(stage) with
// THEME_PRESETS[theme] as themeVariables. Keep this in sync with AppPlugin.tsx.

import mermaid from 'mermaid'
import { initMermaid, THEME_PRESETS } from '../../../src/themes/presets.ts'
import { buildExportSvg } from '../../../src/export/svg.ts'
import { sanitizeMermaidCode } from '../../../src/utils/sanitize.ts'
import type { Theme } from '../../../src/types/index.ts'

let renderId = 0

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

export interface RenderedPayload {
  svg: string
  width: number
  height: number
  themeVariables: Record<string, any>
}

export async function renderPayload(code: string, theme: Theme): Promise<RenderedPayload> {
  const trimmed = code.trim()
  if (!trimmed) throw new Error('Empty diagram source')
  const source = /```/i.test(trimmed) ? sanitizeMermaidCode(trimmed) : trimmed

  initMermaid(theme)
  await mermaid.parse(source)
  const { svg: rendered } = await mermaid.render(`mermaid-plugin-svg-${renderId++}`, source)

  // Same DOM ancestry as the plugin canvas (themed `.mpx-app` > `.diagram-stage`), parked off-screen but laid out
  // so getComputedStyle / glyph measurements work exactly like in the visible plugin.
  const app = document.createElement('div')
  app.className = 'mpx-app mpx-plugin-app'
  app.setAttribute('data-theme', theme)
  app.setAttribute('aria-hidden', 'true')
  app.style.cssText = 'position:fixed;left:-200000px;top:0;width:auto;height:auto;overflow:visible;pointer-events:none'
  const stage = document.createElement('div')
  stage.className = 'diagram-stage'
  stage.style.cssText = 'position:absolute;left:0;top:0;transform:none'
  stage.innerHTML = rendered
  app.appendChild(stage)
  document.body.appendChild(app)
  try {
    try {
      await document.fonts.ready
    } catch {}
    await sleep(30)
    const built = buildExportSvg(stage)
    if (!built) throw new Error('buildExportSvg returned null (no <svg> rendered)')
    return {
      svg: built.serialized,
      width: built.width,
      height: built.height,
      themeVariables: THEME_PRESETS[theme] as Record<string, any>,
    }
  } finally {
    app.remove()
  }
}

/** All `tests/figma-fixtures/*.mmd`, bundled at build time. Sorted by file name. */
export function loadFixtures(): { name: string; code: string }[] {
  const files = import.meta.glob('../../../tests/figma-fixtures/*.mmd', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  return Object.entries(files)
    .map(([file, code]) => ({ name: file.split('/').pop()!.replace(/\.mmd$/, ''), code }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
