import { useEffect, useState } from 'react'
import { CheckCheck, Link2, PencilLine, RotateCcw, Save, TriangleAlert, X } from 'lucide-react'
import { CONFIRM_TEXT, describeApplyResult, type ApplyOutcome } from './changeSummary.ts'
import type { LiveState } from './liveSync.ts'

/**
 * What the strip between the tab bar and the editor has to say. `null` means nothing: the strip
 * is not rendered at all (no permanent extra row).
 */
export type StripState =
  /** A linked diagram is selected in Figma and the user is not editing. */
  | { kind: 'selected' }
  /**
   * Edit mode, bound to one diagram. `editable: false` = the diagram cannot be updated (it is inside a
   * component instance): the Live switch and Save are not shown, only a close button.
   * `live` is the live update state, `liveNote` why it is paused or off, `canRevert` whether the code or
   * the diagram differs from the source the session started with. `saving`: Save was clicked and the
   * diagram is being written; the button is disabled and busy until the session ends or fails.
   */
  | {
      kind: 'editing'
      name: string
      editable: boolean
      error?: string
      live: LiveState
      liveNote: string | null
      canRevert: boolean
      saving: boolean
    }
  /**
   * A question that has to be answered before going on. `action` is what was asked for:
   * - `update`: a live or manual update would replace edits made in Figma (Cancel / Update anyway).
   * - `save`: Save would replace edits made in Figma (Keep editing / Replace & save).
   * - `leave`: the code has a syntax error, so the diagram cannot be updated; finishing now would leave
   *   it at its last update (Keep editing / Leave anyway).
   */
  | { kind: 'confirm'; name: string; text: string; action: 'update' | 'save' | 'leave' }
  /** A message shown outside edit mode (for example: the diagram being edited no longer exists). */
  | { kind: 'notice'; text: string }

/**
 * A second line under the "Editing" row: what happened when text edits made in Figma were written into
 * the code (Phase 13: automatically). `undoable` while "Undo" can still take it back.
 */
export type FollowUp = { kind: 'result'; outcome: ApplyOutcome; undoable: boolean }

interface SourceLinkStripProps {
  state: StripState | null
  followUp: FollowUp | null
  /** False while the preview has a syntax error or is still rendering: inserts and updates stay off. */
  canSubmit: boolean
  onEditSource: () => void
  /** Save the code to the diagram and finish editing. Also the "close" action when `editable` is false. */
  onSave: () => void
  /** Confirm `update` (Update anyway) or `save` (Replace & save). */
  onConfirmUpdate: () => void
  /** Confirm `leave`: finish editing without updating the diagram. */
  onLeave: () => void
  onCancelConfirm: () => void
  onDismissNotice: () => void
  onToggleLive: () => void
  onRevert: () => void
  onUndoApply: () => void
  onDismissResult: () => void
}

export const INSTANCE_NOTE =
  'It is inside a component instance, so it cannot be updated from here.'
export { CONFIRM_TEXT }

function announcement(state: StripState | null): string {
  if (!state) return ''
  switch (state.kind) {
    case 'selected':
      return 'Diagram selected. You can edit its source.'
    case 'editing':
      return `${state.saving ? 'Saving' : 'Editing'} ${state.name}. ${state.error ?? (state.editable ? state.liveNote ?? '' : INSTANCE_NOTE)}`.trim()
    case 'confirm':
      return state.text
    case 'notice':
      return state.text
  }
}

function followAnnouncement(followUp: FollowUp | null): string {
  return followUp ? describeApplyResult(followUp.outcome).full : ''
}

const LIVE_LABEL: Record<LiveState, string> = {
  on: 'Live on',
  off: 'Live off',
  paused: 'Live paused',
  slow: 'Live off',
  unavailable: 'Live off',
}

const LIVE_TITLE: Record<LiveState, string> = {
  on: 'Live update is on: the diagram in Figma follows your typing. Click to turn it off.',
  off: 'Live update is off: the diagram in Figma changes when you click Update or Save. Click to turn it on.',
  paused: 'Live update is paused because the diagram was changed in Figma. Click Update to replace those changes, or click here to turn it off.',
  slow: 'Live update is off for this diagram because it is slow to regenerate. Click Update or Save to apply your code.',
  unavailable: '',
}

export default function SourceLinkStrip({
  state,
  followUp,
  canSubmit,
  onEditSource,
  onSave,
  onConfirmUpdate,
  onLeave,
  onCancelConfirm,
  onDismissNotice,
  onToggleLive,
  onRevert,
  onUndoApply,
  onDismissResult,
}: SourceLinkStripProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const resultOutcome = followUp ? followUp.outcome : null
  // A new result starts collapsed.
  useEffect(() => {
    setDetailsOpen(false)
  }, [resultOutcome])

  // Live regions exist even when the strip does not, so the first message is announced. The follow-up
  // has its own region: announcing it must not repeat the "Editing ..." line.
  const live = (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement(state)}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {state?.kind === 'editing' ? followAnnouncement(followUp) : ''}
      </div>
    </>
  )
  if (!state) return live

  let icon: React.ReactNode = <Link2 size={14} aria-hidden="true" />
  let tone: 'info' | 'warn' = 'info'
  let main: React.ReactNode = null
  let note: string | null = null
  let actions: React.ReactNode = null
  let stacked = false

  switch (state.kind) {
    case 'selected':
      main = <span className="mpx-source-strip__text">Diagram selected</span>
      actions = (
        <button
          type="button"
          className="text-button"
          onClick={onEditSource}
          title="Load this diagram's Mermaid source into the editor"
          aria-label="Edit source of the selected diagram"
        >
          <PencilLine size={12} aria-hidden="true" />
          <span>Edit source</span>
        </button>
      )
      break

    case 'editing':
      icon = <PencilLine size={14} aria-hidden="true" />
      main = (
        <span className="mpx-source-strip__text">
          <span className="mpx-source-strip__lead">Editing:</span>
          <span className="mpx-source-strip__name" title={state.name}>
            {state.name}
          </span>
        </span>
      )
      note = state.error ?? (state.editable ? state.liveNote : INSTANCE_NOTE)
      if (state.error) tone = 'warn'
      actions = (
        <>
          {state.editable && (
            <button
              type="button"
              className="text-button mpx-source-strip__live"
              data-live={state.live}
              onClick={onToggleLive}
              aria-pressed={state.live !== 'off'}
              title={LIVE_TITLE[state.live]}
              aria-label="Live update of the diagram in Figma"
            >
              <span className="mpx-source-strip__live-dot" aria-hidden="true" />
              <span>{LIVE_LABEL[state.live]}</span>
            </button>
          )}
          {state.canRevert && (
            <button
              type="button"
              className="text-button"
              onClick={onRevert}
              title="Put the code and the diagram in Figma back to how they were when you started editing"
              aria-label="Revert the code and the diagram to how they were when you started editing"
            >
              <RotateCcw size={12} aria-hidden="true" />
              <span>Revert</span>
            </button>
          )}
          {state.editable ? (
            <button
              type="button"
              className="text-button mpx-source-strip__save"
              onClick={onSave}
              disabled={state.saving}
              aria-busy={state.saving}
              title="Save the code to the diagram in Figma and finish editing"
              aria-label="Save to the diagram and finish editing"
            >
              <Save size={12} aria-hidden="true" />
              <span>{state.saving ? 'Saving\u2026' : 'Save'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="icon-button"
              onClick={onSave}
              title="Close: finish editing. The diagram is not changed"
              aria-label="Finish editing"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </>
      )
      break

    case 'confirm':
      icon = <TriangleAlert size={14} aria-hidden="true" />
      tone = 'warn'
      stacked = true
      main = <span className="mpx-source-strip__text is-wrap">{state.text}</span>
      if (state.action === 'leave') {
        actions = (
          <>
            <button
              type="button"
              className="text-button"
              onClick={onCancelConfirm}
              aria-label="Keep editing the code"
            >
              <span>Keep editing</span>
            </button>
            <button
              type="button"
              className="text-button"
              onClick={onLeave}
              title="Finish editing without updating. The diagram keeps its last update"
              aria-label="Leave anyway: finish editing without updating the diagram"
            >
              <span>Leave anyway</span>
            </button>
          </>
        )
      } else if (state.action === 'save') {
        actions = (
          <>
            <button
              type="button"
              className="text-button"
              onClick={onCancelConfirm}
              aria-label="Keep editing and do not replace the edits made in Figma"
            >
              <span>Keep editing</span>
            </button>
            <button
              type="button"
              className="text-button"
              onClick={onConfirmUpdate}
              disabled={!canSubmit}
              title="Regenerate the diagram, replacing the edits made in Figma, and finish editing"
              aria-label="Replace the edits made in Figma, save the diagram and finish editing"
            >
              <span>Replace &amp; save</span>
            </button>
          </>
        )
      } else {
        actions = (
          <>
            <button
              type="button"
              className="text-button"
              onClick={onCancelConfirm}
              aria-label="Cancel update"
            >
              <span>Cancel</span>
            </button>
            <button
              type="button"
              className="text-button"
              onClick={onConfirmUpdate}
              disabled={!canSubmit}
              title="Regenerate the diagram and replace the edits made in Figma"
              aria-label="Update anyway and replace the edits made in Figma"
            >
              <span>Update anyway</span>
            </button>
          </>
        )
      }
      break

    case 'notice':
      icon = <TriangleAlert size={14} aria-hidden="true" />
      tone = 'warn'
      main = <span className="mpx-source-strip__text is-wrap">{state.text}</span>
      actions = (
        <button
          type="button"
          className="icon-button"
          onClick={onDismissNotice}
          title="Dismiss"
          aria-label="Dismiss message"
        >
          <X size={13} aria-hidden="true" />
        </button>
      )
      break
  }

  const follow = state.kind === 'editing' ? followUp : null
  if (follow && follow.outcome.unresolved.length > 0) tone = 'warn'

  let followRow: React.ReactNode = null
  if (follow) {
    const { short, full, truncated } = describeApplyResult(follow.outcome)
    const unmatched = follow.outcome.unresolved.length > 0
    followRow = (
      <div className="mpx-source-strip__follow-block" data-follow="result">
        <div className="mpx-source-strip__row mpx-source-strip__follow">
          <span className="mpx-source-strip__icon">
            {unmatched ? (
              <TriangleAlert size={14} aria-hidden="true" />
            ) : (
              <CheckCheck size={14} aria-hidden="true" />
            )}
          </span>
          <span className="mpx-source-strip__text is-wrap" title={full}>
            {short}
          </span>
          <div className="mpx-source-strip__actions">
            {follow.undoable && (
              <button
                type="button"
                className="text-button"
                onClick={onUndoApply}
                title="Take these text edits out of the code again"
                aria-label="Undo adding the text edits made in Figma to the code"
              >
                <span>Undo</span>
              </button>
            )}
            {truncated && (
              <button
                type="button"
                className="text-button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                aria-label={detailsOpen ? 'Hide the edits that were not matched' : 'Show every edit that was not matched'}
              >
                <span>{detailsOpen ? 'Hide' : 'Details'}</span>
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={onDismissResult}
              title="Dismiss"
              aria-label="Dismiss message"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
        {truncated && detailsOpen && (
          <ul className="mpx-source-strip__list" aria-label="Edits that were not matched">
            {follow.outcome.unresolved.map((c, i) => (
              <li key={i}>
                {`"${c.from.replace(/\s+/g, ' ').trim()}" \u2192 "${c.to.replace(/\s+/g, ' ').trim()}"`}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <>
      {live}
      <div
        className={`mpx-source-strip is-${tone}${stacked ? ' is-stacked' : ''}`}
        data-kind={state.kind}
      >
        <div className="mpx-source-strip__row">
          <span className="mpx-source-strip__icon">{icon}</span>
          {main}
          {actions && <div className="mpx-source-strip__actions">{actions}</div>}
        </div>
        {note && <p className="mpx-source-strip__note">{note}</p>}
        {followRow}
      </div>
    </>
  )
}
