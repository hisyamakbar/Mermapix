import { useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import {
  Code2,
  Network,
  Sparkles,
  ChevronDown,
  Wand2,
  FolderInput,
  PlusCircle,
  RefreshCw,
  Check,
} from 'lucide-react'
import { DEFAULT_EXAMPLE, EXAMPLES } from '../examples/index.ts'
import { initMermaid, THEME_PRESETS } from '../themes/presets.ts'
import { buildExportSvg, copyToFigma } from '../export/svg.ts'
import { useCanvasZoom } from '../hooks/useCanvasZoom.ts'
import { sanitizeMermaidCode } from '../utils/sanitize.ts'
import Toolbar from '../components/Toolbar.tsx'
import EditorPanel from '../components/EditorPanel.tsx'
import Canvas from '../components/Canvas.tsx'
import ImportModal from '../components/ImportModal.tsx'
import AboutModal from '../components/AboutModal.tsx'
import SourceLinkStrip, { type FollowUp, type StripState } from './SourceLinkStrip.tsx'
import { applyTextChanges } from './sourcePatch.ts'
import { diagramName } from './diagramName.ts'
import { describeConfirm, isNothingLeft, pendingEdits, remainingChanges, settleHandled, type ApplyOutcome } from './changeSummary.ts'
import {
  LIVE_STORAGE_KEY,
  liveDelay,
  editorHint,
  isSlowStreak,
  liveNote,
  liveState,
  nextSlowStreak,
  readLivePreference,
  sameSnapshot,
  saveStep,
  updateButtonState,
  wantsLiveUpdate,
  type LiveState,
  type Snapshot,
} from './liveSync.ts'
import type { Theme } from '../types/index.ts'
import {
  figmaThemeFromClassList,
  initialTheme,
  themeAfterEdit,
  themeOnFigmaChange,
} from './figmaTheme.ts'
import type {
  DiagramChanges,
  LinkedDiagram,
  SandboxToUi,
  TextChange,
  UiToSandbox,
} from '../../plugin/src/protocol.ts'

const DEFAULT_DIAGRAM = DEFAULT_EXAMPLE.code
const STORAGE_KEY = 'mermapix:code'
const LEGACY_STORAGE_KEY = 'mermaid-code'

initMermaid('dark')

/** Edit mode: bound to one diagram by id (not to the live selection), remembers the draft to restore. */
interface EditSession {
  id: string
  name: string
  /** False when the diagram cannot be regenerated in place (inside a component instance). */
  editable: boolean
  draftCode: string
  draftTheme: Theme
  /** Figma's theme when the session started: a different one at the end means Figma was switched meanwhile. */
  figmaAtStart: Theme | null
  /** Last `update-failed` message that keeps the session open. */
  error?: string
  /**
   * The sandbox's latest report on this diagram: the canvas compared with what was generated. It is
   * sent when the session starts and again after every change on the canvas (`watch-diagram`).
   */
  canvas: DiagramChanges | null
  /** What the last automatic apply of canvas text edits did, until it is dismissed. */
  result: ApplyOutcome | null
  /** Takes back the last automatic apply, until the user types or the diagram is regenerated. */
  undo: ApplyUndo | null
  /** Text edits that are in the code now (applied, or equal to the code once whitespace is normalized). */
  handled: TextChange[]
  /** Text edits not to apply again: undone by the user, or they could not be placed in the code. */
  ignored: TextChange[]
  /** Source and theme when the session started: what "Revert" puts back. */
  start: Snapshot
  /** What the diagram in Figma was last generated from by this session (`start`, then every update). */
  synced: Snapshot
  /**
   * What is accounted for: `synced`, moved forward by text edits that came from the canvas. A live
   * update is due when the editor differs from it (see liveSync.ts, wantsLiveUpdate).
   */
  base: Snapshot
  /** Live update paused: an update would replace changes made in Figma, so only the user may send it. */
  hold: boolean
  /** Slow live updates in a row; `slowMs` is the last slow duration (for the note). */
  slowStreak: number
  slowMs?: number
  /** How long the last update took in the sandbox: sets the pause before the next live update. */
  lastMs?: number
}

/** State before an automatic apply, and the layers it applied (ignored after an undo). */
interface ApplyUndo {
  code: string
  handled: TextChange[]
  ignored: TextChange[]
  base: Snapshot
  applied: TextChange[]
}

/**
 * The confirm step in the strip: an update (`update`, or `save` when it is the last step of Save) would
 * replace changes made in Figma, or Save met code that cannot be rendered (`leave`).
 */
type Confirm = { action: 'update' | 'save'; changes: DiagramChanges } | { action: 'leave' }

const LEAVE_TEXT =
  'The code has an error, so the diagram in Figma cannot be updated. Leave anyway? The diagram keeps its last update.'
const LEAVE_EMPTY_TEXT =
  'The code is empty, so the diagram in Figma cannot be updated. Leave anyway? The diagram keeps its last update.'

/** An update waiting to be sent: by the user (`quiet: false`) or by live update. */
interface UpdateRequest {
  force: boolean
  quiet: boolean
}

const DONE_FEEDBACK_MS = 2000
const MISSING_NOTICE =
  'That diagram no longer exists. Your text is kept as the current draft.'

function readFigmaTheme(): Theme | null {
  return figmaThemeFromClassList(document.documentElement.classList)
}

function postToSandbox(message: UiToSandbox) {
  parent.postMessage({ pluginMessage: message }, '*')
}

export default function AppPlugin() {
  const [svg, setSvg] = useState('')
  const [code, setCode] = useState<string>(() => {
    try {
      return (
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY) ??
        DEFAULT_DIAGRAM
      )
    } catch {
      return DEFAULT_DIAGRAM
    }
  })
  const [error, setError] = useState<string | null>(null)
  // The code and theme `error` belongs to: an error of the previous code says nothing about the current one.
  const [errorFor, setErrorFor] = useState<Snapshot | null>(null)
  const [activeTab, setActiveTab] = useState<'code' | 'diagram'>('code')
  // Success feedback on the primary button; shared by insert and update.
  const [done, setDone] = useState<'inserted' | 'updated' | null>(null)
  const doneTimer = useRef<number | undefined>(undefined)
  // Source-linked diagrams: the diagram under the Figma selection, the edit session, and the
  // two messages that can interrupt it.
  const [linked, setLinked] = useState<LinkedDiagram | null>(null)
  const [edit, setEdit] = useState<EditSession | null>(null)
  // Set while the confirm step is open: what an update would still replace, or leaving with broken code.
  const [confirming, setConfirming] = useState<Confirm | null>(null)
  // "Save" in progress: updating the diagram before edit mode ends (see the effect after `pump`).
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // True from a programmatic code/theme swap until the preview has caught up with it.
  const [awaitingRender, setAwaitingRender] = useState(false)
  // The code and theme the current preview was rendered from. An update is only built from a preview
  // that belongs to the editor's code (no stale payload inside the render debounce).
  const [rendered, setRendered] = useState<Snapshot | null>(null)
  // Phase 13 "Live" switch: the diagram in Figma follows the editor while it is being edited.
  const [live, setLive] = useState<boolean>(() => {
    try {
      return readLivePreference(localStorage.getItem(LIVE_STORAGE_KEY))
    } catch {
      return true
    }
  })
  // The update the sandbox is working on (one at a time), and the newest one waiting behind it.
  const inFlight = useRef<(Snapshot & { quiet: boolean }) | null>(null)
  const want = useRef<UpdateRequest | null>(null)
  // `inFlight` as state, for what the UI shows (Update button, Save).
  const [updating, setUpdating] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  // The theme follows Figma's (class on <html>, see figmaTheme.ts) each time the plugin opens and when Figma
  // switches (not while a diagram is being edited). The toggle changes it for this session only; it is not stored.
  const [initialFigma] = useState<Theme | null>(readFigmaTheme)
  const figmaTheme = useRef<Theme | null>(initialFigma)
  const [theme, setTheme] = useState<Theme>(() => initialTheme(initialFigma))
  const [examplesOpen, setExamplesOpen] = useState(false)
  const examplesRef = useRef<HTMLDivElement>(null)

  const renderId = useRef(0)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const focusEditorNext = useRef(false)

  useEffect(() => {
    if (!examplesOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (examplesRef.current && !examplesRef.current.contains(e.target as Node)) {
        setExamplesOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExamplesOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [examplesOpen])

  // Canvas pan & zoom math
  const {
    zoom,
    zoomText,
    setZoomText,
    dragging,
    interacting,
    canvasRef,
    diagramRef,
    zoomFieldRef,
    zoomIn,
    zoomOut,
    resetZoom,
    commitZoomText,
    handleZoomKey,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useCanvasZoom(svg)

  // Live render Mermaid whenever code or theme changes
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      const trimmed = code.trim()
      if (!trimmed) {
        setSvg('')
        setError(null)
        setRendered(null)
        setAwaitingRender(false)
        return
      }
      const source = /```/i.test(trimmed) ? sanitizeMermaidCode(trimmed) : trimmed
      try {
        initMermaid(theme)
        await mermaid.parse(source)
        const id = `mermaid-plugin-svg-${renderId.current++}`
        const { svg: rendered } = await mermaid.render(id, source)
        if (!active) return
        setSvg(rendered)
        setRendered({ code, theme })
        setError(null)
        setAwaitingRender(false)
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
        setErrorFor({ code, theme })
        setAwaitingRender(false)
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [code, theme])

  // Persist code across plugin sessions. Not while editing a linked diagram: its source lives in
  // the Figma file, and the stored draft must survive closing the plugin mid-edit.
  const editing = edit !== null
  useEffect(() => {
    if (editing) return
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // Storage unavailable
    }
  }, [code, editing])

  // Follow Figma's theme. The class may be there before this script runs or be added a moment later; both
  // are covered (initial read above, observer here). Only a real change of Figma's theme counts.
  useEffect(() => {
    const check = () => {
      const next = readFigmaTheme()
      if (next === null || next === figmaTheme.current) return
      figmaTheme.current = next
      const editingNow = latest.current.edit !== null
      setTheme((cur) => themeOnFigmaChange({ current: cur, figma: next, editing: editingNow }))
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // A syntax error leaves the last good preview in place; never insert or update from it.
  // `awaitingRender` covers the moment right after the editor text was swapped programmatically.
  const canSubmit = Boolean(svg) && !error && !awaitingRender
  // The preview belongs to exactly what the editor holds: the only state an update is built from.
  const fresh =
    Boolean(svg) && !error && rendered !== null && rendered.code === code && rendered.theme === theme

  // The editor's own code cannot become a diagram: it is empty, or its render failed. Not while a render of
  // newer code is still pending (then it waits for that render instead).
  const unrenderable =
    !code.trim() || (error !== null && errorFor !== null && sameSnapshot(errorFor, { code, theme }))

  const liveNow: LiveState | null = edit
    ? liveState({ editable: edit.editable, live, hold: edit.hold, slow: isSlowStreak(edit.slowStreak) })
    : null

  // Latest values for the message listener (registered once) and for `pump`, which runs from timers.
  const latest = useRef({ code, theme, edit, fresh, liveNow, saving })
  latest.current = { code, theme, edit, fresh, liveNow, saving }

  const showDone = (kind: 'inserted' | 'updated') => {
    setDone(kind)
    window.clearTimeout(doneTimer.current)
    doneTimer.current = window.setTimeout(() => setDone(null), DONE_FEEDBACK_MS)
  }
  const clearDone = () => {
    window.clearTimeout(doneTimer.current)
    setDone(null)
  }

  // Sends the waiting update when nothing is in flight and the preview has caught up with the editor;
  // otherwise it stays waiting and is sent from the effect below or when the sandbox answers. Always
  // built from the current editor state, never from the state at the time it was requested.
  const pump = () => {
    const w = want.current
    if (!w || inFlight.current) return
    const { edit: e, code: c, theme: t, fresh: ready, liveNow: state } = latest.current
    if (!e || !e.editable) {
      want.current = null
      return
    }
    const editor = { code: c, theme: t }
    // A live update that is no longer due (switched off, paused, or the editor is back in sync).
    if (w.quiet && !w.force && (state !== 'on' || sameSnapshot(editor, e.base))) {
      want.current = null
      return
    }
    if (!ready) return
    const built = buildExportSvg(diagramRef.current)
    if (!built) {
      want.current = null
      return
    }
    want.current = null
    inFlight.current = { ...editor, quiet: w.quiet }
    setUpdating(true)
    postToSandbox({
      type: 'update-svg',
      targetId: e.id,
      svg: built.serialized,
      source: c,
      theme: t,
      themeVariables: THEME_PRESETS[t],
      ...(w.force ? { force: true } : {}),
      ...(w.quiet ? { quiet: true } : {}),
    })
  }

  useEffect(() => {
    pump()
    // `pump` reads everything through `latest`; it runs whenever the session or the preview moves on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, fresh])

  // "Save": the diagram in Figma is brought up to date with the code before edit mode ends. Asked again
  // after every answer from the sandbox and every change of the editor, until the diagram shows the code
  // (saveStep in liveSync.ts). An update that would replace changes made in Figma asks first (`save`
  // confirm), a failure stops here with the error shown, code that cannot be rendered asks before leaving.
  useEffect(() => {
    if (!saving) return
    if (!edit) {
      setSaving(false)
      return
    }
    if (confirming) {
      // The code was fixed while "Leave anyway" was asked: that question is gone; Save starts over on a click.
      if (confirming.action === 'leave' && !unrenderable) {
        setConfirming(null)
        setSaving(false)
      }
      return
    }
    const step = saveStep({
      editable: edit.editable,
      // The ref, not only the state: an update sent by `pump` earlier in this same commit is in flight too.
      updating: updating || inFlight.current !== null,
      inSync: sameSnapshot({ code, theme }, edit.base),
      renderError: unrenderable,
    })
    if (step === 'wait') return
    if (step === 'exit' || step === 'close') {
      exitEdit(false)
      return
    }
    if (step === 'leave-confirm') {
      // Nothing may go out behind the question (a fix typed later would otherwise be sent and exit).
      if (want.current && !want.current.quiet) want.current = null
      setConfirming({ action: 'leave' })
      return
    }
    if (edit.error) {
      setSaving(false)
      return
    }
    if (!want.current || want.current.quiet) want.current = { force: false, quiet: false }
    pump()
    // Nothing went out and nothing waits for the preview: the diagram could not be prepared for Figma.
    if (!inFlight.current && !want.current) {
      setSaving(false)
      setEdit((cur) => cur && { ...cur, error: 'The diagram could not be prepared for Figma. Try Save again.' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, edit, code, theme, unrenderable, updating, confirming, fresh])

  // Live update: a pause in typing sends the editor to the diagram in Figma (see liveSync.ts). The pause
  // grows with how long the last update took, so a slow diagram updates less often instead of not at all.
  const liveBase = edit?.base
  const lastMs = edit?.lastMs
  useEffect(() => {
    if (!liveNow || !liveBase || !wantsLiveUpdate(liveNow, { code, theme }, liveBase)) return
    const timer = window.setTimeout(() => {
      // While saving, Save sends the update itself (one the user asked for).
      if (latest.current.saving) return
      if (!want.current) want.current = { force: false, quiet: true }
      pump()
    }, liveDelay(lastMs))
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveNow, liveBase, code, theme, lastMs])

  const toggleLive = () => {
    setLive((on) => {
      try {
        localStorage.setItem(LIVE_STORAGE_KEY, on ? 'off' : 'on')
      } catch {
        // Storage unavailable
      }
      return !on
    })
  }

  // Code typed or chosen by the user (editor, examples, import, format). An automatic apply can no
  // longer be undone once the user has written over it.
  const typeCode = (value: string) => {
    setCode(value)
    setEdit((cur) => (cur && cur.undo ? { ...cur, undo: null } : cur))
  }

  // Edit mode: load the diagram's source and theme, remember the draft to restore on exit.
  const enterEdit = (diagram: LinkedDiagram, moveFocus: boolean) => {
    const cur = latest.current
    if (cur.edit) return
    const source: Snapshot = { code: diagram.source, theme: diagram.theme }
    want.current = null
    setEdit({
      id: diagram.id,
      name: diagram.name,
      editable: diagram.editable,
      draftCode: cur.code,
      draftTheme: cur.theme,
      figmaAtStart: figmaTheme.current,
      canvas: null,
      result: null,
      undo: null,
      handled: [],
      ignored: [],
      start: source,
      synced: source,
      base: source,
      hold: false,
      slowStreak: 0,
    })
    if (diagram.source !== cur.code || diagram.theme !== cur.theme) setAwaitingRender(true)
    setCode(diagram.source)
    setTheme(diagram.theme)
    setConfirming(null)
    setNotice(null)
    clearDone()
    setActiveTab('code')
    focusEditorNext.current = moveFocus
    // Ask what was changed on the canvas, now and after every later change, for as long as this diagram
    // is being edited. Nothing is shown until an answer says there is something.
    postToSandbox({ type: 'watch-diagram', id: diagram.id })
  }

  // Leave edit mode and put the remembered draft back (unless `keepEditor`: the target is gone).
  const exitEdit = (keepEditor: boolean) => {
    const cur = latest.current.edit
    if (!cur) return
    // Typed code is never dropped here: "Save" updates the diagram before it calls this (see saveStep).
    want.current = null
    setSaving(false)
    // Effects later in the same commit (the automatic apply) see that the session is over.
    latest.current = { ...latest.current, edit: null }
    // Figma's theme if it was switched during the edit, else the theme from before it.
    const nextTheme = themeAfterEdit({
      draftTheme: cur.draftTheme,
      figmaAtStart: cur.figmaAtStart,
      figmaNow: figmaTheme.current,
    })
    if (!keepEditor) {
      if (cur.draftCode !== latest.current.code || nextTheme !== latest.current.theme) {
        setAwaitingRender(true)
      }
      setCode(cur.draftCode)
      setTheme(nextTheme)
    } else if (nextTheme !== latest.current.theme) {
      // The diagram is gone: the typed code stays, only the theme goes back.
      setAwaitingRender(true)
      setTheme(nextTheme)
    }
    setEdit(null)
    postToSandbox({ type: 'watch-diagram', id: null })
    setConfirming(null)
    clearDone()
    focusEditorNext.current = !keepEditor
  }

  useEffect(() => {
    if (!focusEditorNext.current) return
    focusEditorNext.current = false
    editorHostRef.current?.querySelector('textarea')?.focus()
  }, [edit])

  // The sandbox (plugin/src/main.ts) confirms each insert and update, so the button never claims
  // success for one that failed on the canvas side.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage as SandboxToUi | undefined
      if (!msg) return
      const target = latest.current.edit
      switch (msg.type) {
        case 'selection':
          setLinked(msg.diagram)
          if (msg.diagram) {
            if (msg.autoEdit) enterEdit(msg.diagram, false)
            // Keep the layer name current if it was renamed in Figma while editing.
            else if (target && target.id === msg.diagram.id && target.name !== msg.diagram.name) {
              const { id, name } = msg.diagram
              setEdit((cur) => (cur && cur.id === id ? { ...cur, name } : cur))
            }
          }
          break
        case 'inserted':
          showDone('inserted')
          break
        case 'insert-failed':
          clearDone()
          break
        case 'updated': {
          const sent = inFlight.current
          inFlight.current = null
          setUpdating(false)
          if (target && target.id === msg.id) {
            setConfirming(null)
            const quiet = sent?.quiet === true
            const ms = typeof msg.ms === 'number' ? msg.ms : 0
            // The canvas now matches what was sent: that is the new baseline, nothing is pending any more.
            setEdit((cur) => {
              if (!cur || cur.id !== msg.id) return cur
              const snap = sent ? { code: sent.code, theme: sent.theme } : cur.synced
              const slowStreak = nextSlowStreak(cur.slowStreak, ms, quiet)
              return {
                ...cur,
                error: undefined,
                canvas: null,
                result: null,
                undo: null,
                handled: [],
                ignored: [],
                synced: snap,
                base: snap,
                hold: false,
                slowStreak,
                slowMs: isSlowStreak(slowStreak) ? ms : cur.slowMs,
                lastMs: ms > 0 ? ms : cur.lastMs,
              }
            })
            if (!quiet) showDone('updated')
          }
          // A request that waited behind this one goes out from the effect once the session state settles.
          break
        }
        case 'diagram-changes':
          // Arrives when the session starts and again whenever the diagram changes on the canvas: the
          // newest report replaces the previous one. `null` (the diagram is gone or carries no source)
          // and an answer for another diagram are ignored.
          if (!msg.changes) break
          {
            const { id, changes } = msg
            setEdit((cur) => (cur && cur.id === id ? { ...cur, canvas: changes } : cur))
          }
          break
        case 'update-needs-confirm': {
          const sent = inFlight.current
          inFlight.current = null
          setUpdating(false)
          if (target && target.id === msg.id) {
            clearDone()
            // Text edits already in the code are reproduced by the update: not a loss.
            const left = remainingChanges(msg.changes, target.handled)
            if (isNothingLeft(left)) {
              // Forced, but a request the user queued behind it stays the user's (not quiet).
              const quiet = sent?.quiet === true && (!want.current || want.current.quiet)
              want.current = { force: true, quiet }
              pump()
            } else {
              setConfirming({ action: latest.current.saving ? 'save' : 'update', changes: left })
              // Live update stops here, after a live update or one the user asked for: only the user may
              // replace changes made in Figma.
              if (want.current?.quiet) want.current = null
              setEdit((cur) => (cur && cur.id === msg.id ? { ...cur, hold: true } : cur))
            }
          }
          break
        }
        case 'update-failed': {
          inFlight.current = null
          setUpdating(false)
          if (!target || target.id !== msg.id) break
          clearDone()
          setConfirming(null)
          // Save stops here: the session stays open with the error (or ends below, the diagram is gone).
          setSaving(false)
          if (msg.reason === 'missing') {
            // The user's text is worth more than the old draft: it becomes the draft.
            exitEdit(true)
            setNotice(MISSING_NOTICE)
          } else if (msg.reason === 'instance') {
            setEdit((cur) => (cur && cur.id === target.id ? { ...cur, editable: false, error: undefined } : cur))
          } else {
            // Shown until the next update succeeds. A live update is retried only once the code changes.
            const message = msg.message || 'The diagram could not be updated.'
            setEdit((cur) => (cur && cur.id === target.id ? { ...cur, error: message } : cur))
          }
          break
        }
      }
    }
    // Coming back to the plugin window asks once more: the report stays current even where the canvas
    // watch does not fire.
    const onFocus = () => {
      const cur = latest.current.edit
      if (cur) postToSandbox({ type: 'inspect-diagram', id: cur.id })
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('focus', onFocus)
    postToSandbox({ type: 'request-selection' })
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('focus', onFocus)
      window.clearTimeout(doneTimer.current)
    }
    // Registered once: reads current state through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Insert editable layers into Figma Canvas, named from the code (title, else the diagram type)
  const handleInsertIntoCanvas = () => {
    if (!canSubmit) return
    const built = buildExportSvg(diagramRef.current)
    if (!built) return

    try {
      // Post message to Figma Plugin Sandbox (code.js)
      postToSandbox({
        type: 'create-svg',
        svg: built.serialized,
        name: diagramName(code),
        theme,
        themeVariables: THEME_PRESETS[theme],
        source: code,
      })
      // "Added!" is shown when the sandbox replies with `inserted` (see the effect above).
    } catch {
      // Fallback: Copy to clipboard if postMessage unavailable
      copyToFigma(diagramRef.current)
    }
  }

  // Regenerate the edited diagram in place, asked by the user. `force` answers `update-needs-confirm`.
  // Queued behind an update in flight and sent once the preview matches the editor.
  const handleUpdateDiagram = (force = false): boolean => {
    if (!canSubmit || !edit || !edit.editable) return false
    setNotice(null)
    setConfirming(null)
    setEdit((cur) => (cur ? { ...cur, error: undefined } : cur))
    clearDone()
    want.current = { force, quiet: false }
    pump()
    return true
  }

  // Back to the source the session started with, in the editor and (by one update) in Figma. Canvas text
  // edits are not re-applied to the reverted code: the update asks before replacing them.
  const handleRevert = () => {
    if (!edit || !edit.editable) return
    const reportedTexts = edit.canvas?.texts ?? []
    setNotice(null)
    setConfirming(null)
    clearDone()
    setEdit((cur) =>
      cur && { ...cur, error: undefined, result: null, undo: null, handled: [], ignored: reportedTexts },
    )
    want.current = { force: false, quiet: false }
    if (!sameSnapshot({ code, theme }, edit.start)) {
      setAwaitingRender(true)
      setCode(edit.start.code)
      setTheme(edit.start.theme)
      // Sent by the effect once the preview of the reverted code is rendered.
    } else {
      pump()
    }
  }

  // Text edits made in Figma that the code does not have yet. Derived from the latest report, so an
  // edit made on the canvas while the plugin is open is picked up as well.
  const pending = useMemo(
    () => (edit?.canvas ? pendingEdits(edit.canvas, edit.handled, edit.ignored) : []),
    [edit?.canvas, edit?.handled, edit?.ignored],
  )

  // Phase 13: canvas text edits are written into the code as they arrive, only where their place is
  // certain (sourcePatch.ts); the rest is listed as "Could not match". "Undo" takes the apply back.
  // The code moves forward together with `base`: those edits are on the canvas already, so they never
  // trigger a live update (that would replace the text layer the person in Figma is typing in).
  useEffect(() => {
    if (!edit || !latest.current.edit || pending.length === 0) return
    const patched = applyTextChanges(code, pending.map((p) => p.patch))
    const unresolved = new Set(patched.unresolved)
    const placed = pending.filter((p) => !unresolved.has(p.patch))
    const failed = pending.filter((p) => unresolved.has(p.patch))
    const changed = patched.source !== code
    if (changed) {
      setAwaitingRender(true)
      setCode(patched.source)
    }
    const total = patched.applied.length + patched.unresolved.length
    const before = code
    setEdit((cur) => {
      if (!cur) return cur
      const inSync = cur.base.code === before
      return {
        ...cur,
        result: total > 0 ? { total, unresolved: patched.unresolved } : cur.result,
        undo: changed
          ? { code: before, handled: cur.handled, ignored: cur.ignored, base: cur.base, applied: placed.map((p) => p.layer) }
          : cur.undo,
        handled: settleHandled(cur.handled, placed.map((p) => p.layer)),
        // Listed once as "Could not match"; not tried again on every later change of the canvas.
        ignored: [...cur.ignored, ...failed.map((p) => p.layer)],
        base: changed && inSync ? { ...cur.base, code: patched.source } : cur.base,
      }
    })
    // Runs when the report brings something new; `code` and `edit` are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const handleUndoApply = () => {
    const u = edit?.undo
    if (!u) return
    if (u.code !== code) {
      setAwaitingRender(true)
      setCode(u.code)
    }
    setEdit((cur) =>
      cur && {
        ...cur,
        handled: u.handled,
        ignored: [...u.ignored, ...u.applied],
        base: u.base,
        undo: null,
        result: null,
      },
    )
  }

  // Save: update the diagram with the code, then leave edit mode (driven by the effect after `pump`).
  const handleSave = () => {
    const e = latest.current.edit
    if (!e) return
    if (!e.editable) {
      exitEdit(false)
      return
    }
    setNotice(null)
    clearDone()
    // A live update waiting behind one in flight is replaced by Save's own update.
    if (want.current?.quiet) want.current = null
    setEdit((cur) => (cur ? { ...cur, error: undefined } : cur))
    setSaving(true)
  }

  // "Cancel" / "Keep editing": nothing the user asked for goes out any more (live update starts again by itself).
  const handleCancelConfirm = () => {
    setConfirming(null)
    setSaving(false)
    if (want.current && !want.current.quiet) want.current = null
  }

  // "Leave anyway": the code cannot be rendered; the diagram keeps its last update.
  const handleLeave = () => {
    setConfirming(null)
    exitEdit(false)
  }

  const handlePrimaryAction = () => {
    if (edit?.editable) handleUpdateDiagram()
    else handleInsertIntoCanvas()
  }

  const formatCode = () => {
    const cleanSource = sanitizeMermaidCode(code)
    const lines = cleanSource.replace(/\r\n/g, '\n').split('\n')
    const out: string[] = []
    let depth = 0
    let blank = false
    for (const raw of lines) {
      const line = raw.trim()
      if (line === '') {
        if (!blank && out.length) out.push('')
        blank = true
        continue
      }
      blank = false
      if (/^end\b/.test(line)) depth = Math.max(0, depth - 1)
      const header = out.length === 0 && !blank
      out.push(header ? line : '  '.repeat(depth + 1) + line)
      if (/^subgraph\b/.test(line)) depth += 1
    }
    typeCode(out.join('\n').replace(/\n+$/, ''))
  }

  const updatesInPlace = Boolean(edit?.editable)
  // Edits made in Figma that an update would replace: layers moved, restyled, added or removed, and text
  // edits that are not in the code (unmatched or undone).
  const canvasChanged = Boolean(edit?.canvas && !isNothingLeft(remainingChanges(edit.canvas, edit.handled)))
  const updateButton = edit?.editable
    ? updateButtonState({
        updating,
        inSync: sameSnapshot({ code, theme }, edit.base),
        hold: edit.hold,
        canvasChanged,
      })
    : null
  const followUp: FollowUp | null = edit?.result
    ? { kind: 'result', outcome: edit.result, undoable: edit.undo !== null }
    : null
  const canRevert = Boolean(
    edit?.editable &&
      (!sameSnapshot(edit.synced, edit.start) || !sameSnapshot({ code, theme }, edit.start)),
  )
  const stripState: StripState | null = edit && liveNow
    ? confirming
      ? {
          kind: 'confirm',
          name: edit.name,
          action: confirming.action,
          text:
            confirming.action === 'leave'
              ? code.trim()
                ? LEAVE_TEXT
                : LEAVE_EMPTY_TEXT
              : describeConfirm(confirming.changes),
        }
      : {
          kind: 'editing',
          name: edit.name,
          editable: edit.editable,
          error: edit.error,
          live: liveNow,
          liveNote: liveNote(liveNow, edit.slowMs),
          canRevert: canRevert && !saving,
          saving,
        }
    : notice
      ? { kind: 'notice', text: notice }
      : linked
        ? { kind: 'selected' }
        : null

  return (
    <main
      className="mpx-app mpx-plugin-app"
      data-theme={theme}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      <Toolbar
        theme={theme}
        onToggleTheme={() => setTheme((val) => (val === 'light' ? 'dark' : 'light'))}
        hasSvg={canSubmit}
        copied={done !== null}
        onCopyToFigma={handlePrimaryAction}
        showExport={false}
        primaryActionDisabled={updatesInPlace && (updateButton !== 'update' || saving)}
        {...(updateButton === 'updating'
          ? {
              primaryActionLabel: 'Updating\u2026',
              primaryActionShortLabel: 'Updating\u2026',
              primaryActionTooltip: 'The diagram in Figma is being updated',
              primaryActionIcon: <RefreshCw size={15} aria-hidden="true" />,
            }
          : updateButton === 'up-to-date'
          ? {
              primaryActionLabel: 'Up to date',
              primaryActionShortLabel: 'Up to date',
              primaryActionTooltip: 'The diagram in Figma shows this code',
              primaryActionIcon: <Check size={15} aria-hidden="true" />,
            }
          : updatesInPlace
          ? {
              primaryActionLabel: 'Update diagram',
              primaryActionShortLabel: 'Update',
              primaryActionTooltip:
                'Regenerate the diagram you are editing in place, keeping its position and layer name',
              primaryActionIcon: <RefreshCw size={15} aria-hidden="true" />,
            }
          : {
              primaryActionLabel: 'Insert to Canvas',
              primaryActionShortLabel: 'Insert',
              primaryActionTooltip:
                'Insert editable vector shapes & text directly into your Figma canvas',
              primaryActionIcon: <PlusCircle size={15} aria-hidden="true" />,
            })}
        primaryActionCopiedLabel={done === 'updated' ? 'Diagram updated!' : 'Added to Canvas!'}
        primaryActionShortCopiedLabel={done === 'updated' ? 'Updated!' : 'Added!'}
      />

      <div
        className="mpx-body plugin-workspace-body"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Plugin Navigation & Tools Bar */}
        <nav
          className="mobile-workspace-bar plugin-view-bar"
          aria-label="Plugin views"
          style={{ display: 'flex' }}
        >
          <div className="control-group mobile-view-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'code'}
              className={`segmented-btn ${activeTab === 'code' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('code')}
            >
              <Code2 size={14} aria-hidden="true" />
              <span>Code</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'diagram'}
              className={`segmented-btn ${activeTab === 'diagram' ? 'is-active' : ''}`}
              onClick={() => {
                setActiveTab('diagram')
                setTimeout(() => resetZoom(), 50)
              }}
            >
              <Network size={15} aria-hidden="true" />
              <span>Diagram</span>
            </button>
          </div>

          <div className="mobile-code-tools">
            <div className="dropdown-wrapper" ref={examplesRef}>
              <button
                type="button"
                className={`text-button mobile-examples-btn ${examplesOpen ? 'is-active' : ''}`}
                onClick={() => setExamplesOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={examplesOpen}
                title="Choose an example diagram"
              >
                <Sparkles size={12} aria-hidden="true" />
                <span>Examples</span>
                <ChevronDown
                  size={11}
                  aria-hidden="true"
                  style={{
                    transition: 'transform 0.15s ease',
                    transform: examplesOpen ? 'rotate(180deg)' : 'none',
                  }}
                />
              </button>
              {examplesOpen && (
                <div className="custom-dropdown-menu mobile-examples-menu" role="menu">
                  {EXAMPLES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      className="dropdown-menu-item"
                      onClick={() => {
                        typeCode(item.code)
                        setExamplesOpen(false)
                      }}
                    >
                      <span className="menu-item-tag">{item.id}</span>
                      <span className="menu-item-label">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="icon-button mobile-tool-btn"
              onClick={formatCode}
              title="Auto-format indentation"
              aria-label="Format and indent Mermaid code"
            >
              <Wand2 size={13} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="icon-button mobile-tool-btn"
              onClick={() => setImportOpen(true)}
              title="Import schema from DBML or SQL"
              aria-label="Import schema from DBML or SQL"
            >
              <FolderInput size={13} aria-hidden="true" />
            </button>
          </div>
        </nav>

        {/* Source-linked diagrams: only rendered while there is something to say */}
        <SourceLinkStrip
          state={stripState}
          followUp={followUp}
          canSubmit={canSubmit}
          onEditSource={() => linked && enterEdit(linked, true)}
          onSave={handleSave}
          onLeave={handleLeave}
          onConfirmUpdate={() => handleUpdateDiagram(true)}
          onCancelConfirm={handleCancelConfirm}
          onDismissNotice={() => setNotice(null)}
          onToggleLive={toggleLive}
          onRevert={handleRevert}
          onUndoApply={handleUndoApply}
          onDismissResult={() => setEdit((cur) => cur && { ...cur, result: null, undo: null })}
        />

        {/* View Content: Code Editor or Live Diagram Canvas */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div
            ref={editorHostRef}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: activeTab === 'code' ? 1 : 0,
              pointerEvents: activeTab === 'code' ? 'auto' : 'none',
              zIndex: activeTab === 'code' ? 2 : 1,
            }}
          >
            <EditorPanel
              sidebarOpen={true}
              onToggleSidebar={() => {}}
              code={code}
              onCodeChange={typeCode}
              error={error}
              onFormatCode={formatCode}
              onOpenImport={() => setImportOpen(true)}
              onSelectExample={typeCode}
              onOpenAbout={() => setAboutOpen(true)}
              hint={editorHint(liveNow)}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 1,
              pointerEvents: activeTab === 'diagram' ? 'auto' : 'none',
              zIndex: activeTab === 'diagram' ? 2 : 1,
            }}
          >
            <Canvas
              canvasRef={canvasRef}
              diagramRef={diagramRef}
              zoom={zoom}
              zoomText={zoomText}
              onZoomTextChange={setZoomText}
              onZoomKey={handleZoomKey}
              onCommitZoomText={commitZoomText}
              zoomFieldRef={zoomFieldRef}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onResetZoom={resetZoom}
              dragging={dragging}
              interacting={interacting}
              svg={svg}
              code={code}
              error={error}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onLoadSample={() => typeCode(DEFAULT_DIAGRAM)}
              emptyStateVariant="plugin"
            />
          </div>
        </div>
      </div>

      <ImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImportConverted={typeCode}
      />

      <AboutModal
        isOpen={aboutOpen}
        onClose={() => setAboutOpen(false)}
      />
    </main>
  )
}
