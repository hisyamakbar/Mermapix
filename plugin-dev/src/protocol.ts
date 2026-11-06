// Messages between the test runner UI (ui.html) and its Figma sandbox (code.js).

export type RunTheme = 'light' | 'dark'

/** Compact per-diagram result the sandbox reports back (full audit lives in shared plugin data). */
export interface DiagramReport {
  key: string
  fixture: string
  theme: RunTheme
  ok: boolean
  /** Hard failure (render or insert threw); the run continues. */
  error?: string
  issues: string[]
  nodeId?: string
  sectionId?: string
  size?: string
  metrics?: {
    duplicateStacks: number
    looseShapes: number
    unconvertedTables: number
    overflowingText: number
    unnamedLayers: number
    contentOverflow: number
    textsExpected: number | null
    textsFound: number
    textsLost: number | null
    blackBoxes: number | null
  }
}

export type UiToSandbox =
  | { type: 'run-begin'; total: number }
  | {
      type: 'insert'
      key: string
      fixture: string
      theme: RunTheme
      row: number
      col: number
      /** Payload SVG exactly as the production plugin UI posts it; absent when rendering failed. */
      svg?: string
      themeVariables?: Record<string, any>
      renderError?: string
    }
  | { type: 'run-end' }
  | { type: 'focus'; key: string }
  | { type: 'close' }

export type SandboxToUi =
  | { type: 'run-ready'; pageName: string; pageId: string }
  | { type: 'run-error'; error: string }
  | { type: 'inserted'; report: DiagramReport }
  | {
      type: 'run-done'
      pageName: string
      pageId: string
      fileKey?: string
      totals: { diagrams: number; failed: number; withIssues: number }
    }
