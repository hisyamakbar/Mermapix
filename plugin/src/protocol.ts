// Messages between the plugin UI (src/plugin/AppPlugin.tsx -> ui.html) and the Figma sandbox
// (plugin/src/main.ts -> code.js). Types only: importing this file adds nothing to either bundle.

export type DiagramTheme = 'light' | 'dark'

/** A diagram on the canvas that still carries its Mermaid source (Phase 11, source-linked diagrams). */
export interface LinkedDiagram {
  /** Node id of the diagram root (the node that holds the plugin data). */
  id: string
  /** Current layer name of the root. */
  name: string
  /** Mermaid source exactly as it was in the editor when the diagram was inserted or last updated. */
  source: string
  theme: DiagramTheme
  /** False when the root cannot be regenerated in place; the source can still be loaded. */
  editable: boolean
  /** Why `editable` is false. `instance`: the root sits inside a component instance. */
  reason?: 'instance'
}

/**
 * Where a text layer came from in the Mermaid source (Phase 12). Recorded when the diagram is built, so a
 * text edited in Figma can be written back to the right place even when the same words occur several times.
 * Absent when the converter knows nothing more than the text itself.
 */
export type TextContext =
  /** Title of an ERD table. `entity` is the title as rendered (the alias when the source has one). */
  | { kind: 'erd-entity'; entity: string }
  /**
   * One token of an ERD attribute row. `row` is the 0-based index among the entity's attribute rows in
   * source order. `part` is the 0-based index inside a multi-key cell (`PK, FK`).
   */
  | { kind: 'erd-attr'; entity: string; row: number; col: 'type' | 'name' | 'key' | 'comment'; part?: number }
  /** Label of a node that has a Mermaid id (flowchart, class, state, ...). */
  | { kind: 'node'; id: string }
  /** Title of a subgraph / namespace / composite state that has a Mermaid id. */
  | { kind: 'cluster'; id: string }

/** One text layer whose characters differ from what the plugin generated. */
export interface TextChange {
  /** The text as generated from the source. */
  from: string
  /** The text now on the canvas. */
  to: string
  context?: TextContext
}

/**
 * What was changed in Figma since the plugin last wrote the diagram (Phase 12). Counts are approximate
 * by design: they explain a warning, they are not an exact diff.
 */
export interface DiagramChanges {
  /** Edited text layers. Deleted text layers count as `removed`, not here. */
  texts: TextChange[]
  /**
   * Layers moved or resized by hand. Geometry that only follows a text edit (the text layer itself, the
   * size of its Auto Layout ancestors, its siblings inside an Auto Layout parent) is not counted.
   */
  moved: number
  /** Layers whose solid fill or stroke colors changed. */
  restyled: number
  /** Layers that the plugin did not create (pasted or duplicated into the diagram). */
  added: number
  /** Generated layers that are gone. */
  removed: number
  /**
   * True when the diagram differs from what was generated but none of the fields above explains it
   * (renamed layers, effects, ...), or when the diagram predates per-layer tracking.
   */
  other: boolean
}

export type UiToSandbox =
  | {
      type: 'create-svg'
      svg: string
      name?: string
      theme?: DiagramTheme
      themeVariables?: Record<string, any>
      /** Mermaid source to store on the new diagram. Without it the diagram is not re-editable. */
      source?: string
    }
  | {
      type: 'update-svg'
      /** `LinkedDiagram.id` of the diagram to regenerate in place. */
      targetId: string
      svg: string
      source: string
      theme: DiagramTheme
      themeVariables?: Record<string, any>
      /** Set after the user confirmed replacing manual edits (answer to `update-needs-confirm`). */
      force?: boolean
      /**
       * A live update, sent by the UI while the user types (Phase 13): no toast and the Figma selection is
       * left alone. Everything else is the same, including `update-needs-confirm` for a diagram edited in Figma.
       */
      quiet?: boolean
    }
  /** Ask for the current selection state; the sandbox answers with `selection`. Sent once on UI start. */
  | { type: 'request-selection' }
  /**
   * Ask what was changed in Figma on one linked diagram; the sandbox answers with `diagram-changes`.
   * One answer per request (walking a whole diagram on every selection change would be too slow).
   */
  | { type: 'inspect-diagram'; id: string }
  /**
   * Keep reporting one diagram while it is being edited: the sandbox answers with `diagram-changes` at
   * once and again (debounced) after every change on the canvas that touches the diagram, until another
   * `watch-diagram` arrives. `id: null` stops watching. One diagram is watched at a time.
   */
  | { type: 'watch-diagram'; id: string | null }
  | { type: 'resize'; width: number; height: number }
  | { type: 'close' }

export type SandboxToUi =
  /**
   * Sent in answer to `request-selection` and on every selection change. `diagram` is the linked
   * diagram that contains the first selected layer, or null. `autoEdit` is true only in the answer
   * to the first `request-selection` when the plugin was started from the "Edit diagram" relaunch
   * button: the UI then enters edit mode without waiting for a click.
   */
  | { type: 'selection'; diagram: LinkedDiagram | null; autoEdit?: boolean }
  /** `linked` is false when the source was not stored (missing or too large for plugin data). */
  | { type: 'inserted'; linked: boolean }
  | { type: 'insert-failed'; message: string }
  /** `ms`: how long the update took in the sandbox; the UI turns live update off for diagrams that are slow to regenerate. */
  | { type: 'updated'; id: string; ms: number }
  /**
   * Answer to `inspect-diagram`, and sent again for a watched diagram (`watch-diagram`) whenever it
   * changes on the canvas. Always the full state compared with what was generated, never a delta.
   * `changes` is null when the diagram is gone or carries no source.
   * An untouched diagram answers with empty `texts`, zero counts and `other: false`.
   */
  | { type: 'diagram-changes'; id: string; changes: DiagramChanges | null }
  /**
   * The diagram was changed in Figma after the plugin last wrote it. `changes` says how, so the UI can
   * name what an update would replace, or skip the question when every change is already in the new
   * source (text edits it applied to the code). Resend `update-svg` with `force` to go ahead.
   */
  | { type: 'update-needs-confirm'; id: string; changes: DiagramChanges }
  /**
   * `missing`: the target no longer exists or lost its source (the UI leaves edit mode).
   * `instance`: the target is inside a component instance. `error`: conversion threw; the target is untouched.
   */
  | { type: 'update-failed'; id: string; reason: 'missing' | 'instance' | 'error'; message: string }
